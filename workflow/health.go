package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type WorkflowHealthStatus string

const (
	WorkflowHealthOK    WorkflowHealthStatus = "ok"
	WorkflowHealthError WorkflowHealthStatus = "error"
)

// WorkflowHealth is whether the engine could load a stored workflow.
//
// "error" means the saved definition is not the one running: nothing runs for
// a workflow the engine never loaded, and a failed update leaves the previously
// loaded version in place. Since is when the current status and reason began.
type WorkflowHealth struct {
	WorkflowID string               `json:"workflowId"`
	Status     WorkflowHealthStatus `json:"status"`
	Reason     string               `json:"reason,omitempty"`
	Since      time.Time            `json:"since"`
}

// WorkflowHealthTracker remembers the last load outcome of every enabled
// workflow and announces changes.
//
// The reconciler retries a workflow that failed to load on every pass, so the
// same failure is reported over and over. Only a change of status or reason is
// logged and published; a repeat is silent. That keeps the log readable and
// makes every published event something a consumer should act on.
type WorkflowHealthTracker struct {
	mu        sync.Mutex
	entries   map[string]WorkflowHealth
	publisher engine.EventPublisher
	logger    tasks.Logger
	now       func() time.Time
}

func NewWorkflowHealthTracker(logger tasks.Logger) *WorkflowHealthTracker {
	return &WorkflowHealthTracker{
		entries: make(map[string]WorkflowHealth),
		logger:  logger,
		now:     time.Now,
	}
}

// SetPublisher attaches the bus. Changes recorded before this are kept but
// not announced; a consumer that missed them reads them with Snapshot.
func (t *WorkflowHealthTracker) SetPublisher(publisher engine.EventPublisher) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.publisher = publisher
}

// Record stores the outcome of loading a workflow: nil for loaded, the
// refusal otherwise. Returns whether the health changed.
func (t *WorkflowHealthTracker) Record(workflowID string, loadErr error) bool {
	if workflowID == "" {
		panic("workflow health recorded without a workflow id")
	}

	next := WorkflowHealth{WorkflowID: workflowID, Status: WorkflowHealthOK}
	if loadErr != nil {
		next.Status = WorkflowHealthError
		next.Reason = loadErr.Error()
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	prev, seen := t.entries[workflowID]
	if seen && prev.Status == next.Status && prev.Reason == next.Reason {
		return false
	}
	next.Since = t.now()
	t.entries[workflowID] = next

	if next.Status == WorkflowHealthError {
		t.logger.Error("workflow not running", "workflow_id", workflowID, "reason", next.Reason)
	} else if seen {
		t.logger.Info("workflow running again", "workflow_id", workflowID)
	}

	// Published even for a workflow's first successful load: the engine keeps
	// no health across restarts, so a consumer still showing an error from
	// before one only learns it cleared from this.
	t.publishLocked(next)
	return true
}

// Forget drops a workflow the engine is no longer meant to run (deleted or
// disabled). A workflow leaving in error is announced as ok, so a consumer
// clears the error rather than keeping it for a workflow nobody expects to run.
func (t *WorkflowHealthTracker) Forget(workflowID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.forgetLocked(workflowID)
}

// Retain forgets every workflow not in keep. The reconciler calls it with the
// enabled workflows it just listed, which catches deletes and disables whose
// lifecycle events were missed.
func (t *WorkflowHealthTracker) Retain(keep map[string]struct{}) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for id := range t.entries {
		if _, ok := keep[id]; !ok {
			t.forgetLocked(id)
		}
	}
}

// Snapshot returns every tracked workflow, ordered by id.
func (t *WorkflowHealthTracker) Snapshot() []WorkflowHealth {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]WorkflowHealth, 0, len(t.entries))
	for _, entry := range t.entries {
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].WorkflowID < out[j].WorkflowID })
	return out
}

// HandleHealthRequest answers a SubjectWorkflowHealthGet request. The request
// body carries nothing.
func (t *WorkflowHealthTracker) HandleHealthRequest() []byte {
	reply, err := json.Marshal(struct {
		Workflows []WorkflowHealth `json:"workflows"`
	}{Workflows: t.Snapshot()})
	if err != nil {
		// A slice of plain structs cannot fail to marshal; reaching here is a
		// programming error, not a runtime condition to recover from.
		panic(fmt.Sprintf("marshal workflow health: %v", err))
	}
	return reply
}

func (t *WorkflowHealthTracker) forgetLocked(workflowID string) {
	prev, seen := t.entries[workflowID]
	if !seen {
		return
	}
	delete(t.entries, workflowID)
	if prev.Status == WorkflowHealthError {
		t.publishLocked(WorkflowHealth{WorkflowID: workflowID, Status: WorkflowHealthOK, Since: t.now()})
	}
}

// publishLocked runs under t.mu so two changes to one workflow reach the bus
// in the order they were recorded. Best-effort: a lost announcement is
// recovered by Snapshot, and is no reason to stop loading workflows.
func (t *WorkflowHealthTracker) publishLocked(health WorkflowHealth) {
	if t.publisher == nil {
		return
	}
	data := map[string]any{
		"workflowId": health.WorkflowID,
		"status":     string(health.Status),
		"since":      health.Since.UTC().Format(time.RFC3339Nano),
	}
	if health.Reason != "" {
		data["reason"] = health.Reason
	}
	event := &types.Event{
		ID:     uuid.New().String(),
		Type:   string(cloudevents.SubjectWorkflowHealthChanged),
		Source: "workflow",
		Time:   health.Since,
		Data:   data,
	}
	if err := t.publisher.Publish(event); err != nil {
		t.logger.Warn("workflow health not published", "workflow_id", health.WorkflowID, "error", err)
	}
}
