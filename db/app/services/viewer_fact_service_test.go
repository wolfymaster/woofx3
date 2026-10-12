package services

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const chatTrigger = "twitch:trigger:user_message"

var factNow = time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)

// chatEmits is a chat trigger's emits as barkloader registers it, identity
// annotations included.
const chatEmits = `{"fields": [
	{"path": "chatterId", "type": "string", "identity": "viewer", "displayName": "chatterName"},
	{"path": "chatterName", "type": "string"},
	{"path": "message", "type": "string"},
	{"path": "bits", "type": "number"},
	{"path": "isAnonymous", "type": "boolean"},
	{"path": "mentionedIds", "type": "array", "identity": "viewer", "anonymousWhen": "isAnonymous"},
	{"path": "channelId", "type": "string"}
]}`

func newFactSvc(t *testing.T, db *gorm.DB) *viewerFactService {
	t.Helper()
	// The outbox row's id comes from a Postgres column default that the
	// SQLite schema lacks, so the test supplies one.
	err := db.Callback().Create().Before("gorm:create").Register("test:worker_event_id", func(tx *gorm.DB) {
		if event, ok := tx.Statement.Dest.(*models.WorkerEvent); ok && event.ID == "" {
			event.ID = uuid.NewString()
		}
	})
	if err != nil {
		t.Fatalf("register outbox id callback: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := NewViewerFactService(
		repo.NewViewerFactRepository(db),
		repo.NewViewerSegmentRepository(db),
		repo.NewModuleRepository(db),
		workers.NewEventPublisher(repo.NewDbEventRepository(db), logger),
	).(*viewerFactService)
	svc.now = func() time.Time { return factNow.Add(time.Hour) }
	return svc
}

func registerTrigger(t *testing.T, db *gorm.DB, moduleID, manifestID, event, emits string) {
	t.Helper()
	err := db.Create(&models.Trigger{
		ID:            uuid.New(),
		Taxonomy:      "[]",
		Name:          manifestID,
		Description:   manifestID,
		Event:         event,
		ConfigSchema:  "[]",
		Emits:         emits,
		CreatedByType: "MODULE",
		CreatedByRef:  moduleID,
		ManifestID:    manifestID,
		Transport:     "eventbus",
	}).Error
	if err != nil {
		t.Fatalf("register trigger %s: %v", manifestID, err)
	}
}

func forEachFactDialect(t *testing.T, test func(t *testing.T, svc *viewerFactService, db *gorm.DB)) {
	t.Helper()
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		registerTrigger(t, db, "twitch", "user_message", "chat.message.>", chatEmits)
		test(t, newFactSvc(t, db), db)
	})
}

func factBody(fn, subject, value, where string) string {
	source := map[string]any{"trigger": chatTrigger, "subject": subject}
	if value != "" {
		source["value"] = value
	}
	if where != "" {
		source["where"] = json.RawMessage(where)
	}
	body, _ := json.Marshal(map[string]any{
		"sources":   []any{source},
		"aggregate": map[string]any{"fn": fn},
	})
	return string(body)
}

func upsertFact(t *testing.T, svc *viewerFactService, req *client.UpsertFactDefinitionRequest) *client.FactDefinition {
	t.Helper()
	resp, err := svc.UpsertFactDefinition(context.Background(), req)
	if err != nil {
		t.Fatalf("UpsertFactDefinition(%s): %v", req.Id, err)
	}
	return resp.Definition
}

func messagesFact(where string) *client.UpsertFactDefinitionRequest {
	return &client.UpsertFactDefinitionRequest{
		Id:         "user:fact:messages",
		Name:       "Messages",
		Definition: factBody("count", "chatterId", "", where),
		WindowKind: "lifetime",
	}
}

func applyCount(t *testing.T, svc *viewerFactService, eventID string, at time.Time, factID string, revision int64, viewers ...string) *client.ApplyFactDeltasResponse {
	t.Helper()
	deltas := make([]*client.FactDelta, len(viewers))
	for i, viewer := range viewers {
		deltas[i] = &client.FactDelta{FactId: factID, Revision: revision, Platform: "twitch", SubjectId: viewer, Op: "count"}
	}
	resp, err := svc.ApplyFactDeltas(context.Background(), &client.ApplyFactDeltasRequest{
		Source:     "twitch",
		EventId:    eventID,
		OccurredAt: timestamppb.New(at),
		Deltas:     deltas,
	})
	if err != nil {
		t.Fatalf("ApplyFactDeltas(%s): %v", eventID, err)
	}
	return resp
}

func viewerFacts(t *testing.T, svc *viewerFactService, viewer string) *client.GetViewerFactsResponse {
	t.Helper()
	resp, err := svc.GetViewerFacts(context.Background(), &client.GetViewerFactsRequest{Platform: "twitch", SubjectId: viewer})
	if err != nil {
		t.Fatalf("GetViewerFacts: %v", err)
	}
	return resp
}

type factOutboxEvent struct {
	subject  string
	id       string
	revision float64
}

func factOutbox(t *testing.T, db *gorm.DB) []factOutboxEvent {
	t.Helper()
	var events []models.WorkerEvent
	if err := db.Where("entity_type = ?", "viewer.fact").Order("created_at").Find(&events).Error; err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	out := make([]factOutboxEvent, len(events))
	for i, event := range events {
		var data map[string]any
		if err := json.Unmarshal([]byte(event.Payload), &data); err != nil {
			t.Fatalf("outbox payload: %v", err)
		}
		out[i] = factOutboxEvent{subject: event.NATSSubject, id: data["id"].(string), revision: data["revision"].(float64)}
	}
	return out
}

func TestUpsertFactDefinitionResolvesItsSources(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		definition := upsertFact(t, svc, messagesFact(`{"not": {"path": "message", "op": "starts_with", "value": "!"}}`))

		if definition.Status != "active" || definition.Revision != 1 || definition.ValueKind != "number" || definition.Aggregate != "count" {
			t.Fatalf("definition = %s rev %d kind %s (%s), want active rev 1 number",
				definition.Status, definition.Revision, definition.ValueKind, definition.Reason)
		}
		source := definition.Sources[0]
		if source.Event != "chat.message.>" || source.SubjectPath != "chatterId" || source.SubjectIsArray ||
			source.DisplayName != "chatterName" || source.AnonymousWhen != "" {
			t.Fatalf("source = %+v", source)
		}
		if source.Where != `{"not":{"path":"message","op":"starts_with","value":"!"}}` {
			t.Fatalf("where = %s, want it compacted", source.Where)
		}
	})
}

func TestAnArraySubjectFansOutAndCarriesItsAnonymousFlag(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		definition := upsertFact(t, svc, &client.UpsertFactDefinitionRequest{
			Id:         "user:fact:mentioned",
			Name:       "Mentioned",
			Definition: factBody("last_at", "mentionedIds", "", ""),
			WindowKind: "lifetime",
		})

		source := definition.Sources[0]
		if !source.SubjectIsArray || source.AnonymousWhen != "isAnonymous" || definition.ValueKind != "timestamp" {
			t.Fatalf("definition = %s %+v", definition.ValueKind, source)
		}
	})
}

func TestUpsertFactDefinitionRefusesWhatDoesNotFitTheTrigger(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		cases := []struct {
			name       string
			definition string
			window     string
			want       string
		}{
			{"unknown aggregate", factBody("median", "chatterId", "bits", ""), "lifetime", "aggregate.fn"},
			{"unknown window", factBody("count", "chatterId", "", ""), "rolling", "window"},
			{"sessions per session", factBody("sessions", "chatterId", "", ""), "session", "lifetime window"},
			{"no sources", `{"sources": [], "aggregate": {"fn": "count"}}`, "lifetime", "at least one source"},
			{"unknown key", `{"sources": [{"trigger": "` + chatTrigger + `", "subject": "chatterId", "valu": "bits"}], "aggregate": {"fn": "count"}}`, "lifetime", "unknown field"},
			{"not a trigger id", `{"sources": [{"trigger": "twitch:action:x", "subject": "chatterId"}], "aggregate": {"fn": "count"}}`, "lifetime", "trigger id"},
			{"subject not emitted", factBody("count", "userId", "", ""), "lifetime", "not a field"},
			{"subject not an identity", factBody("count", "channelId", "", ""), "lifetime", "does not identify a viewer"},
			{"count with a value", factBody("count", "chatterId", "bits", ""), "lifetime", "reads no value"},
			{"sum without a value", factBody("sum", "chatterId", "", ""), "lifetime", "required by sum"},
			{"sum of a string", factBody("sum", "chatterId", "message", ""), "lifetime", "needs a number"},
			{"last of a boolean", factBody("last", "chatterId", "isAnonymous", ""), "lifetime", "number or a string"},
			{"where reads a missing path", factBody("count", "chatterId", "", `{"path": "text", "op": "contains", "value": "a"}`), "lifetime", "does not emit"},
			{"where sets two kinds", factBody("count", "chatterId", "", `{"path": "message", "op": "eq", "all": [{"path": "bits", "op": "gt", "value": 1}]}`), "lifetime", "exactly one"},
			{"where has an empty group", factBody("count", "chatterId", "", `{"any": []}`), "lifetime", "no conditions"},
			{"where atom has an unknown key", factBody("count", "chatterId", "", `{"path": "message", "op": "eq", "vaule": "a"}`), "lifetime", "unknown field"},
			{"where node has an unknown key", factBody("count", "chatterId", "", `{"all": [{"path": "message", "op": "eq", "value": "a"}], "note": "x"}`), "lifetime", "unknown field"},
			{"where has an unknown operator", factBody("count", "chatterId", "", `{"path": "message", "op": "contians", "value": "apple"}`), "lifetime", `unknown operator "contians"`},
			{"where nests an unknown operator", factBody("count", "chatterId", "", `{"not": {"path": "bits", "op": "above", "value": 1}}`), "lifetime", `not: bits: unknown operator "above"`},
			{"where regex does not compile", factBody("count", "chatterId", "", `{"path": "message", "op": "matches", "value": "("}`), "lifetime", "invalid regex"},
			{"where in without a list", factBody("count", "chatterId", "", `{"path": "message", "op": "in", "value": "apple"}`), "lifetime", "needs a list"},
			{"where between without a pair", factBody("count", "chatterId", "", `{"path": "bits", "op": "between", "value": [1]}`), "lifetime", "[min, max]"},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				_, err := svc.UpsertFactDefinition(context.Background(), &client.UpsertFactDefinitionRequest{
					Id: "user:fact:bad", Name: "Bad", Definition: tc.definition, WindowKind: tc.window,
				})
				wantTwirpCode(t, err, twirp.InvalidArgument)
				if !strings.Contains(err.Error(), tc.want) {
					t.Fatalf("err = %v, want it to mention %q", err, tc.want)
				}
			})
		}
		if n := len(factOutbox(t, db)); n != 0 {
			t.Fatalf("refused saves published %d events", n)
		}
	})
}

// A module may declare a fact over a trigger of a module installed later;
// a fact saved from the UI over a missing trigger would count nothing.
func TestOnlyAModuleMaySaveAFactOverAnUnregisteredTrigger(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		definition := `{"sources": [{"trigger": "kofi:trigger:donation", "subject": "donorId"}], "aggregate": {"fn": "count"}}`

		_, err := svc.UpsertFactDefinition(context.Background(), &client.UpsertFactDefinitionRequest{
			Id: "user:fact:donations", Name: "Donations", Definition: definition, WindowKind: "lifetime",
		})
		wantTwirpCode(t, err, twirp.FailedPrecondition)

		saved := upsertFact(t, svc, &client.UpsertFactDefinitionRequest{
			Id: "kofi:fact:donations", Name: "Donations", Definition: definition, WindowKind: "lifetime",
			CreatedByType: "MODULE", CreatedByRef: "kofi",
		})
		if saved.Status != "unresolved" || !strings.Contains(saved.Reason, "kofi:trigger:donation") || saved.Sources[0].Event != "" {
			t.Fatalf("saved = %s (%s) %+v, want unresolved naming the trigger", saved.Status, saved.Reason, saved.Sources[0])
		}

		registerTrigger(t, db, "kofi", "donation", "kofi.donation",
			`{"fields": [{"path": "donorId", "type": "string", "identity": "viewer"}]}`)
		listed, err := svc.ListFactDefinitions(context.Background(), &client.ListFactDefinitionsRequest{})
		if err != nil {
			t.Fatalf("ListFactDefinitions: %v", err)
		}
		if got := listed.Definitions[0]; got.Status != "active" || got.Sources[0].Event != "kofi.donation" {
			t.Fatalf("listed after install = %s (%s), want active on kofi.donation", got.Status, got.Reason)
		}
	})
}

// A `last` fact takes its kind from its value field, so with no registered
// trigger there is nothing to store it as.
// An archived trigger is one its module dropped; nothing fires it any more.
func TestAnArchivedTriggerDoesNotResolve(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, &client.UpsertFactDefinitionRequest{
			Id: "twitch:fact:messages", Name: "Messages", Definition: factBody("count", "chatterId", "", ""),
			WindowKind: "lifetime", CreatedByType: "MODULE", CreatedByRef: "twitch",
		})
		if err := db.Model(&models.Trigger{}).Where("manifest_id = ?", "user_message").
			Update("archived_at", factNow).Error; err != nil {
			t.Fatalf("archive trigger: %v", err)
		}

		listed, err := svc.ListFactDefinitions(context.Background(), &client.ListFactDefinitionsRequest{})
		if err != nil {
			t.Fatalf("ListFactDefinitions: %v", err)
		}
		if got := listed.Definitions[0]; got.Status != "unresolved" || got.Sources[0].Event != "" {
			t.Fatalf("listed = %s (%s), want unresolved", got.Status, got.Reason)
		}
		_, err = svc.UpsertFactDefinition(context.Background(), messagesFact(""))
		wantTwirpCode(t, err, twirp.FailedPrecondition)
	})
}

// The rest of an event still applies around a delta that does not fit, and
// the response says how many did not.
func TestApplyFactDeltasCountsInvalidAndSkippedDeltas(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, messagesFact(""))
		upsertFact(t, svc, &client.UpsertFactDefinitionRequest{
			Id: "user:fact:stream_messages", Name: "Messages this stream",
			Definition: factBody("count", "chatterId", "", ""), WindowKind: "session",
		})
		count := func(factID, viewer string) *client.FactDelta {
			return &client.FactDelta{FactId: factID, Revision: 1, Platform: "twitch", SubjectId: viewer, Op: "count"}
		}
		wrongOp := count("user:fact:messages", "v2")
		wrongOp.Op = "sum"
		wrongOp.Num = float64Ptr(1)

		resp, err := svc.ApplyFactDeltas(context.Background(), &client.ApplyFactDeltasRequest{
			Source: "twitch", EventId: "e1", OccurredAt: timestamppb.New(factNow),
			Deltas: []*client.FactDelta{
				count("user:fact:messages", "v1"), wrongOp, count("user:fact:messages", "v1"),
				count("user:fact:stream_messages", "v1"),
			},
		})
		if err != nil {
			t.Fatalf("ApplyFactDeltas: %v", err)
		}
		if !resp.Applied || resp.Invalid != 2 || resp.Skipped != 1 || resp.Dropped != 0 || len(resp.Changes) != 1 {
			t.Fatalf("resp = applied %v invalid %d skipped %d dropped %d changes %d; want true 2 1 0 1",
				resp.Applied, resp.Invalid, resp.Skipped, resp.Dropped, len(resp.Changes))
		}
	})
}

func TestAnUnresolvedLastFactIsRefused(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		_, err := svc.UpsertFactDefinition(context.Background(), &client.UpsertFactDefinitionRequest{
			Id: "kofi:fact:last_note", Name: "Note", WindowKind: "lifetime", CreatedByType: "MODULE", CreatedByRef: "kofi",
			Definition: `{"sources": [{"trigger": "kofi:trigger:donation", "subject": "donorId", "value": "note"}], "aggregate": {"fn": "last"}}`,
		})
		wantTwirpCode(t, err, twirp.FailedPrecondition)
	})
}

func TestListMarksADefinitionInvalidWhenItsTriggerStopsFitting(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, &client.UpsertFactDefinitionRequest{
			Id: "user:fact:bits", Name: "Bits", Definition: factBody("sum", "chatterId", "bits", ""), WindowKind: "lifetime",
		})
		if err := db.Model(&models.Trigger{}).Where("manifest_id = ?", "user_message").
			Update("emits", `{"fields": [{"path": "chatterId", "type": "string", "identity": "viewer"}]}`).Error; err != nil {
			t.Fatalf("change emits: %v", err)
		}

		listed, err := svc.ListFactDefinitions(context.Background(), &client.ListFactDefinitionsRequest{})
		if err != nil {
			t.Fatalf("ListFactDefinitions: %v", err)
		}
		if got := listed.Definitions[0]; got.Status != "invalid" || !strings.Contains(got.Reason, `value "bits"`) {
			t.Fatalf("listed = %s (%s), want invalid naming the value", got.Status, got.Reason)
		}
	})
}

func TestChangingWhatAFactComputesResetsItsValues(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		first := upsertFact(t, svc, messagesFact(""))
		applyCount(t, svc, "e1", factNow, first.Id, 1, "v1")

		renamed := messagesFact("")
		renamed.Name = "Chat messages"
		if got := upsertFact(t, svc, renamed); got.Revision != 1 || got.Name != "Chat messages" {
			t.Fatalf("renamed = rev %d %q, want rev 1 renamed", got.Revision, got.Name)
		}
		if values := viewerFacts(t, svc, "v1").Values; len(values) != 1 {
			t.Fatalf("values after a rename = %d, want the 1 kept", len(values))
		}

		revised := messagesFact(`{"path": "message", "op": "contains", "value": "apple"}`)
		revised.Name = "Chat messages"
		got := upsertFact(t, svc, revised)
		if got.Revision != 2 || !got.CountingSince.AsTime().After(first.CountingSince.AsTime().Add(-time.Second)) {
			t.Fatalf("revised = rev %d, want rev 2", got.Revision)
		}
		if values := viewerFacts(t, svc, "v1").Values; len(values) != 0 {
			t.Fatalf("values after a revision = %d, want 0", len(values))
		}

		stale := applyCount(t, svc, "e2", factNow, first.Id, 1, "v1")
		if !stale.Applied || stale.Dropped != 1 || len(stale.Changes) != 0 {
			t.Fatalf("stale apply = %+v, want the delta dropped", stale)
		}
		current := applyCount(t, svc, "e3", factNow, first.Id, 2, "v1")
		if len(current.Changes) != 1 || current.Changes[0].Before != nil || *current.Changes[0].After.Num != 1 {
			t.Fatalf("current apply = %+v, want absent -> 1", current.Changes)
		}

		events := factOutbox(t, db)
		if len(events) != 3 {
			t.Fatalf("outbox = %+v, want created, renamed and revised", events)
		}
		for i, wantRevision := range []float64{1, 1, 2} {
			if events[i].subject != "db.viewer.fact.upserted.system" || events[i].id != "user:fact:messages" || events[i].revision != wantRevision {
				t.Fatalf("outbox[%d] = %+v, want upserted rev %v", i, events[i], wantRevision)
			}
		}
	})
}

func TestSavingAnIdenticalDefinitionWritesNothing(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, messagesFact(`{"path": "message", "op": "contains", "value": "apple"}`))
		again := messagesFact(`{ "path" : "message",  "op": "contains", "value": "apple" }`)

		if got := upsertFact(t, svc, again); got.Revision != 1 {
			t.Fatalf("revision = %d after an identical save, want 1", got.Revision)
		}
		if n := len(factOutbox(t, db)); n != 1 {
			t.Fatalf("outbox = %d events, want only the create", n)
		}
	})
}

func TestAnIdHeldByAnotherCreatorIsRefused(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, messagesFact(""))
		takeover := messagesFact("")
		takeover.CreatedByType = "MODULE"
		takeover.CreatedByRef = "twitch"

		_, err := svc.UpsertFactDefinition(context.Background(), takeover)
		wantTwirpCode(t, err, twirp.FailedPrecondition)
	})
}

func TestDeleteFactDefinitionDeletesItsValuesAndAnnouncesIt(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, messagesFact(""))
		applyCount(t, svc, "e1", factNow, "user:fact:messages", 1, "v1")

		if _, err := svc.DeleteFactDefinition(context.Background(), &client.DeleteFactDefinitionRequest{Id: "user:fact:messages"}); err != nil {
			t.Fatalf("DeleteFactDefinition: %v", err)
		}
		if values := viewerFacts(t, svc, "v1").Values; len(values) != 0 {
			t.Fatalf("values after delete = %d, want 0", len(values))
		}
		events := factOutbox(t, db)
		if last := events[len(events)-1]; last.subject != "db.viewer.fact.deleted.system" || last.id != "user:fact:messages" {
			t.Fatalf("last outbox event = %+v, want deleted", last)
		}

		_, err := svc.DeleteFactDefinition(context.Background(), &client.DeleteFactDefinitionRequest{Id: "user:fact:messages"})
		wantTwirpCode(t, err, twirp.NotFound)
	})
}

func TestApplyFactDeltasIsIdempotentPerEvent(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, messagesFact(""))

		first := applyCount(t, svc, "e1", factNow, "user:fact:messages", 1, "v1", "v2")
		again := applyCount(t, svc, "e1", factNow, "user:fact:messages", 1, "v1", "v2")

		if !first.Applied || len(first.Changes) != 2 {
			t.Fatalf("first = %+v, want two changes", first)
		}
		if again.Applied || len(again.Changes) != 0 {
			t.Fatalf("again = %+v, want not applied", again)
		}
		if value := viewerFacts(t, svc, "v1").Values[0].Value; *value.Num != 1 {
			t.Fatalf("v1 messages = %v, want 1", *value.Num)
		}
	})
}

func TestApplyFactDeltasRefusesMalformedRequests(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, messagesFact(""))
		at := timestamppb.New(factNow)
		delta := func() *client.FactDelta {
			return &client.FactDelta{FactId: "user:fact:messages", Revision: 1, Platform: "twitch", SubjectId: "v1", Op: "count"}
		}
		long := delta()
		long.SubjectId = strings.Repeat("x", 101)
		other := delta()
		other.FactId = "user:fact:other"

		cases := map[string]*client.ApplyFactDeltasRequest{
			"no occurred_at":    {Source: "twitch", EventId: "e1", Deltas: []*client.FactDelta{delta()}},
			"no event id":       {Source: "twitch", OccurredAt: at, Deltas: []*client.FactDelta{delta()}},
			"subject too long":  {Source: "twitch", EventId: "e1", OccurredAt: at, Deltas: []*client.FactDelta{long}},
			"silent over two":   {Silent: true, OccurredAt: at, Deltas: []*client.FactDelta{delta(), other}},
			"event id too long": {Source: "twitch", EventId: strings.Repeat("e", 256), OccurredAt: at, Deltas: []*client.FactDelta{delta()}},
			"source too long":   {Source: strings.Repeat("s", 256), EventId: "e1", OccurredAt: at, Deltas: []*client.FactDelta{delta()}},
			"stamp too long":    {Source: "twitch", EventId: "e1", SessionStamp: strings.Repeat("x", 101), OccurredAt: at, Deltas: []*client.FactDelta{delta()}},
		}
		for name, req := range cases {
			t.Run(name, func(t *testing.T) {
				_, err := svc.ApplyFactDeltas(context.Background(), req)
				wantTwirpCode(t, err, twirp.InvalidArgument)
			})
		}
		if values := viewerFacts(t, svc, "v1").Values; len(values) != 0 {
			t.Fatalf("refused applies wrote %d values", len(values))
		}
	})
}

func TestGetViewerFactsReadsLifetimeAndTheCurrentSession(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, messagesFact(""))
		upsertFact(t, svc, &client.UpsertFactDefinitionRequest{
			Id: "user:fact:stream_messages", Name: "Messages this stream",
			Definition: factBody("count", "chatterId", "", ""), WindowKind: "session",
		})
		earlier := uuid.NewString()
		current := uuid.NewString()
		if err := db.Exec(`INSERT INTO stream_sessions (id, status, started_at, ended_at) VALUES (?, 'closed', ?, ?)`,
			earlier, factNow.Add(-24*time.Hour), factNow).Error; err != nil {
			t.Fatalf("earlier session: %v", err)
		}
		if err := db.Exec(`INSERT INTO stream_sessions (id, status, started_at) VALUES (?, 'open', ?)`, current, factNow).Error; err != nil {
			t.Fatalf("current session: %v", err)
		}

		name := "Wolfy"
		for i, at := range []time.Time{factNow.Add(-time.Hour), factNow.Add(time.Minute)} {
			_, err := svc.ApplyFactDeltas(context.Background(), &client.ApplyFactDeltasRequest{
				Source: "twitch", EventId: uuid.NewString(), OccurredAt: timestamppb.New(at),
				Deltas: []*client.FactDelta{
					{FactId: "user:fact:messages", Revision: 1, Platform: "twitch", SubjectId: "v1", SubjectName: &name, Op: "count"},
					{FactId: "user:fact:stream_messages", Revision: 1, Platform: "twitch", SubjectId: "v1", Op: "count"},
				},
			})
			if err != nil {
				t.Fatalf("ApplyFactDeltas %d: %v", i, err)
			}
		}

		got := viewerFacts(t, svc, "v1")
		if got.SessionId != current || got.SubjectName == nil || *got.SubjectName != "Wolfy" {
			t.Fatalf("session %s name %v, want the current session and Wolfy", got.SessionId, got.SubjectName)
		}
		values := map[string]float64{}
		for _, value := range got.Values {
			values[value.FactId+"/"+value.WindowKind] = *value.Value.Num
		}
		want := map[string]float64{"user:fact:messages/lifetime": 2, "user:fact:stream_messages/session": 1}
		if len(values) != len(want) || values["user:fact:messages/lifetime"] != 2 || values["user:fact:stream_messages/session"] != 1 {
			t.Fatalf("values = %v, want %v", values, want)
		}
	})
}

func TestPruneAppliedEventsLetsAnOldEventApplyAgain(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, messagesFact(""))
		for _, id := range []string{"e1", "e2", "e3", "e4", "e5"} {
			applyCount(t, svc, id, factNow, "user:fact:messages", 1, "v1")
		}

		facts := repo.NewViewerFactRepository(db)
		if n, err := facts.PruneAppliedEvents(time.Now().Add(-time.Hour), 2); err != nil || n != 0 {
			t.Fatalf("prune of nothing old = %d, %v", n, err)
		}
		if n, err := facts.PruneAppliedEvents(time.Now().Add(time.Hour), 2); err != nil || n != 5 {
			t.Fatalf("prune in batches of 2 = %d, %v; want all 5", n, err)
		}
		if again := applyCount(t, svc, "e1", factNow, "user:fact:messages", 1, "v1"); !again.Applied {
			t.Fatalf("a pruned event was still refused")
		}
	})
}

func float64Ptr(v float64) *float64 {
	return &v
}

// A definition change is announced with the fact id as the outbox entity, and
// fact ids are longer than the uuids that column was first sized for.
func TestAFactIDLongerThanAUUIDSavesAndIsAnnounced(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		req := messagesFact("")
		req.Id = "twitch_platform:fact:messages_sent_while_subscribed"
		upsertFact(t, svc, req)
		events := factOutbox(t, db)
		if len(events) != 1 || events[0].id != req.Id {
			t.Fatalf("outbox = %+v, want one event for %s", events, req.Id)
		}
	})
}
