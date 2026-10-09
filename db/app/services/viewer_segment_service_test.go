package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

func upsertSegment(t *testing.T, svc *viewerFactService, id, when string) *client.SegmentDefinitionResponse {
	t.Helper()
	resp, err := svc.UpsertSegmentDefinition(context.Background(), &client.UpsertSegmentDefinitionRequest{
		Id: id, Name: id, When: when,
	})
	if err != nil {
		t.Fatalf("UpsertSegmentDefinition(%s): %v", id, err)
	}
	return resp
}

func lastBitsFact() *client.UpsertFactDefinitionRequest {
	return &client.UpsertFactDefinitionRequest{
		Id: "user:fact:last_bits", Name: "Last cheer", Definition: factBody("last", "chatterId", "bits", ""), WindowKind: "lifetime",
	}
}

func lastSeenFact() *client.UpsertFactDefinitionRequest {
	return &client.UpsertFactDefinitionRequest{
		Id: "user:fact:last_seen", Name: "Last seen", Definition: factBody("last_at", "chatterId", "", ""), WindowKind: "lifetime",
	}
}

// applyDeltas applies one event's deltas for one viewer, named "Wolfy".
func applyDeltas(t *testing.T, svc *viewerFactService, eventID string, at time.Time, stamp string, silent bool, viewer string, deltas ...*client.FactDelta) *client.ApplyFactDeltasResponse {
	t.Helper()
	name := "Wolfy"
	for _, delta := range deltas {
		delta.Platform = "twitch"
		delta.SubjectId = viewer
		delta.SubjectName = &name
	}
	req := &client.ApplyFactDeltasRequest{OccurredAt: timestamppb.New(at), SessionStamp: stamp, Silent: silent, Deltas: deltas}
	if !silent {
		req.Source = "twitch"
		req.EventId = eventID
	}
	resp, err := svc.ApplyFactDeltas(context.Background(), req)
	if err != nil {
		t.Fatalf("ApplyFactDeltas(%s): %v", eventID, err)
	}
	return resp
}

func lastDelta(factID string, revision int64, bits float64) *client.FactDelta {
	return &client.FactDelta{FactId: factID, Revision: revision, Op: "last", Num: &bits}
}

func opDelta(factID string, revision int64, op string) *client.FactDelta {
	return &client.FactDelta{FactId: factID, Revision: revision, Op: op}
}

// segmentEdge is an edge event as the outbox will publish it.
type segmentEdge struct {
	subject    string
	eventType  string
	entityID   string
	extensions map[string]string
	data       segmentEdgeEvent
}

func (e segmentEdge) String() string {
	return fmt.Sprintf("%s %s/%s", e.subject, e.data.SegmentID, e.data.ViewerID)
}

// segmentEdges returns the viewer.segment.entered/left events in the outbox,
// oldest first, leaving out the db.viewer.segment.* lifecycle events.
func segmentEdges(t *testing.T, db *gorm.DB) []segmentEdge {
	t.Helper()
	// SQLite keeps created_at to the second, so insertion order breaks ties.
	order := "created_at"
	if db.Dialector.Name() == "sqlite" {
		order = "rowid"
	}
	var events []models.WorkerEvent
	if err := db.Where("entity_type = ? AND nats_subject NOT LIKE 'db.%'", "viewer.segment").
		Order(order).Find(&events).Error; err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	out := make([]segmentEdge, len(events))
	for i, event := range events {
		out[i] = segmentEdge{subject: event.NATSSubject, eventType: event.EventType, entityID: event.EntityID}
		if err := json.Unmarshal([]byte(event.Payload), &out[i].data); err != nil {
			t.Fatalf("edge payload: %v", err)
		}
		if event.Extensions != nil {
			if err := json.Unmarshal([]byte(*event.Extensions), &out[i].extensions); err != nil {
				t.Fatalf("edge extensions: %v", err)
			}
		}
	}
	return out
}

func edgeSubjects(edges []segmentEdge) []string {
	out := make([]string, len(edges))
	for i, edge := range edges {
		out[i] = edge.subject
	}
	return out
}

func wantEdges(t *testing.T, db *gorm.DB, want ...string) []segmentEdge {
	t.Helper()
	edges := segmentEdges(t, db)
	if got := edgeSubjects(edges); !slices.Equal(got, want) {
		t.Fatalf("edges = %v, want %v", edges, want)
	}
	return edges
}

func viewerSegments(t *testing.T, svc *viewerFactService, viewer string) []string {
	t.Helper()
	resp, err := svc.GetViewerSegments(context.Background(), &client.GetViewerSegmentsRequest{Platform: "twitch", SubjectId: viewer})
	if err != nil {
		t.Fatalf("GetViewerSegments: %v", err)
	}
	out := []string{}
	for _, segment := range resp.Segments {
		out = append(out, segment.SegmentId)
	}
	return out
}

const (
	edgeEntered = "viewer.segment.entered"
	edgeLeft    = "viewer.segment.left"
)

func TestSegmentAnnouncesEachThresholdCrossingOnce(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		bits := upsertFact(t, svc, lastBitsFact())
		messages := upsertFact(t, svc, messagesFact(""))
		upsertSegment(t, svc, "user:segment:big_cheerer", `{"fact": "user:fact:last_bits", "op": "gte", "value": 100}`)
		upsertSegment(t, svc, "user:segment:chatty", `{"fact": "user:fact:messages", "op": "gte", "value": 3}`)

		at := factNow
		step := func(id string, deltas ...*client.FactDelta) {
			at = at.Add(time.Minute)
			applyDeltas(t, svc, id, at, "", false, "v1", deltas...)
		}
		step("e1", lastDelta(bits.Id, bits.Revision, 50))
		wantEdges(t, db)
		step("e2", lastDelta(bits.Id, bits.Revision, 150))
		step("e3", lastDelta(bits.Id, bits.Revision, 200))
		step("e4", lastDelta(bits.Id, bits.Revision, 300))
		wantEdges(t, db, edgeEntered)
		step("e5", lastDelta(bits.Id, bits.Revision, 10))
		wantEdges(t, db, edgeEntered, edgeLeft)
		step("e6", lastDelta(bits.Id, bits.Revision, 5))
		step("e7", lastDelta(bits.Id, bits.Revision, 120))
		edges := wantEdges(t, db, edgeEntered, edgeLeft, edgeEntered)

		for i := 0; i < 6; i++ {
			step(fmt.Sprintf("m%d", i), opDelta(messages.Id, messages.Revision, "count"))
		}
		edges = wantEdges(t, db, edgeEntered, edgeLeft, edgeEntered, edgeEntered)
		if got := viewerSegments(t, svc, "v1"); !slices.Equal(got, []string{"user:segment:big_cheerer", "user:segment:chatty"}) {
			t.Fatalf("v1's segments = %v", got)
		}

		edge := edges[1]
		if edge.subject != edgeLeft || edge.eventType != edgeLeft || edge.entityID != "user:segment:big_cheerer" {
			t.Fatalf("left edge = subject %s, type %s, entity %s", edge.subject, edge.eventType, edge.entityID)
		}
		// No session has started, so the edge carries no session id.
		if len(edge.extensions) != 1 || edge.extensions["platform"] != "twitch" {
			t.Fatalf("left edge extensions = %v, want platform only", edge.extensions)
		}
		data := edge.data
		if data.SegmentID != "user:segment:big_cheerer" || data.Platform != "twitch" || data.ViewerID != "v1" ||
			data.ViewerName != "Wolfy" || data.Cause.Source != "twitch" || data.Cause.EventID != "e5" {
			t.Fatalf("left edge data = %+v", data)
		}
		fact := data.Facts["user:fact:last_bits"]
		if fact.Before != 300.0 || fact.After != 10.0 || len(data.Facts) != 1 {
			t.Fatalf("left edge facts = %+v, want last_bits 300 -> 10", data.Facts)
		}
		if first := edges[0].data.Facts["user:fact:last_bits"]; first.Before != 50.0 || first.After != 150.0 {
			t.Fatalf("entered edge facts = %+v, want 50 -> 150", first)
		}
	})
}

// "Welcome back": a viewer leaves a segment of viewers not seen for 30 days
// by being seen. Nothing announces them entering it as time passes, but the
// event that brings them back must announce them leaving it.
func TestTimeRelativeSegmentComparesTheEventsBeforeAndAfter(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		seen := upsertFact(t, svc, lastSeenFact())
		away := upsertSegment(t, svc, "user:segment:away", `{"fact": "user:fact:last_seen", "op": "older_than", "value": "720h"}`)
		if !away.Definition.TimeRelative {
			t.Fatal("an older_than segment was not marked time-relative")
		}
		upsertSegment(t, svc, "user:segment:recent", `{"fact": "user:fact:last_seen", "op": "within", "value": "1h"}`)
		seenAt := func(id string, at time.Time) {
			applyDeltas(t, svc, id, at, "", false, "v1", opDelta(seen.Id, seen.Revision, "last_at"))
		}

		seenAt("first", factNow)
		edges := wantEdges(t, db, edgeEntered)
		if edges[0].data.SegmentID != "user:segment:recent" || edges[0].data.Facts[seen.Id].Before != nil {
			t.Fatalf("first sighting = %+v, want recent entered from nothing", edges[0].data)
		}
		seenAt("soon", factNow.Add(10*time.Minute))
		wantEdges(t, db, edgeEntered)

		seenAt("back", factNow.Add(40*24*time.Hour))
		edges = wantEdges(t, db, edgeEntered, edgeLeft, edgeEntered)
		if edges[1].data.SegmentID != "user:segment:away" || edges[2].data.SegmentID != "user:segment:recent" {
			t.Fatalf("return after 40 days = %v, want away left then recent entered", edges)
		}
		facts := edges[1].data.Facts[seen.Id]
		if facts.Before != float64(factNow.Add(10*time.Minute).UnixMilli()) || facts.After != float64(factNow.Add(40*24*time.Hour).UnixMilli()) {
			t.Fatalf("away left with %+v, want the last sighting before and the return after", facts)
		}
		if got := viewerSegments(t, svc, "v1"); !slices.Equal(got, []string{"user:segment:recent"}) {
			t.Fatalf("v1's stored segments = %v, want recent only", got)
		}
	})
}

// addStreamSession inserts a session started at startedAt, closed at endedAt
// unless that is zero.
func addStreamSession(t *testing.T, db *gorm.DB, startedAt, endedAt time.Time) string {
	t.Helper()
	id := uuid.New()
	status, ended := "open", any(nil)
	if !endedAt.IsZero() {
		status, ended = "closed", endedAt.UTC()
	}
	if err := db.Exec(`INSERT INTO stream_sessions (id, status, started_at, ended_at) VALUES (?, ?, ?, ?)`, id, status, startedAt.UTC(), ended).Error; err != nil {
		t.Fatalf("insert session: %v", err)
	}
	return id.String()
}

func TestSessionSegmentStartsEmptyInANewSessionWithoutAnnouncingIt(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		first := addStreamSession(t, db, factNow.Add(-2*time.Hour), factNow.Add(29*time.Minute))
		second := addStreamSession(t, db, factNow.Add(30*time.Minute), time.Time{})
		session := upsertFact(t, svc, &client.UpsertFactDefinitionRequest{
			Id: "user:fact:session_messages", Name: "Messages this stream", Definition: factBody("count", "chatterId", "", ""), WindowKind: "session",
		})
		resp := upsertSegment(t, svc, "user:segment:chatty_tonight", `{"fact": "user:fact:session_messages", "op": "gte", "value": 2}`)
		if resp.Definition.WindowKind != "session" {
			t.Fatalf("window = %s, want session", resp.Definition.WindowKind)
		}
		chat := func(id string, at time.Time) {
			applyDeltas(t, svc, id, at, "", false, "v1", opDelta(session.Id, session.Revision, "count"))
		}

		chat("a1", factNow.Add(-time.Hour))
		chat("a2", factNow.Add(-time.Hour+time.Minute))
		edges := wantEdges(t, db, edgeEntered)
		if edges[0].data.SessionID != first || edges[0].extensions["sessionid"] != first || edges[0].extensions["platform"] != "twitch" {
			t.Fatalf("entered in session %q with extensions %v, want %s", edges[0].data.SessionID, edges[0].extensions, first)
		}
		// GetViewerSegments reads "now" an hour after factNow, in the second
		// session, where v1 has not chatted.
		if got := viewerSegments(t, svc, "v1"); len(got) != 0 {
			t.Fatalf("v1's segments in the next session = %v, want none", got)
		}

		chat("b1", factNow.Add(31*time.Minute))
		wantEdges(t, db, edgeEntered)
		var rows int64
		if err := db.Model(&models.SegmentMember{}).Count(&rows).Error; err != nil {
			t.Fatalf("count members: %v", err)
		}
		if rows != 0 {
			t.Fatalf("membership rows after the reset = %d, want the stale one dropped", rows)
		}
		chat("b2", factNow.Add(32*time.Minute))
		edges = wantEdges(t, db, edgeEntered, edgeEntered)
		if edges[1].data.SessionID != second {
			t.Fatalf("entered again in session %q, want %s", edges[1].data.SessionID, second)
		}
		if got := viewerSegments(t, svc, "v1"); !slices.Equal(got, []string{"user:segment:chatty_tonight"}) {
			t.Fatalf("v1's segments = %v", got)
		}
	})
}

func TestCreatingOrRevisingASegmentFillsItSilently(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		messages := upsertFact(t, svc, messagesFact(""))
		for i := 0; i < 5; i++ {
			applyDeltas(t, svc, fmt.Sprintf("v1-%d", i), factNow, "", false, "v1", opDelta(messages.Id, messages.Revision, "count"))
		}
		applyDeltas(t, svc, "v2-0", factNow, "", false, "v2", opDelta(messages.Id, messages.Revision, "count"))

		resp := upsertSegment(t, svc, "user:segment:chatty", `{"fact": "user:fact:messages", "op": "gte", "value": 3}`)
		if resp.Definition.Revision != 1 || resp.Definition.Status != "active" || !slices.Equal(resp.Definition.Facts, []string{messages.Id}) {
			t.Fatalf("created = %+v", resp.Definition)
		}
		if got := viewerSegments(t, svc, "v1"); !slices.Equal(got, []string{"user:segment:chatty"}) {
			t.Fatalf("v1 after the fill = %v", got)
		}
		if got := viewerSegments(t, svc, "v2"); len(got) != 0 {
			t.Fatalf("v2 after the fill = %v, want none", got)
		}

		resp = upsertSegment(t, svc, "user:segment:chatty", `{"fact": "user:fact:messages", "op": "gte", "value": 1}`)
		if resp.Definition.Revision != 2 {
			t.Fatalf("revision = %d, want 2", resp.Definition.Revision)
		}
		if got := viewerSegments(t, svc, "v2"); !slices.Equal(got, []string{"user:segment:chatty"}) {
			t.Fatalf("v2 after the refill = %v", got)
		}
		upsertSegment(t, svc, "user:segment:chatty", `{"fact": "user:fact:messages", "op": "gte", "value": 10}`)
		if len(viewerSegments(t, svc, "v1")) != 0 || len(viewerSegments(t, svc, "v2")) != 0 {
			t.Fatal("a raised threshold left members in")
		}
		wantEdges(t, db)

		var lifecycle []models.WorkerEvent
		if err := db.Where("nats_subject = ?", "db.viewer.segment.upserted.system").Find(&lifecycle).Error; err != nil {
			t.Fatalf("read outbox: %v", err)
		}
		if len(lifecycle) != 3 || lifecycle[0].EventType != "viewer.segment.upserted" {
			t.Fatalf("lifecycle events = %d, want 3 viewer.segment.upserted", len(lifecycle))
		}

		if _, err := svc.DeleteSegmentDefinition(context.Background(), &client.DeleteSegmentDefinitionRequest{Id: "user:segment:chatty"}); err != nil {
			t.Fatalf("DeleteSegmentDefinition: %v", err)
		}
		if _, err := svc.DeleteSegmentDefinition(context.Background(), &client.DeleteSegmentDefinitionRequest{Id: "user:segment:chatty"}); twirpCode(err) != twirp.NotFound {
			t.Fatalf("delete again: %v, want not_found", err)
		}
		var deleted int64
		db.Model(&models.WorkerEvent{}).Where("nats_subject = ?", "db.viewer.segment.deleted.system").Count(&deleted)
		if deleted != 1 {
			t.Fatalf("deleted lifecycle events = %d, want 1", deleted)
		}
		wantEdges(t, db)
	})
}

func TestRevisingAFactRefillsTheSegmentsReadingItSilently(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		messages := upsertFact(t, svc, messagesFact(""))
		applyDeltas(t, svc, "e1", factNow, "", false, "v1", opDelta(messages.Id, messages.Revision, "count"))
		upsertSegment(t, svc, "user:segment:talker", `{"fact": "user:fact:messages", "op": "gte", "value": 1}`)
		upsertSegment(t, svc, "user:segment:lurker", `{"fact": "user:fact:messages", "op": "ne", "value": 1}`)
		if got := viewerSegments(t, svc, "v1"); !slices.Equal(got, []string{"user:segment:talker"}) {
			t.Fatalf("v1 before the revision = %v", got)
		}

		revised := upsertFact(t, svc, messagesFact(`{"path": "message", "op": "contains", "value": "apple"}`))
		if revised.Revision != 2 {
			t.Fatalf("fact revision = %d, want 2", revised.Revision)
		}
		if got := viewerSegments(t, svc, "v1"); len(got) != 0 {
			t.Fatalf("v1 after the values were wiped = %v, want none", got)
		}
		wantEdges(t, db)

		applyDeltas(t, svc, "e2", factNow.Add(time.Minute), "", false, "v1", opDelta(revised.Id, revised.Revision, "count"))
		wantEdges(t, db, edgeEntered)
	})
}

func TestSilentApplyMovesMembershipWithoutAnnouncingIt(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		messages := upsertFact(t, svc, messagesFact(""))
		upsertSegment(t, svc, "user:segment:chatty", `{"fact": "user:fact:messages", "op": "gte", "value": 2}`)
		for i := 0; i < 3; i++ {
			applyDeltas(t, svc, "", factNow.Add(-time.Duration(i)*time.Hour), "", true, "v1", opDelta(messages.Id, messages.Revision, "count"))
		}
		if got := viewerSegments(t, svc, "v1"); !slices.Equal(got, []string{"user:segment:chatty"}) {
			t.Fatalf("v1 after a backfill = %v", got)
		}
		wantEdges(t, db)

		applyDeltas(t, svc, "live", factNow, "", false, "v1", opDelta(messages.Id, messages.Revision, "count"))
		wantEdges(t, db)
	})
}

func TestDeletingAFactASegmentReadsIsRefused(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, messagesFact(""))
		upsertSegment(t, svc, "user:segment:chatty", `{"fact": "user:fact:messages", "op": "gte", "value": 3}`)
		upsertSegment(t, svc, "user:segment:quiet", `{"not": {"fact": "user:fact:messages", "op": "exists"}}`)

		_, err := svc.DeleteFactDefinition(context.Background(), &client.DeleteFactDefinitionRequest{Id: "user:fact:messages"})
		if twirpCode(err) != twirp.FailedPrecondition || !strings.Contains(err.Error(), "user:segment:chatty, user:segment:quiet") {
			t.Fatalf("delete a read fact: %v, want failed_precondition naming both segments", err)
		}
		for _, id := range []string{"user:segment:chatty", "user:segment:quiet"} {
			if _, err := svc.DeleteSegmentDefinition(context.Background(), &client.DeleteSegmentDefinitionRequest{Id: id}); err != nil {
				t.Fatalf("DeleteSegmentDefinition(%s): %v", id, err)
			}
		}
		if _, err := svc.DeleteFactDefinition(context.Background(), &client.DeleteFactDefinitionRequest{Id: "user:fact:messages"}); err != nil {
			t.Fatalf("delete an unread fact: %v", err)
		}
	})
}

func TestUpsertSegmentDefinitionRefusesWhatCannotBeEvaluated(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		upsertFact(t, svc, messagesFact(""))
		upsertFact(t, svc, lastSeenFact())
		cases := []struct {
			name string
			req  *client.UpsertSegmentDefinitionRequest
			code twirp.ErrorCode
			want string
		}{
			{"no id", &client.UpsertSegmentDefinitionRequest{Name: "x", When: `{"fact": "user:fact:messages", "op": "exists"}`}, twirp.InvalidArgument, "id"},
			{"a fact id", &client.UpsertSegmentDefinitionRequest{Id: "user:fact:x", Name: "x", When: `{"fact": "user:fact:messages", "op": "exists"}`}, twirp.InvalidArgument, "segment id"},
			{"no name", &client.UpsertSegmentDefinitionRequest{Id: "user:segment:x", When: `{"fact": "user:fact:messages", "op": "exists"}`}, twirp.InvalidArgument, "name"},
			{"bad creator", &client.UpsertSegmentDefinitionRequest{Id: "user:segment:x", Name: "x", CreatedByType: "robot", When: `{"fact": "user:fact:messages", "op": "exists"}`}, twirp.InvalidArgument, "robot"},
			{"malformed", &client.UpsertSegmentDefinitionRequest{Id: "user:segment:x", Name: "x", When: `{"fact": "user:fact:messages", "op": "exists", "extra": 1}`}, twirp.InvalidArgument, "unknown field"},
			{"missing fact", &client.UpsertSegmentDefinitionRequest{Id: "user:segment:x", Name: "x", When: `{"fact": "user:fact:nope", "op": "exists"}`}, twirp.InvalidArgument, "user:fact:nope is not a fact"},
			{"within a count", &client.UpsertSegmentDefinitionRequest{Id: "user:segment:x", Name: "x", When: `{"fact": "user:fact:messages", "op": "within", "value": "1h"}`}, twirp.InvalidArgument, "reads a timestamp"},
			{"eq a string on a number", &client.UpsertSegmentDefinitionRequest{Id: "user:segment:x", Name: "x", When: `{"fact": "user:fact:messages", "op": "eq", "value": "3"}`}, twirp.InvalidArgument, "with a string"},
		}
		for _, tc := range cases {
			_, err := svc.UpsertSegmentDefinition(context.Background(), tc.req)
			if twirpCode(err) != tc.code || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("%s: %v, want %s containing %q", tc.name, err, tc.code, tc.want)
			}
		}

		upsertSegment(t, svc, "user:segment:x", `{"fact": "user:fact:last_seen", "op": "within", "value": "1h"}`)
		_, err := svc.UpsertSegmentDefinition(context.Background(), &client.UpsertSegmentDefinitionRequest{
			Id: "user:segment:x", Name: "x", CreatedByType: "MODULE", CreatedByRef: "twitch", When: `{"fact": "user:fact:last_seen", "op": "exists"}`,
		})
		if twirpCode(err) != twirp.FailedPrecondition {
			t.Fatalf("save over another creator's segment: %v, want failed_precondition", err)
		}

		list, err := svc.ListSegmentDefinitions(context.Background(), &client.ListSegmentDefinitionsRequest{})
		if err != nil || len(list.Definitions) != 1 {
			t.Fatalf("ListSegmentDefinitions = %v, %v", list, err)
		}
		listed := list.Definitions[0]
		if listed.Status != "active" || !listed.TimeRelative || listed.WindowKind != "lifetime" || !slices.Equal(listed.Facts, []string{"user:fact:last_seen"}) {
			t.Fatalf("listed = %+v", listed)
		}
	})
}

// A fact whose trigger is no longer registered stops counting, and a segment
// reading it must not keep trusting the value it had: it reads as missing.
func TestASegmentReadsAnInactiveFactAsMissing(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		registerTrigger(t, db, "raids", "raid", "channel.raid", `{"fields": [{"path": "raiderId", "type": "string", "identity": "viewer"}]}`)
		messages := upsertFact(t, svc, messagesFact(""))
		raids := upsertFact(t, svc, &client.UpsertFactDefinitionRequest{
			Id: "user:fact:raids", Name: "Raids",
			Definition: `{"sources":[{"trigger":"raids:trigger:raid","subject":"raiderId"}],"aggregate":{"fn":"count"}}`,
			WindowKind: "lifetime",
		})
		applyDeltas(t, svc, "raid", factNow, "", false, "v1", opDelta(raids.Id, raids.Revision, "count"))
		upsertSegment(t, svc, "user:segment:chatty_non_raider", `{"all": [
			{"fact": "user:fact:messages", "op": "gte", "value": 1},
			{"fact": "user:fact:raids", "op": "not_exists"}]}`)

		applyDeltas(t, svc, "m1", factNow.Add(time.Minute), "", false, "v1", opDelta(messages.Id, messages.Revision, "count"))
		wantEdges(t, db)

		if err := db.Exec(`UPDATE triggers SET archived_at = ? WHERE manifest_id = 'raid'`, factNow).Error; err != nil {
			t.Fatalf("archive trigger: %v", err)
		}
		edges := func() []segmentEdge {
			applyDeltas(t, svc, "m2", factNow.Add(2*time.Minute), "", false, "v1", opDelta(messages.Id, messages.Revision, "count"))
			return wantEdges(t, db, edgeEntered)
		}()
		if facts := edges[0].data.Facts["user:fact:raids"]; facts.Before != nil || facts.After != nil {
			t.Fatalf("the inactive fact was reported as %+v, want null", facts)
		}
	})
}

// Two events changing different facts of one viewer, applied at once, must
// each see the other's value once it commits; otherwise each evaluates a
// segment reading both against the other's stale value and the viewer never
// enters.
func TestConcurrentAppliesForOneViewerEnterItOnce(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		if db.Dialector.Name() != "postgres" {
			t.Skip("SQLite serializes every write transaction")
		}
		// Enough connections for the applies to overlap, few enough for the
		// server's limit.
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatalf("sql db: %v", err)
		}
		sqlDB.SetMaxOpenConns(12)
		messages := upsertFact(t, svc, messagesFact(""))
		bits := upsertFact(t, svc, lastBitsFact())
		upsertSegment(t, svc, "user:segment:both", `{"all": [
			{"fact": "user:fact:messages", "op": "gte", "value": 1},
			{"fact": "user:fact:last_bits", "op": "gte", "value": 1}]}`)

		const viewers = 40
		var wg sync.WaitGroup
		errs := make(chan error, 2*viewers)
		for i := 0; i < viewers; i++ {
			viewer := fmt.Sprintf("v%d", i)
			for _, delta := range []*client.FactDelta{opDelta(messages.Id, messages.Revision, "count"), lastDelta(bits.Id, bits.Revision, 5)} {
				wg.Add(1)
				go func(delta *client.FactDelta) {
					defer wg.Done()
					delta.Platform = "twitch"
					delta.SubjectId = viewer
					_, err := svc.ApplyFactDeltas(context.Background(), &client.ApplyFactDeltasRequest{
						Source: "twitch", EventId: viewer + "-" + delta.Op, OccurredAt: timestamppb.New(factNow), Deltas: []*client.FactDelta{delta},
					})
					if err != nil {
						errs <- err
					}
				}(delta)
			}
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			t.Errorf("apply: %v", err)
		}
		edges := segmentEdges(t, db)
		if len(edges) != viewers {
			t.Fatalf("edges = %d, want one entered per viewer (%d)", len(edges), viewers)
		}
		var members int64
		db.Model(&models.SegmentMember{}).Count(&members)
		if members != viewers {
			t.Fatalf("members = %d, want %d", members, viewers)
		}
	})
}

func twirpCode(err error) twirp.ErrorCode {
	var twerr twirp.Error
	if errors.As(err, &twerr) {
		return twerr.Code()
	}
	return twirp.NoError
}

// A fact counting the engine's own segment edges would feed the segments that
// publish them, looping through the outbox.
func TestAFactCannotCountSegmentEdges(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		edgeEmits := `{"fields": [{"path": "viewerId", "type": "string", "identity": "viewer"}, {"path": "segmentId", "type": "string"}]}`
		registerTrigger(t, db, "woofx3", "viewer_segment_entered", "viewer.segment.entered", edgeEmits)
		entries := func(createdByType string) *client.UpsertFactDefinitionRequest {
			return &client.UpsertFactDefinitionRequest{
				Id: "user:fact:entries", Name: "Segment entries", CreatedByType: createdByType, CreatedByRef: "woofx3",
				Definition: `{"sources":[{"trigger":"woofx3:trigger:viewer_segment_entered","subject":"viewerId"}],"aggregate":{"fn":"count"}}`,
				WindowKind: "lifetime",
			}
		}
		for _, createdByType := range []string{"USER", "MODULE"} {
			_, err := svc.UpsertFactDefinition(context.Background(), entries(createdByType))
			if twirpCode(err) != twirp.FailedPrecondition || !strings.Contains(err.Error(), "viewer.* segment events") {
				t.Fatalf("%s fact over segment edges: %v, want failed_precondition", createdByType, err)
			}
		}

		// Declared before the trigger was registered, it turns invalid once it
		// is, and is never applied.
		late := entries("MODULE")
		late.Id = "woofx3:fact:entries"
		late.Definition = strings.Replace(late.Definition, "viewer_segment_entered", "viewer_segment_left", 1)
		if def := upsertFact(t, svc, late); def.Status != "unresolved" {
			t.Fatalf("status before the trigger = %s, want unresolved", def.Status)
		}
		registerTrigger(t, db, "woofx3", "viewer_segment_left", "viewer.segment.left", edgeEmits)
		list, err := svc.ListFactDefinitions(context.Background(), &client.ListFactDefinitionsRequest{})
		if err != nil {
			t.Fatalf("ListFactDefinitions: %v", err)
		}
		for _, def := range list.Definitions {
			if def.Id == late.Id && def.Status != "invalid" {
				t.Fatalf("status after the trigger = %s (%s), want invalid", def.Status, def.Reason)
			}
		}
	})
}

func TestGetViewerFactsLeavesOutFactsThatAreNotActive(t *testing.T) {
	forEachFactDialect(t, func(t *testing.T, svc *viewerFactService, db *gorm.DB) {
		registerTrigger(t, db, "raids", "raid", "channel.raid", `{"fields": [{"path": "raiderId", "type": "string", "identity": "viewer"}]}`)
		messages := upsertFact(t, svc, messagesFact(""))
		raids := upsertFact(t, svc, &client.UpsertFactDefinitionRequest{
			Id: "user:fact:raids", Name: "Raids",
			Definition: `{"sources":[{"trigger":"raids:trigger:raid","subject":"raiderId"}],"aggregate":{"fn":"count"}}`,
			WindowKind: "lifetime",
		})
		applyDeltas(t, svc, "e1", factNow, "", false, "v1", opDelta(messages.Id, messages.Revision, "count"), opDelta(raids.Id, raids.Revision, "count"))
		if got := len(viewerFacts(t, svc, "v1").Values); got != 2 {
			t.Fatalf("values while both facts are active = %d, want 2", got)
		}
		if err := db.Exec(`UPDATE triggers SET archived_at = ? WHERE manifest_id = 'raid'`, factNow).Error; err != nil {
			t.Fatalf("archive trigger: %v", err)
		}
		values := viewerFacts(t, svc, "v1").Values
		if len(values) != 1 || values[0].FactId != messages.Id {
			t.Fatalf("values after the raid trigger went away = %v, want messages only", values)
		}
	})
}
