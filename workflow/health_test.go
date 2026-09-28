package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/triggers"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type capturingPublisher struct {
	events []*types.Event
}

func (p *capturingPublisher) Publish(event *types.Event) error {
	p.events = append(p.events, event)
	return nil
}

type countingLogger struct {
	errors []string
	infos  []string
}

func (l *countingLogger) Info(message string, _ ...any)  { l.infos = append(l.infos, message) }
func (l *countingLogger) Error(message string, _ ...any) { l.errors = append(l.errors, message) }
func (l *countingLogger) Debug(string, ...any)           {}
func (l *countingLogger) Warn(string, ...any)            {}

// newTestTracker returns a tracker past its start-up snapshot, which is when
// per-workflow changes are published.
func newTestTracker() (*WorkflowHealthTracker, *capturingPublisher, *countingLogger) {
	tracker, publisher, logger := newBootingTracker()
	tracker.AnnounceSnapshot()
	publisher.events = nil
	return tracker, publisher, logger
}

// newBootingTracker returns a tracker that has not yet finished its first load.
func newBootingTracker() (*WorkflowHealthTracker, *capturingPublisher, *countingLogger) {
	logger := &countingLogger{}
	publisher := &capturingPublisher{}
	tracker := NewWorkflowHealthTracker(logger)
	tracker.SetPublisher(publisher)
	clock := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	tracker.now = func() time.Time {
		clock = clock.Add(time.Second)
		return clock
	}
	return tracker, publisher, logger
}

func eventData(t *testing.T, event *types.Event) map[string]any {
	t.Helper()
	if event.Type != "workflow.health.changed" {
		t.Fatalf("event type = %q, want workflow.health.changed", event.Type)
	}
	return event.Data
}

func TestHealth_BootPublishesOneErrorsOnlySnapshot(t *testing.T) {
	tracker, publisher, logger := newBootingTracker()
	tracker.Record("a", nil)
	tracker.Record("b", errors.New("broken"))
	tracker.Record("c", nil)

	if len(publisher.events) != 0 {
		t.Fatalf("published %d per-workflow events before the snapshot", len(publisher.events))
	}
	if len(logger.errors) != 1 {
		t.Errorf("error logs = %d, want 1: failures are logged even before the snapshot", len(logger.errors))
	}

	tracker.AnnounceSnapshot()
	tracker.AnnounceSnapshot()

	if len(publisher.events) != 1 {
		t.Fatalf("published = %d, want one snapshot", len(publisher.events))
	}
	event := publisher.events[0]
	if event.Type != "workflow.health.snapshot" {
		t.Fatalf("type = %q", event.Type)
	}
	workflows, ok := event.Data["workflows"].([]map[string]any)
	if !ok || len(workflows) != 1 {
		t.Fatalf("workflows = %#v, want only b", event.Data["workflows"])
	}
	if workflows[0]["workflowId"] != "b" || workflows[0]["status"] != "error" || workflows[0]["reason"] != "broken" {
		t.Errorf("entry = %v", workflows[0])
	}
	if _, ok := event.Data["at"].(string); !ok {
		t.Errorf("at missing: %v", event.Data)
	}
}

func TestHealth_RepeatedFailureIsLoggedAndPublishedOnce(t *testing.T) {
	tracker, publisher, logger := newTestTracker()
	refusal := errors.New(`task "t1": unknown action "gone"`)

	if !tracker.Record("wf-1", refusal) {
		t.Fatal("first failure should be a change")
	}
	for i := 0; i < 3; i++ {
		if tracker.Record("wf-1", refusal) {
			t.Fatal("the same failure again should not be a change")
		}
	}

	if len(logger.errors) != 1 {
		t.Errorf("error logs = %d, want 1", len(logger.errors))
	}
	if len(publisher.events) != 1 {
		t.Fatalf("published = %d, want 1", len(publisher.events))
	}
	data := eventData(t, publisher.events[0])
	if data["workflowId"] != "wf-1" || data["status"] != "error" || data["reason"] != refusal.Error() {
		t.Errorf("data = %v", data)
	}
	if _, ok := data["since"].(string); !ok {
		t.Errorf("since missing: %v", data)
	}
}

func TestHealth_ChangedReasonIsANewTransition(t *testing.T) {
	tracker, publisher, _ := newTestTracker()
	tracker.Record("wf-1", errors.New("first"))
	first := tracker.Snapshot()[0].Since

	if !tracker.Record("wf-1", errors.New("second")) {
		t.Fatal("a different reason should be a change")
	}
	if len(publisher.events) != 2 {
		t.Fatalf("published = %d, want 2", len(publisher.events))
	}
	if got := tracker.Snapshot()[0]; got.Reason != "second" || !got.Since.After(first) {
		t.Errorf("snapshot = %+v", got)
	}
}

func TestHealth_RecoveryPublishesOK(t *testing.T) {
	tracker, publisher, logger := newTestTracker()
	tracker.Record("wf-1", errors.New("broken"))

	if !tracker.Record("wf-1", nil) {
		t.Fatal("recovery should be a change")
	}
	if tracker.Record("wf-1", nil) {
		t.Fatal("staying ok should not be a change")
	}

	if len(publisher.events) != 2 {
		t.Fatalf("published = %d, want 2", len(publisher.events))
	}
	data := eventData(t, publisher.events[1])
	if data["status"] != "ok" {
		t.Errorf("status = %v, want ok", data["status"])
	}
	if _, has := data["reason"]; has {
		t.Errorf("ok carries a reason: %v", data)
	}
	if len(logger.infos) != 1 {
		t.Errorf("info logs = %d, want 1 (running again)", len(logger.infos))
	}
}

func TestHealth_FirstSuccessfulLoadIsNeitherPublishedNorLogged(t *testing.T) {
	tracker, publisher, logger := newTestTracker()

	tracker.Record("wf-1", nil)

	if len(publisher.events) != 0 {
		t.Fatalf("published = %d, want 0", len(publisher.events))
	}
	if len(logger.infos) != 0 || len(logger.errors) != 0 {
		t.Errorf("logs = %v / %v, want none", logger.infos, logger.errors)
	}
}

func TestHealth_ForgettingAnErrorAnnouncesOK(t *testing.T) {
	tracker, publisher, _ := newTestTracker()
	tracker.Record("broken", errors.New("broken"))
	tracker.Record("fine", nil)
	publisher.events = nil

	tracker.Forget("broken")
	tracker.Forget("fine")
	tracker.Forget("never-seen")

	if len(publisher.events) != 1 {
		t.Fatalf("published = %d, want 1", len(publisher.events))
	}
	data := eventData(t, publisher.events[0])
	if data["workflowId"] != "broken" || data["status"] != "ok" {
		t.Errorf("data = %v", data)
	}
	if len(tracker.Snapshot()) != 0 {
		t.Errorf("snapshot = %v, want empty", tracker.Snapshot())
	}
}

func TestHealth_RetainForgetsWorkflowsNoLongerEnabled(t *testing.T) {
	tracker, _, _ := newTestTracker()
	tracker.Record("keep", errors.New("broken"))
	tracker.Record("drop", errors.New("broken"))

	tracker.Retain(map[string]struct{}{"keep": {}})

	snapshot := tracker.Snapshot()
	if len(snapshot) != 1 || snapshot[0].WorkflowID != "keep" {
		t.Errorf("snapshot = %+v", snapshot)
	}
}

func TestHealth_RequestReplyShape(t *testing.T) {
	tracker, _, _ := newBootingTracker()
	tracker.Record("b", nil)
	tracker.Record("a", errors.New("broken"))

	type reply struct {
		Loaded    bool             `json:"loaded"`
		At        string           `json:"at"`
		Workflows []map[string]any `json:"workflows"`
	}
	var before reply
	if err := json.Unmarshal(tracker.HandleHealthRequest(), &before); err != nil {
		t.Fatal(err)
	}
	if before.Loaded {
		t.Error("loaded before the first complete load")
	}

	tracker.AnnounceSnapshot()
	var after reply
	if err := json.Unmarshal(tracker.HandleHealthRequest(), &after); err != nil {
		t.Fatal(err)
	}
	if !after.Loaded || after.At == "" || len(after.Workflows) != 2 {
		t.Fatalf("reply = %+v", after)
	}
	first := after.Workflows[0]
	if first["workflowId"] != "a" || first["status"] != "error" || first["reason"] != "broken" || first["since"] == nil {
		t.Errorf("first = %v", first)
	}
	if _, has := after.Workflows[1]["reason"]; has {
		t.Errorf("ok entry carries a reason: %v", after.Workflows[1])
	}
}

func TestHealth_ChangesBeforeThePublisherAreKept(t *testing.T) {
	tracker := NewWorkflowHealthTracker(&countingLogger{})
	tracker.Record("wf-1", errors.New("broken"))

	if got := tracker.Snapshot(); len(got) != 1 || got[0].Status != WorkflowHealthError {
		t.Errorf("snapshot = %+v", got)
	}
}

// fakeWorkflowDB answers ListWorkflows from a fixed list. Every other method
// panics through the nil embedded interface, which is what a test wants if
// the reconciler starts calling something new.
type fakeWorkflowDB struct {
	dbv1.WorkflowService
	workflows []*dbv1.Workflow
}

func (f *fakeWorkflowDB) ListWorkflows(context.Context, *dbv1.ListWorkflowsRequest) (*dbv1.ListWorkflowsResponse, error) {
	return &dbv1.ListWorkflowsResponse{Workflows: f.workflows}, nil
}

// refusingRegistry refuses workflows named in refuse, as registration
// validation would for a step naming a missing action. With storeRefused it
// keeps the definition while refusing, as the real registry does when a
// trigger cannot be registered.
type refusingRegistry struct {
	mu           sync.Mutex
	registered   map[string]*types.WorkflowDefinition
	refuse       map[string]error
	storeRefused bool
}

func newRefusingRegistry() *refusingRegistry {
	return &refusingRegistry{registered: map[string]*types.WorkflowDefinition{}, refuse: map[string]error{}}
}

func (r *refusingRegistry) List() []*types.WorkflowDefinition {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*types.WorkflowDefinition, 0, len(r.registered))
	for _, def := range r.registered {
		out = append(out, def)
	}
	return out
}

func (r *refusingRegistry) Register(def *types.WorkflowDefinition) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	err, refused := r.refuse[def.ID]
	if !refused || r.storeRefused {
		r.registered[def.ID] = def
	}
	return err
}

func (r *refusingRegistry) Remove(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.registered, id)
	return nil
}

func (r *refusingRegistry) RegisterWorkflow(def *types.WorkflowDefinition) error {
	return r.Register(def)
}
func (r *refusingRegistry) UnregisterWorkflow(id string) error { return r.Remove(id) }

func (r *refusingRegistry) setRefusal(id string, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err == nil {
		delete(r.refuse, id)
		return
	}
	r.refuse[id] = err
}

func storedWorkflow(id string) *dbv1.Workflow {
	return &dbv1.Workflow{
		Id:          id,
		Name:        id,
		Enabled:     true,
		TriggerJson: `{"type":"event","event":"channel.follow"}`,
		StepsJson:   `[{"id":"t1","type":"action","action":"print"}]`,
	}
}

func TestReconcile_RetryingAFailingWorkflowLogsOnce(t *testing.T) {
	logger := &countingLogger{}
	publisher := &capturingPublisher{}
	manager := NewWorkflowManager(logger, nil, nil)
	manager.Health().SetPublisher(publisher)

	db := &fakeWorkflowDB{workflows: []*dbv1.Workflow{storedWorkflow("good"), storedWorkflow("bad")}}
	registry := newRefusingRegistry()
	registry.setRefusal("bad", errors.New(`task "t1": unknown action "print"`))
	reconciler := newReconciler(manager, registry, db, logger, time.Minute)

	for i := 0; i < 3; i++ {
		reconciler.reconcileOnce(context.Background())
	}

	if len(logger.errors) != 1 {
		t.Errorf("error logs over three passes = %d, want 1: %v", len(logger.errors), logger.errors)
	}
	if _, ok := registry.registered["good"]; !ok || len(registry.registered) != 1 {
		t.Errorf("registered = %v, want only good", registry.registered)
	}
	// The first pass is the first complete load, so it ends in the snapshot;
	// the two retries of bad are silent.
	if len(publisher.events) != 1 || publisher.events[0].Type != "workflow.health.snapshot" {
		t.Fatalf("published = %+v, want one snapshot", publisher.events)
	}

	registry.setRefusal("bad", nil)
	reconciler.reconcileOnce(context.Background())

	last := eventData(t, publisher.events[len(publisher.events)-1])
	if last["workflowId"] != "bad" || last["status"] != "ok" {
		t.Errorf("last event = %v, want bad recovering", last)
	}
}

func TestReconcile_UnreadableDefinitionIsReportedAndDisabledOneForgotten(t *testing.T) {
	logger := &countingLogger{}
	manager := NewWorkflowManager(logger, nil, nil)
	broken := storedWorkflow("broken")
	broken.StepsJson = "not json"
	db := &fakeWorkflowDB{workflows: []*dbv1.Workflow{broken}}
	reconciler := newReconciler(manager, newRefusingRegistry(), db, logger, time.Minute)

	reconciler.reconcileOnce(context.Background())

	snapshot := manager.Health().Snapshot()
	if len(snapshot) != 1 || snapshot[0].Status != WorkflowHealthError || snapshot[0].Reason == "" {
		t.Fatalf("snapshot = %+v", snapshot)
	}

	broken.Enabled = false
	reconciler.reconcileOnce(context.Background())

	if got := manager.Health().Snapshot(); len(got) != 0 {
		t.Errorf("a disabled workflow is still tracked: %+v", got)
	}
}

func TestManager_DeleteForgetsHealth(t *testing.T) {
	manager := NewWorkflowManager(&countingLogger{}, nil, nil)
	manager.Health().Record("wf-1", errors.New("broken"))

	manager.HandleWorkflowDelete("wf-1")

	if got := manager.Health().Snapshot(); len(got) != 0 {
		t.Errorf("snapshot = %+v", got)
	}
}

func TestReconcile_UnregistrableTriggerIsReportedWithTheRegistrarsReason(t *testing.T) {
	logger := &countingLogger{}
	publisher := &capturingPublisher{}
	manager := NewWorkflowManager(logger, nil, nil)
	manager.Health().SetPublisher(publisher)

	registry := engine.NewWorkflowRegistry()
	composite := triggers.NewCompositeRegistrar()
	composite.Set("schedule", triggers.NewScheduleTriggerRegistrar(nil))
	registry.SetRegistrar(composite)

	badCron := storedWorkflow("bad-cron")
	badCron.TriggerJson = `{"type":"schedule","schedule":"* * *"}`
	hourly := storedWorkflow("hourly")
	hourly.TriggerJson = `{"type":"schedule","schedule":"0 * * * *"}`
	db := &fakeWorkflowDB{workflows: []*dbv1.Workflow{badCron, hourly}}
	reconciler := newReconciler(manager, registry, db, logger, time.Minute)

	reconciler.reconcileOnce(context.Background())
	reconciler.reconcileOnce(context.Background())

	byID := map[string]WorkflowHealth{}
	for _, entry := range manager.Health().Snapshot() {
		byID[entry.WorkflowID] = entry
	}
	if got := byID["hourly"]; got.Status != WorkflowHealthOK {
		t.Errorf("hourly = %+v, want ok", got)
	}
	got := byID["bad-cron"]
	if got.Status != WorkflowHealthError || !strings.HasPrefix(got.Reason, `schedule "* * *" is not a valid cron expression`) {
		t.Errorf("bad-cron = %+v", got)
	}
	// The second pass retries bad-cron, which fails the same way: silent.
	if len(publisher.events) != 1 || len(logger.errors) != 1 {
		t.Errorf("published = %d, error logs = %d; want 1 (the snapshot) and 1", len(publisher.events), len(logger.errors))
	}
}

func TestReconcile_RetriesAStoredWorkflowWhoseTriggerWasRefused(t *testing.T) {
	logger := &countingLogger{}
	publisher := &capturingPublisher{}
	manager := NewWorkflowManager(logger, nil, nil)
	manager.Health().SetPublisher(publisher)
	registry := newRefusingRegistry()
	registry.storeRefused = true
	registry.setRefusal("wf-1", errors.New(`cannot subscribe to event "channel.follow": nats: connection closed`))
	db := &fakeWorkflowDB{workflows: []*dbv1.Workflow{storedWorkflow("wf-1")}}
	reconciler := newReconciler(manager, registry, db, logger, time.Minute)

	reconciler.reconcileOnce(context.Background())
	if got, _ := manager.Health().Status("wf-1"); got.Status != WorkflowHealthError {
		t.Fatalf("health = %+v, want error", got)
	}

	registry.setRefusal("wf-1", nil)
	reconciler.reconcileOnce(context.Background())

	if got, _ := manager.Health().Status("wf-1"); got.Status != WorkflowHealthOK {
		t.Errorf("health = %+v, want ok once the subscribe succeeds", got)
	}
	last := eventData(t, publisher.events[len(publisher.events)-1])
	if last["workflowId"] != "wf-1" || last["status"] != "ok" {
		t.Errorf("last event = %v", last)
	}
}

// gatedWorkflowDB serves a stale list, held until release is closed, and a
// fresh row from GetWorkflow: a reconcile pass that read the database just
// before a save, and the lifecycle event for that save.
type gatedWorkflowDB struct {
	dbv1.WorkflowService
	stale     *dbv1.Workflow
	fresh     *dbv1.Workflow
	listing   chan struct{}
	release   chan struct{}
	fetchedMu sync.Mutex
	fetched   bool
}

func (g *gatedWorkflowDB) ListWorkflows(context.Context, *dbv1.ListWorkflowsRequest) (*dbv1.ListWorkflowsResponse, error) {
	close(g.listing)
	<-g.release
	return &dbv1.ListWorkflowsResponse{Workflows: []*dbv1.Workflow{g.stale}}, nil
}

func (g *gatedWorkflowDB) GetWorkflow(context.Context, *dbv1.GetWorkflowRequest) (*dbv1.WorkflowResponse, error) {
	g.fetchedMu.Lock()
	g.fetched = true
	g.fetchedMu.Unlock()
	return &dbv1.WorkflowResponse{Workflow: g.fresh}, nil
}

func TestReconcile_AStaleListCannotOverwriteAFresherLifecycleLoad(t *testing.T) {
	logger := &countingLogger{}
	registry := newRefusingRegistry()
	stale := storedWorkflow("wf-1")
	stale.StepsJson = "not json"
	db := &gatedWorkflowDB{
		stale:   stale,
		fresh:   storedWorkflow("wf-1"),
		listing: make(chan struct{}),
		release: make(chan struct{}),
	}
	manager := NewWorkflowManager(logger, registry, db)
	reconciler := newReconciler(manager, registry, db, logger, time.Minute)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		reconciler.reconcileOnce(context.Background())
	}()
	<-db.listing

	evt, err := cloudevents.WorkflowEvent.WorkflowChangeEvent(cloudevents.OperationUpdated, "wf-1", "test")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		defer wg.Done()
		manager.HandleWorkflowCreateOrUpdate(evt)
	}()

	// Unserialized, the lifecycle load would finish here and the stale pass
	// would then overwrite its ok with the stale row's error.
	time.Sleep(50 * time.Millisecond)
	db.fetchedMu.Lock()
	fetchedDuringPass := db.fetched
	db.fetchedMu.Unlock()
	if fetchedDuringPass {
		t.Error("the lifecycle event read the database while a reconcile pass was applying")
	}
	close(db.release)
	wg.Wait()

	if got, _ := manager.Health().Status("wf-1"); got.Status != WorkflowHealthOK {
		t.Errorf("health = %+v, want ok from the fresher lifecycle load", got)
	}
	if len(registry.List()) != 1 {
		t.Errorf("registered = %v, want the fresh wf-1", registry.List())
	}
}
