package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
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

func newTestTracker() (*WorkflowHealthTracker, *capturingPublisher, *countingLogger) {
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

func TestHealth_FirstSuccessfulLoadIsPublishedButNotLogged(t *testing.T) {
	tracker, publisher, logger := newTestTracker()

	tracker.Record("wf-1", nil)

	if len(publisher.events) != 1 {
		t.Fatalf("published = %d, want 1", len(publisher.events))
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
	tracker, _, _ := newTestTracker()
	tracker.Record("b", nil)
	tracker.Record("a", errors.New("broken"))

	var reply struct {
		Workflows []map[string]any `json:"workflows"`
	}
	if err := json.Unmarshal(tracker.HandleHealthRequest(), &reply); err != nil {
		t.Fatal(err)
	}
	if len(reply.Workflows) != 2 {
		t.Fatalf("workflows = %v", reply.Workflows)
	}
	first := reply.Workflows[0]
	if first["workflowId"] != "a" || first["status"] != "error" || first["reason"] != "broken" || first["since"] == nil {
		t.Errorf("first = %v", first)
	}
	if _, has := reply.Workflows[1]["reason"]; has {
		t.Errorf("ok entry carries a reason: %v", reply.Workflows[1])
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
// validation would for a step naming a missing action.
type refusingRegistry struct {
	registered map[string]*types.WorkflowDefinition
	refuse     map[string]error
}

func (r *refusingRegistry) List() []*types.WorkflowDefinition {
	out := make([]*types.WorkflowDefinition, 0, len(r.registered))
	for _, def := range r.registered {
		out = append(out, def)
	}
	return out
}

func (r *refusingRegistry) Register(def *types.WorkflowDefinition) error {
	if err, ok := r.refuse[def.ID]; ok {
		return err
	}
	r.registered[def.ID] = def
	return nil
}

func (r *refusingRegistry) Remove(id string) error {
	delete(r.registered, id)
	return nil
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
	registry := &refusingRegistry{
		registered: map[string]*types.WorkflowDefinition{},
		refuse:     map[string]error{"bad": errors.New(`task "t1": unknown action "print"`)},
	}
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
	// One "ok" for good, one "error" for bad; the two retries of bad are silent.
	if len(publisher.events) != 2 {
		t.Fatalf("published = %d, want 2", len(publisher.events))
	}

	delete(registry.refuse, "bad")
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
	registry := &refusingRegistry{registered: map[string]*types.WorkflowDefinition{}, refuse: map[string]error{}}
	reconciler := newReconciler(manager, registry, db, logger, time.Minute)

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
