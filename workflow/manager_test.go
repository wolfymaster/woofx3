package main

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/cloudevents"
)

func TestConvertDBWorkflow_UnpacksJSONColumns(t *testing.T) {
	dbwf := &dbv1.Workflow{
		Id:          "wf-1",
		Name:        "Test Workflow",
		TriggerJson: `{"type":"event","event":"user.message"}`,
		StepsJson:   `[{"id":"task-1","type":"print","parameters":{"msg":"hi"}}]`,
	}

	got, err := convertDBWorkflowToEngineWorkflow(dbwf)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}

	if got.Trigger == nil {
		t.Fatal("Trigger is nil; expected populated TriggerConfig from trigger_json")
	}
	if got.Trigger.Type != "event" {
		t.Errorf("Trigger.Type = %q, want %q", got.Trigger.Type, "event")
	}
	if got.Trigger.Event != "user.message" {
		t.Errorf("Trigger.Event = %q, want %q", got.Trigger.Event, "user.message")
	}
	if len(got.Tasks) != 1 {
		t.Errorf("len(Tasks) = %d, want 1", len(got.Tasks))
	}
}

func TestConvertDBWorkflow_EmptyJSONColumnsLeaveDefinitionMinimal(t *testing.T) {
	dbwf := &dbv1.Workflow{
		Id:   "wf-2",
		Name: "Empty Workflow",
	}

	got, err := convertDBWorkflowToEngineWorkflow(dbwf)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if got.Trigger != nil {
		t.Errorf("Trigger = %+v, want nil (no trigger_json)", got.Trigger)
	}
	if len(got.Tasks) != 0 {
		t.Errorf("len(Tasks) = %d, want 0 (no steps_json)", len(got.Tasks))
	}
	if got.ID != "wf-2" {
		t.Errorf("ID = %q, want %q", got.ID, "wf-2")
	}
}

func TestConvertDBWorkflow_RejectsMalformedTriggerJSON(t *testing.T) {
	dbwf := &dbv1.Workflow{
		Id:          "wf-3",
		TriggerJson: `{not json`,
	}
	_, err := convertDBWorkflowToEngineWorkflow(dbwf)
	if err == nil {
		t.Fatal("expected error for malformed trigger_json")
	}
}

// hangingWorkflowDB blocks every read until its context ends, recording
// whether that context carried a deadline.
type hangingWorkflowDB struct {
	dbv1.WorkflowService
	mu          sync.Mutex
	hadDeadline []bool
}

func (h *hangingWorkflowDB) hang(ctx context.Context) error {
	_, ok := ctx.Deadline()
	h.mu.Lock()
	h.hadDeadline = append(h.hadDeadline, ok)
	h.mu.Unlock()
	<-ctx.Done()
	return ctx.Err()
}

func (h *hangingWorkflowDB) ListWorkflows(ctx context.Context, _ *dbv1.ListWorkflowsRequest) (*dbv1.ListWorkflowsResponse, error) {
	return nil, h.hang(ctx)
}

func (h *hangingWorkflowDB) GetWorkflow(ctx context.Context, _ *dbv1.GetWorkflowRequest) (*dbv1.WorkflowResponse, error) {
	return nil, h.hang(ctx)
}

func TestManagerReadsFromAHungDbProxyAreBounded(t *testing.T) {
	db := &hangingWorkflowDB{}
	manager := NewWorkflowManager(&countingLogger{}, newRefusingRegistry(), db)
	manager.callTimeout = 50 * time.Millisecond

	done := make(chan error, 1)
	go func() { done <- manager.LoadWorkflowsFromDB(context.Background()) }()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("LoadWorkflowsFromDB = %v, want a deadline error", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("LoadWorkflowsFromDB did not return while the db proxy hung")
	}

	evt, err := cloudevents.WorkflowEvent.WorkflowChangeEvent(cloudevents.OperationUpdated, "wf-1", "test")
	if err != nil {
		t.Fatal(err)
	}
	handled := make(chan struct{})
	go func() {
		manager.HandleWorkflowCreateOrUpdate(evt)
		close(handled)
	}()
	select {
	case <-handled:
	case <-time.After(5 * time.Second):
		t.Fatal("HandleWorkflowCreateOrUpdate did not return while the db proxy hung")
	}

	db.mu.Lock()
	defer db.mu.Unlock()
	if len(db.hadDeadline) != 2 || !db.hadDeadline[0] || !db.hadDeadline[1] {
		t.Fatalf("db reads carried deadlines = %v, want both true", db.hadDeadline)
	}
}
