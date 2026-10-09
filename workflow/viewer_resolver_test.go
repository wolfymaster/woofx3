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

const chatTrigger = "message.user.twitch"

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
		name     string
		triggers []*dbv1.Trigger
		pattern  string
		want     string
		result   identityLookup
	}{
		{"string identity", []*dbv1.Trigger{moduleTrigger("twitch", "chat", chatTrigger, chatEmits)}, chatTrigger, "chatterId", identityFound},
		{"no trigger with the pattern", []*dbv1.Trigger{moduleTrigger("twitch", "chat", chatTrigger, chatEmits)}, "channel.cheer", "", identityNone},
		{"array identity", []*dbv1.Trigger{moduleTrigger("twitch", "presence", "chat.presence", presence)}, "chat.presence", "", identityNone},
		{"several identities", []*dbv1.Trigger{moduleTrigger("twitch", "raid", "channel.raid", several)}, "channel.raid", "", identityNone},
		{"no identity", []*dbv1.Trigger{moduleTrigger("twitch", "tip", "channel.tip", plain)}, "channel.tip", "", identityNone},
		{"no emits", []*dbv1.Trigger{moduleTrigger("twitch", "tip", "channel.tip", "")}, "channel.tip", "", identityNone},
		{"wildcard pattern by its own pattern", []*dbv1.Trigger{moduleTrigger("twitch", "cheer", "channel.*", cheer)}, "channel.*", "userId", identityFound},
		{"wildcard pattern does not answer for a subject it matches", []*dbv1.Trigger{moduleTrigger("twitch", "cheer", "channel.*", cheer)}, "channel.cheer", "", identityNone},
		{"another pattern matching the same events is not consulted", []*dbv1.Trigger{
			moduleTrigger("twitch", "chat", chatTrigger, chatEmits),
			moduleTrigger("other", "cheer", "message.user.*", cheer),
		}, chatTrigger, "chatterId", identityFound},
		{"agreeing triggers", []*dbv1.Trigger{
			moduleTrigger("twitch", "chat", chatTrigger, chatEmits),
			moduleTrigger("other", "chat", chatTrigger, chatEmits),
		}, chatTrigger, "chatterId", identityFound},
		{"a trigger marking nothing does not vote", []*dbv1.Trigger{
			moduleTrigger("twitch", "chat", chatTrigger, chatEmits),
			moduleTrigger("old", "chat", chatTrigger, plain),
		}, chatTrigger, "chatterId", identityFound},
		{"disagreeing triggers", []*dbv1.Trigger{
			moduleTrigger("twitch", "chat", chatTrigger, chatEmits),
			moduleTrigger("other", "cheer", chatTrigger, cheer),
		}, chatTrigger, "", identityConflict},
		{"an array identity beside a string one", []*dbv1.Trigger{
			moduleTrigger("twitch", "chat", "chat.presence", chatEmits),
			moduleTrigger("twitch", "presence", "chat.presence", presence),
		}, "chat.presence", "", identityConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, result, _ := catalogOf(t, tc.triggers...).lookup(tc.pattern)
			if result != tc.result || got.path != tc.want {
				t.Fatalf("lookup = %q, %v; want %q, %v", got.path, result, tc.want, tc.result)
			}
		})
	}

	if _, result, _ := newTriggerIdentityCatalog().lookup(chatTrigger); result != identityUnknown {
		t.Fatalf("an unloaded catalog answered %v, want identityUnknown", result)
	}
}

func TestTriggerIdentityCatalogReportsUnreadableEmits(t *testing.T) {
	c := newTriggerIdentityCatalog()
	failed := c.replace([]*dbv1.Trigger{
		moduleTrigger("twitch", "chat", chatTrigger, chatEmits),
		moduleTrigger("broken", "thing", chatTrigger, `{"fields":`),
	})
	if _, ok := failed["broken:trigger:thing"]; !ok || len(failed) != 1 {
		t.Fatalf("failed = %v, want the broken trigger alone", failed)
	}
	if got, result, _ := c.lookup(chatTrigger); result != identityFound || got.path != "chatterId" {
		t.Fatalf("lookup = %q, %v; the readable trigger was lost", got.path, result)
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
	return &types.Event{ID: id, Type: chatTrigger, Source: "twitch", Platform: "twitch", Time: time.Now(), Data: data}
}

func chatReader(t *testing.T, db dbv1.ViewerFactService, logger *factLogger) *viewerFactReader {
	t.Helper()
	return newViewerFactReader(db, catalogOf(t, moduleTrigger("twitch", "chat", chatTrigger, chatEmits)), logger)
}

func TestViewerFactReaderMapsFactIDsToPaths(t *testing.T) {
	chatterName := "Wolfy"
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
			{FactId: "platform:fact:shadow", ValueKind: "number", Value: num(1)},
			{FactId: "name:fact:shadow", ValueKind: "number", Value: num(1)},
		}, SubjectName: &chatterName}
	}}
	logger := &factLogger{}
	reader := chatReader(t, db, logger)

	got, err := reader.Viewer(context.Background(), chatTrigger, chatEvent("e1", map[string]any{"chatterId": "u1", "chatterName": "wolfy_old"}))
	if err != nil {
		t.Fatalf("Viewer: %v", err)
	}
	want := map[string]any{
		"id":       "u1",
		"platform": "twitch",
		"name":     "Wolfy",
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

	const reserved = "Fact's owner is a reserved ${viewer.*} key; the fact cannot be read there"
	if _, err := reader.Viewer(context.Background(), chatTrigger, chatEvent("e2", map[string]any{"chatterId": "u1"})); err != nil {
		t.Fatalf("Viewer: %v", err)
	}
	if n := logger.count(warnsOf, reserved); n != 3 {
		t.Fatalf("logged %d reserved-owner facts across two reads, want one line for each of 3", n)
	}
}

func TestViewerNameFallsBackToTheEventsDisplayName(t *testing.T) {
	reader := chatReader(t, &fakeViewerReads{}, &factLogger{})
	got, err := reader.Viewer(context.Background(), chatTrigger, chatEvent("e1", map[string]any{"chatterId": "u1", "chatterName": "wolfy"}))
	if err != nil || got["name"] != "wolfy" {
		t.Fatalf("name = %v (%v), want the event's display name", got["name"], err)
	}
	got, err = reader.Viewer(context.Background(), chatTrigger, chatEvent("e2", map[string]any{"chatterId": "u1"}))
	if _, ok := got["name"]; ok || err != nil {
		t.Fatalf("Viewer = %v (%v), want no name when neither the db nor the event has one", got, err)
	}
}

func TestViewerFactReaderNamesNoViewer(t *testing.T) {
	cheer := `{"fields":[{"path":"userId","type":"string","identity":"viewer","anonymousWhen":"isAnonymous"},` +
		`{"path":"isAnonymous","type":"boolean"}]}`
	conflicting := `{"fields":[{"path":"userId","type":"string","identity":"viewer"}]}`
	catalog := catalogOf(t,
		moduleTrigger("twitch", "chat", chatTrigger, chatEmits),
		moduleTrigger("twitch", "cheer", "channel.cheer", cheer),
		moduleTrigger("twitch", "raid", "channel.raid", chatEmits),
		moduleTrigger("other", "raid", "channel.raid", conflicting))

	for _, tc := range []struct {
		name    string
		trigger string
		event   *types.Event
	}{
		{"no platform", chatTrigger, &types.Event{ID: "e", Type: chatTrigger, Data: map[string]any{"chatterId": "u1"}}},
		{"no trigger", "", chatEvent("e", map[string]any{"chatterId": "u1"})},
		{"unknown trigger", "channel.follow", &types.Event{ID: "e", Type: "channel.follow", Platform: "twitch", Data: map[string]any{"userId": "u1"}}},
		{"conflicting triggers", "channel.raid", &types.Event{ID: "e", Type: "channel.raid", Platform: "twitch", Data: map[string]any{"chatterId": "u1", "userId": "u1"}}},
		{"anonymous", "channel.cheer", &types.Event{ID: "e", Type: "channel.cheer", Platform: "twitch", Data: map[string]any{"userId": "ananonymouscheerer", "isAnonymous": true}}},
		{"identity absent", chatTrigger, chatEvent("e", map[string]any{"message": "hi"})},
		{"identity empty", chatTrigger, chatEvent("e", map[string]any{"chatterId": ""})},
		{"identity not a string", chatTrigger, chatEvent("e", map[string]any{"chatterId": 42})},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := &fakeViewerReads{}
			reader := newViewerFactReader(db, catalog, &factLogger{})
			if got, err := reader.Viewer(context.Background(), tc.trigger, tc.event); got != nil || err != nil {
				t.Fatalf("Viewer = %v, %v; want nil, nil", got, err)
			}
			if db.readCount() != 0 {
				t.Fatal("read facts for an event that names no viewer")
			}
		})
	}

	db := &fakeViewerReads{}
	named, err := newViewerFactReader(db, catalog, &factLogger{}).Viewer(context.Background(), "channel.cheer",
		&types.Event{ID: "e", Type: "channel.cheer", Platform: "twitch", Data: map[string]any{"userId": "u7", "isAnonymous": false}})
	if err != nil || named["id"] != "u7" {
		t.Fatalf("a cheer that is not anonymous named %v (%v)", named["id"], err)
	}
}

func TestViewerFactReaderLogsATriggerConflictOnce(t *testing.T) {
	logger := &factLogger{}
	reader := newViewerFactReader(&fakeViewerReads{}, catalogOf(t,
		moduleTrigger("twitch", "raid", "channel.raid", chatEmits),
		moduleTrigger("other", "raid", "channel.raid", `{"fields":[{"path":"userId","type":"string","identity":"viewer"}]}`)), logger)
	event := &types.Event{ID: "e", Type: "channel.raid", Platform: "twitch", Data: map[string]any{"chatterId": "u1"}}
	for i := 0; i < 3; i++ {
		_, _ = reader.Viewer(context.Background(), "channel.raid", event)
	}
	if n := logger.count(warnsOf, "Triggers disagree on which field names the viewer; ${viewer.*} is missing for their events"); n != 1 {
		t.Fatalf("logged the conflict %d times, want 1", n)
	}
}

func TestViewerFactReaderFailsBeforeTheCatalogLoads(t *testing.T) {
	db := &fakeViewerReads{}
	reader := newViewerFactReader(db, newTriggerIdentityCatalog(), &factLogger{})
	got, err := reader.Viewer(context.Background(), chatTrigger, chatEvent("e", map[string]any{"chatterId": "u1"}))
	if !errors.Is(err, errTriggersNotLoaded) || got != nil {
		t.Fatalf("Viewer = %v, %v; want the catalog not loaded", got, err)
	}
	if db.readCount() != 0 {
		t.Fatal("read facts without knowing the viewer")
	}
}

func TestViewerFactReaderLogsAnsweredErrorsOncePerError(t *testing.T) {
	db := &fakeViewerReads{err: errors.New("internal: db locked")}
	logger := &factLogger{}
	reader := chatReader(t, db, logger)
	const failed = "Viewer facts read failed"

	for i := 0; i < 3; i++ {
		got, err := reader.Viewer(context.Background(), chatTrigger, chatEvent("e", map[string]any{"chatterId": "u1"}))
		if err == nil || !reflect.DeepEqual(got, map[string]any{"id": "u1", "platform": "twitch"}) {
			t.Fatalf("Viewer = %v, %v; want an error and only what the event says", got, err)
		}
	}
	db.fail(errors.New("internal: no such table"))
	_, _ = reader.Viewer(context.Background(), chatTrigger, chatEvent("e", map[string]any{"chatterId": "u1"}))
	if n := logger.count(warnsOf, failed); n != 2 {
		t.Fatalf("logged %d answered failures, want one per distinct error (2)", n)
	}
	if n := logger.count(warnsOf, "Viewer facts unreadable; db proxy unreachable"); n != 0 {
		t.Fatal("an answered error was logged as an outage")
	}
}

func TestViewerFactReaderLogsAnOutageOnceUntilItEnds(t *testing.T) {
	db := &fakeViewerReads{err: &url.Error{Op: "Post", URL: "http://db", Err: errors.New("connection refused")}}
	logger := &factLogger{}
	reader := chatReader(t, db, logger)
	const outage, readable = "Viewer facts unreadable; db proxy unreachable", "Viewer facts readable again"

	for i := 0; i < 3; i++ {
		_, _ = reader.Viewer(context.Background(), chatTrigger, chatEvent("e", map[string]any{"chatterId": "u1"}))
	}
	if n := logger.count(warnsOf, outage); n != 1 {
		t.Fatalf("logged the outage %d times, want 1", n)
	}
	db.fail(nil)
	_, _ = reader.Viewer(context.Background(), chatTrigger, chatEvent("e", map[string]any{"chatterId": "u1"}))
	_, _ = reader.Viewer(context.Background(), chatTrigger, chatEvent("e", map[string]any{"chatterId": "u1"}))
	if n := logger.count(infosOf, readable); n != 1 {
		t.Fatalf("logged the recovery %d times, want 1", n)
	}
}

func TestViewerFactReaderStopsReadingFromAnUnreachableProxy(t *testing.T) {
	db := &fakeViewerReads{err: &url.Error{Op: "Post", URL: "http://db", Err: errors.New("connection refused")}}
	logger := &factLogger{}
	reader := chatReader(t, db, logger)

	for i := 0; i < reader.breaker.threshold+3; i++ {
		_, err := reader.Viewer(context.Background(), chatTrigger, chatEvent("e", map[string]any{"chatterId": "u1"}))
		if err == nil {
			t.Fatal("a failed or skipped read reported no error")
		}
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
			got, _, _ := catalog.lookup(chatTrigger)
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
	if logger.count(warnsOf, "Triggers unavailable; ${viewer.*} cannot name a viewer until they list") != 1 {
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

func TestUnloadedCatalogFailsTriggerConditionsAndLeavesStepsMissing(t *testing.T) {
	logger := &factLogger{}
	app := NewWorkflowApp(logger)
	reads := &fakeViewerReads{}
	app.engine.SetViewerFacts(newViewerFactReader(reads, newTriggerIdentityCatalog(), logger))
	ran := make(chan map[string]any, 4)
	if err := app.engine.RegisterAction("record", func(_ tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		ran <- params
		return nil, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	for _, wf := range []*types.WorkflowDefinition{
		{
			ID: "wf-first-chat", Name: "first chat",
			Trigger: &types.TriggerConfig{Type: "event", Event: chatTrigger,
				Conditions: []types.ConditionConfig{{Field: "${viewer.user.messages}", Operator: "not_exists"}}},
			Tasks: []types.TaskDefinition{{ID: "greet", Type: "action", Action: "record", Parameters: map[string]any{"from": "first-chat"}}},
		},
		{
			ID: "wf-echo", Name: "echo",
			Trigger: &types.TriggerConfig{Type: "event", Event: chatTrigger},
			Tasks: []types.TaskDefinition{{ID: "echo", Type: "action", Action: "record",
				Parameters: map[string]any{"from": "echo", "messages": "${viewer.user.messages}"}}},
		},
	} {
		if err := app.engine.RegisterWorkflow(wf); err != nil {
			t.Fatalf("RegisterWorkflow: %v", err)
		}
	}
	t.Cleanup(func() { _ = app.engine.Stop() })

	app.handleTriggerEvent(chatPayload("e1", "u1"), chatTrigger)
	select {
	case params := <-ran:
		if params["from"] != "echo" || params["messages"] != nil {
			t.Fatalf("ran %v, want only the echo step with missing messages", params)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the workflow without a viewer condition did not run")
	}
	select {
	case params := <-ran:
		t.Fatalf("a viewer condition held while the catalog was not loaded: %v", params)
	case <-time.After(100 * time.Millisecond):
	}
	if reads.readCount() != 0 {
		t.Fatal("read facts without knowing the viewer")
	}
	if n := logger.count(warnsOf, "${viewer.*} unavailable; this run's steps read the viewer's facts as missing"); n != 1 {
		t.Fatalf("the step's missing viewer was logged %d times, want 1", n)
	}
}

func TestTriggerCatalogLoadNowSparesRunItsFirstLoad(t *testing.T) {
	db := &countingModuleService{fakeModuleService: fakeModuleService{triggers: []*dbv1.Trigger{moduleTrigger("twitch", "chat", chatTrigger, chatEmits)}}}
	catalog := newTriggerIdentityCatalog()
	r := newTriggerCatalogReloader(catalog, db, &factLogger{})
	r.interval = time.Hour
	if !r.LoadNow(context.Background(), time.Second) {
		t.Fatal("LoadNow failed")
	}
	if _, result, _ := catalog.lookup(chatTrigger); result != identityFound {
		t.Fatalf("lookup after LoadNow = %v", result)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		r.Run(ctx)
		close(done)
	}()
	time.Sleep(20 * time.Millisecond)
	cancel()
	<-done
	if n := db.listCount(); n != 1 {
		t.Fatalf("listed %d times, want only LoadNow's", n)
	}
}

type countingModuleService struct {
	fakeModuleService
	lists int
}

func (f *countingModuleService) ListTriggers(ctx context.Context, req *dbv1.ListTriggersRequest) (*dbv1.ListTriggersResponse, error) {
	f.mu.Lock()
	f.lists++
	f.mu.Unlock()
	return f.fakeModuleService.ListTriggers(ctx, req)
}

func (f *countingModuleService) listCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lists
}
