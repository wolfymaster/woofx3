package main

import (
	"context"
	"errors"
	"net/url"
	"reflect"
	"sync"
	"testing"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/facts"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

const chatEmits = `{"fields":[` +
	`{"path":"chatterId","type":"string","identity":"viewer","displayName":"chatterName"},` +
	`{"path":"chatterName","type":"string"},{"path":"message","type":"string"}]}`

func moduleTrigger(module, manifestID, event, emits string) *dbv1.Trigger {
	return &dbv1.Trigger{CreatedByRef: module, ManifestId: manifestID, Event: event, Emits: emits}
}

func catalogOf(t *testing.T, triggers ...*dbv1.Trigger) *triggerIdentityCatalog {
	t.Helper()
	c := newTriggerIdentityCatalog()
	if failed := c.replace(triggers); len(failed) != 0 {
		t.Fatalf("replace failed for %v", failed)
	}
	return c
}

func TestTriggerIdentityCatalogLookup(t *testing.T) {
	cheer := `{"fields":[{"path":"userId","type":"string","identity":"viewer","anonymousWhen":"isAnonymous"},` +
		`{"path":"isAnonymous","type":"boolean"}]}`
	presence := `{"fields":[{"path":"chatterIds","type":"array","identity":"viewer"}]}`
	several := `{"fields":[{"path":"fromId","type":"string","identity":"viewer"},{"path":"toId","type":"string","identity":"viewer"}]}`
	plain := `{"fields":[{"path":"amount","type":"number"}]}`

	for _, tc := range []struct {
		name      string
		triggers  []*dbv1.Trigger
		eventType string
		want      string
	}{
		{"string identity", []*dbv1.Trigger{moduleTrigger("twitch", "chat", "message.user.twitch", chatEmits)}, "message.user.twitch", "chatterId"},
		{"no trigger for the event", []*dbv1.Trigger{moduleTrigger("twitch", "chat", "message.user.twitch", chatEmits)}, "channel.cheer", ""},
		{"array identity", []*dbv1.Trigger{moduleTrigger("twitch", "presence", "chat.presence", presence)}, "chat.presence", ""},
		{"several identities", []*dbv1.Trigger{moduleTrigger("twitch", "raid", "channel.raid", several)}, "channel.raid", ""},
		{"no identity", []*dbv1.Trigger{moduleTrigger("twitch", "tip", "channel.tip", plain)}, "channel.tip", ""},
		{"no emits", []*dbv1.Trigger{moduleTrigger("twitch", "tip", "channel.tip", "")}, "channel.tip", ""},
		{"pattern", []*dbv1.Trigger{moduleTrigger("twitch", "cheer", "channel.*", cheer)}, "channel.cheer", "userId"},
		{"agreeing triggers", []*dbv1.Trigger{
			moduleTrigger("twitch", "chat", "message.user.twitch", chatEmits),
			moduleTrigger("other", "chat", "message.user.twitch", chatEmits),
		}, "message.user.twitch", "chatterId"},
		{"a trigger marking nothing does not vote", []*dbv1.Trigger{
			moduleTrigger("twitch", "chat", "message.user.twitch", chatEmits),
			moduleTrigger("old", "chat", "message.user.twitch", plain),
		}, "message.user.twitch", "chatterId"},
		{"disagreeing triggers", []*dbv1.Trigger{
			moduleTrigger("twitch", "chat", "message.user.twitch", chatEmits),
			moduleTrigger("other", "cheer", "message.user.*", cheer),
		}, "message.user.twitch", ""},
		{"an array identity beside a string one", []*dbv1.Trigger{
			moduleTrigger("twitch", "chat", "chat.presence", chatEmits),
			moduleTrigger("twitch", "presence", "chat.presence", presence),
		}, "chat.presence", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := catalogOf(t, tc.triggers...).lookup(tc.eventType)
			if ok != (tc.want != "") || got.path != tc.want {
				t.Fatalf("lookup = %q, %v; want %q", got.path, ok, tc.want)
			}
		})
	}
}

func TestTriggerIdentityCatalogReportsUnreadableEmits(t *testing.T) {
	c := newTriggerIdentityCatalog()
	failed := c.replace([]*dbv1.Trigger{
		moduleTrigger("twitch", "chat", "message.user.twitch", chatEmits),
		moduleTrigger("broken", "thing", "message.user.twitch", `{"fields":`),
	})
	if _, ok := failed["broken:trigger:thing"]; !ok || len(failed) != 1 {
		t.Fatalf("failed = %v, want the broken trigger alone", failed)
	}
	if got, ok := c.lookup("message.user.twitch"); !ok || got.path != "chatterId" {
		t.Fatalf("lookup = %q, %v; the readable trigger was lost", got.path, ok)
	}
}

// fakeViewerReads is the db proxy's fact service with only GetViewerFacts.
type fakeViewerReads struct {
	dbv1.ViewerFactService
	mu    sync.Mutex
	reads []*dbv1.GetViewerFactsRequest
	err   error
	// respond builds each response; nil answers with no values.
	respond func(*dbv1.GetViewerFactsRequest) *dbv1.GetViewerFactsResponse
}

func (f *fakeViewerReads) GetViewerFacts(_ context.Context, req *dbv1.GetViewerFactsRequest) (*dbv1.GetViewerFactsResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reads = append(f.reads, req)
	if f.err != nil {
		return nil, f.err
	}
	if f.respond == nil {
		return &dbv1.GetViewerFactsResponse{}, nil
	}
	return f.respond(req), nil
}

func (f *fakeViewerReads) readCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.reads)
}

func (f *fakeViewerReads) fail(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err = err
}

func num(n float64) *dbv1.FactValue { return &dbv1.FactValue{Num: &n} }
func str(s string) *dbv1.FactValue  { return &dbv1.FactValue{Str: &s} }

func chatEvent(id string, data map[string]any) *types.Event {
	return &types.Event{ID: id, Type: "message.user.twitch", Source: "twitch", Platform: "twitch", Time: time.Now(), Data: data}
}

func TestViewerFactReaderMapsFactIDsToPaths(t *testing.T) {
	db := &fakeViewerReads{respond: func(*dbv1.GetViewerFactsRequest) *dbv1.GetViewerFactsResponse {
		return &dbv1.GetViewerFactsResponse{Values: []*dbv1.ViewerFactValue{
			{FactId: "user:fact:apple_mentions", WindowKind: "lifetime", ValueKind: "number", Value: num(3)},
			{FactId: "twitch_platform:fact:watch_seconds", WindowKind: "session", ValueKind: "number", Value: num(120)},
			{FactId: "user:fact:last_word", WindowKind: "lifetime", ValueKind: "string", Value: str("apple")},
			{FactId: "user:fact:first_seen", WindowKind: "lifetime", ValueKind: "timestamp", Value: num(1.7e12)},
			{FactId: "user:fact:streak", WindowKind: "lifetime", ValueKind: "number", Value: &dbv1.FactValue{Num: num(4).Num, Str: str("s9").Str}},
			{FactId: "user:fact:empty", WindowKind: "lifetime", ValueKind: "number", Value: &dbv1.FactValue{}},
			{FactId: "not-canonical", ValueKind: "number", Value: num(1)},
			{FactId: "user:segment:fans", ValueKind: "number", Value: num(1)},
			{FactId: "id:fact:shadow", ValueKind: "number", Value: num(1)},
		}}
	}}
	reader := newViewerFactReader(db, catalogOf(t, moduleTrigger("twitch", "chat", "message.user.twitch", chatEmits)), &factLogger{})

	got := reader.Viewer(context.Background(), chatEvent("e1", map[string]any{"chatterId": "u1"}))
	want := map[string]any{
		"id":       "u1",
		"platform": "twitch",
		"user": map[string]any{
			"apple_mentions": 3.0,
			"last_word":      "apple",
			"first_seen":     1.7e12,
			"streak":         4.0,
		},
		"twitch_platform": map[string]any{"watch_seconds": 120.0},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Viewer = %v, want %v", got, want)
	}
	if len(db.reads) != 1 || db.reads[0].GetPlatform() != "twitch" || db.reads[0].GetSubjectId() != "u1" {
		t.Fatalf("reads = %v, want one for twitch/u1", db.reads)
	}
}

func TestViewerFactReaderNamesNoViewer(t *testing.T) {
	cheer := `{"fields":[{"path":"userId","type":"string","identity":"viewer","anonymousWhen":"isAnonymous"},` +
		`{"path":"isAnonymous","type":"boolean"}]}`
	catalog := catalogOf(t,
		moduleTrigger("twitch", "chat", "message.user.twitch", chatEmits),
		moduleTrigger("twitch", "cheer", "channel.cheer", cheer))

	for _, tc := range []struct {
		name  string
		event *types.Event
	}{
		{"no platform", &types.Event{ID: "e", Type: "message.user.twitch", Data: map[string]any{"chatterId": "u1"}}},
		{"unknown trigger", &types.Event{ID: "e", Type: "channel.follow", Platform: "twitch", Data: map[string]any{"userId": "u1"}}},
		{"anonymous", &types.Event{ID: "e", Type: "channel.cheer", Platform: "twitch", Data: map[string]any{"userId": "ananonymouscheerer", "isAnonymous": true}}},
		{"identity absent", chatEvent("e", map[string]any{"message": "hi"})},
		{"identity empty", chatEvent("e", map[string]any{"chatterId": ""})},
		{"identity not a string", chatEvent("e", map[string]any{"chatterId": 42})},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := &fakeViewerReads{}
			reader := newViewerFactReader(db, catalog, &factLogger{})
			if got := reader.Viewer(context.Background(), tc.event); got != nil {
				t.Fatalf("Viewer = %v, want nil", got)
			}
			if db.readCount() != 0 {
				t.Fatal("read facts for an event that names no viewer")
			}
		})
	}

	db := &fakeViewerReads{}
	named := newViewerFactReader(db, catalog, &factLogger{}).Viewer(context.Background(),
		&types.Event{ID: "e", Type: "channel.cheer", Platform: "twitch", Data: map[string]any{"userId": "u7", "isAnonymous": false}})
	if named["id"] != "u7" {
		t.Fatalf("a cheer that is not anonymous named %v", named["id"])
	}
}

func TestViewerFactReaderFailureLeavesFactsMissingAndLogsOnce(t *testing.T) {
	db := &fakeViewerReads{err: errors.New("internal: db locked")}
	logger := &factLogger{}
	reader := newViewerFactReader(db, catalogOf(t, moduleTrigger("twitch", "chat", "message.user.twitch", chatEmits)), logger)
	const unreadable, readable = "Viewer facts unreadable; ${viewer.*} facts resolve as missing", "Viewer facts readable again"

	for i := 0; i < 3; i++ {
		got := reader.Viewer(context.Background(), chatEvent("e", map[string]any{"chatterId": "u1"}))
		if !reflect.DeepEqual(got, map[string]any{"id": "u1", "platform": "twitch"}) {
			t.Fatalf("Viewer = %v, want only the viewer's id and platform", got)
		}
	}
	if n := logger.count(warnsOf, unreadable); n != 1 {
		t.Fatalf("logged the failure %d times, want 1", n)
	}

	db.fail(nil)
	reader.Viewer(context.Background(), chatEvent("e", map[string]any{"chatterId": "u1"}))
	reader.Viewer(context.Background(), chatEvent("e", map[string]any{"chatterId": "u1"}))
	if n := logger.count(infosOf, readable); n != 1 {
		t.Fatalf("logged the recovery %d times, want 1", n)
	}
}

func TestViewerFactReaderStopsReadingFromAnUnreachableProxy(t *testing.T) {
	db := &fakeViewerReads{err: &url.Error{Op: "Post", URL: "http://db", Err: errors.New("connection refused")}}
	logger := &factLogger{}
	reader := newViewerFactReader(db, catalogOf(t, moduleTrigger("twitch", "chat", "message.user.twitch", chatEmits)), logger)

	for i := 0; i < reader.breaker.threshold+3; i++ {
		reader.Viewer(context.Background(), chatEvent("e", map[string]any{"chatterId": "u1"}))
	}
	if n := db.readCount(); n != reader.breaker.threshold {
		t.Fatalf("sent %d reads, want %d before the breaker opened", n, reader.breaker.threshold)
	}
	if logger.count(errorsOf, "Viewer fact reads paused; db proxy unreachable") != 1 {
		t.Fatal("pausing reads was not logged once")
	}
}

// fakeModuleService is the db proxy's module service with only ListTriggers.
type fakeModuleService struct {
	dbv1.ModuleService
	mu       sync.Mutex
	triggers []*dbv1.Trigger
	err      error
}

func (f *fakeModuleService) ListTriggers(context.Context, *dbv1.ListTriggersRequest) (*dbv1.ListTriggersResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	return &dbv1.ListTriggersResponse{Triggers: append([]*dbv1.Trigger(nil), f.triggers...)}, nil
}

func (f *fakeModuleService) set(err error, triggers ...*dbv1.Trigger) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err = err
	f.triggers = triggers
}

func TestTriggerCatalogReloaderRetriesThenFollowsTriggerChanges(t *testing.T) {
	db := &fakeModuleService{err: errors.New("connection refused")}
	catalog := newTriggerIdentityCatalog()
	logger := &factLogger{}
	r := newTriggerCatalogReloader(catalog, db, logger)
	r.interval = time.Hour
	r.settle = time.Millisecond
	r.minBackoff = time.Millisecond
	r.maxBackoff = 5 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		r.Run(ctx)
		close(done)
	}()
	defer func() {
		cancel()
		<-done
	}()

	awaitPath := func(want string) {
		t.Helper()
		deadline := time.Now().Add(2 * time.Second)
		for {
			got, _ := catalog.lookup("message.user.twitch")
			if got.path == want {
				return
			}
			if time.Now().After(deadline) {
				t.Fatalf("identity path = %q, want %q", got.path, want)
			}
			time.Sleep(time.Millisecond)
		}
	}

	time.Sleep(10 * time.Millisecond)
	db.set(nil, moduleTrigger("twitch", "chat", "message.user.twitch", chatEmits))
	awaitPath("chatterId")
	if logger.count(warnsOf, "Triggers unavailable; ${viewer.*} resolves as missing until they list") != 1 {
		t.Fatal("the list failure was not logged once across retries")
	}

	db.set(nil, moduleTrigger("twitch", "chat", "message.user.twitch",
		`{"fields":[{"path":"userId","type":"string","identity":"viewer"}]}`))
	for i := 0; i < 5; i++ {
		r.Request()
	}
	awaitPath("userId")

	db.set(nil)
	r.Request()
	awaitPath("")
}

func TestViewerConditionSeesTheTriggeringEvent(t *testing.T) {
	logger := &factLogger{}
	factClient := &fakeFactClient{defs: []facts.FactDefinition{countChatters(1, "message.user.twitch")}}
	// The db answers with a count of the batches applied so far, so a read
	// made before the event's own batch would see one fewer.
	reads := &fakeViewerReads{respond: func(req *dbv1.GetViewerFactsRequest) *dbv1.GetViewerFactsResponse {
		return &dbv1.GetViewerFactsResponse{Values: []*dbv1.ViewerFactValue{
			{FactId: "user:fact:messages", WindowKind: "lifetime", ValueKind: "number", Value: num(float64(factClient.appliedCount()))},
		}}
	}}

	app := NewWorkflowApp(logger)
	app.factCtx = context.Background()
	app.facts = facts.NewProjector(factClient)
	if err := app.facts.Replace(factClient.defs); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	app.engine.SetViewerFacts(newViewerFactReader(reads,
		catalogOf(t, moduleTrigger("twitch", "user_message", "message.user.twitch", chatEmits)), logger))
	greeted := make(chan any, 4)
	if err := app.engine.RegisterAction("greet", func(_ tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		greeted <- params["messages"]
		return nil, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	if err := app.engine.RegisterWorkflow(&types.WorkflowDefinition{
		ID:   "wf-first-message",
		Name: "first message",
		Trigger: &types.TriggerConfig{
			Type:       "event",
			Event:      "message.user.twitch",
			Conditions: []types.ConditionConfig{{Field: "${viewer.user.messages}", Operator: "eq", Value: 1}},
		},
		Tasks: []types.TaskDefinition{{
			ID: "greet", Type: "action", Action: "greet",
			Parameters: map[string]any{"messages": "${viewer.user.messages}"},
		}},
	}); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	t.Cleanup(func() { _ = app.engine.Stop() })

	app.handleTriggerEvent(chatPayload("e1", "u1"), "message.user.twitch")
	select {
	case messages := <-greeted:
		if messages != 1.0 {
			t.Fatalf("the step read %v messages, want 1", messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the first message did not satisfy `${viewer.user.messages} eq 1`")
	}

	app.handleTriggerEvent(chatPayload("e2", "u1"), "message.user.twitch")
	select {
	case messages := <-greeted:
		t.Fatalf("the second message ran the workflow with %v messages", messages)
	case <-time.After(100 * time.Millisecond):
	}
	if n := reads.readCount(); n != 2 {
		t.Fatalf("read the viewer's facts %d times for two events, want 2", n)
	}
}
