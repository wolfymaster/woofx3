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
// "error" means the saved definition is not running as saved. Depending on
// where loading stopped, nothing runs for it (unreadable or refused), it can
// be run by id but never fires on its own (its trigger could not be
// registered), or a previously loaded version is still what runs. Since is
// when the current status and reason began.
type WorkflowHealth struct {
	WorkflowID string               `json:"workflowId"`
	Status     WorkflowHealthStatus `json:"status"`
	Reason     string               `json:"reason,omitempty"`
	Since      time.Time            `json:"since"`
}

// WorkflowHealthTracker remembers the last load outcome of every enabled
// workflow and announces what a client needs to mirror it.
//
// Announcements have two forms. Until the first complete load of the stored
// workflows, nothing is published per workflow; that load ends with one
// snapshot listing every workflow in error, which a client treats as the whole
// truth (anything unlisted is ok). After it, each change is published on its
// own. A workflow loading fine for the first time is not a change a client
// can see -- it had no error to clear -- so it is not published.
//
// The reconciler retries failing workflows on every pass, so the same failure
// is reported over and over. Only a change of status or reason is logged or
// published; a repeat is silent.
type WorkflowHealthTracker struct {
	mu        sync.Mutex
	entries   map[string]WorkflowHealth
	announced bool
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

// SetPublisher attaches the bus. Must be called before AnnounceSnapshot, or
// the snapshot and every change after it go nowhere.
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
	prev, seen := t.entries[workflowID]
	if seen && prev.Status == next.Status && prev.Reason == next.Reason {
		t.mu.Unlock()
		return false
	}
	next.Since = t.now()
	t.entries[workflowID] = next
	// A first load that succeeds changes nothing a client shows.
	announce := t.announced && (seen || next.Status == WorkflowHealthError)
	publisher := t.publisher
	t.mu.Unlock()

	if next.Status == WorkflowHealthError {
		t.logger.Error("workflow not running", "workflow_id", workflowID, "reason", next.Reason)
	} else if seen {
		t.logger.Info("workflow running again", "workflow_id", workflowID)
	}
	if announce {
		t.publishChange(publisher, next)
	}
	return true
}

// Forget drops a workflow the engine is no longer meant to run (deleted or
// disabled). A workflow leaving in error is announced as ok, so a client
// clears the error rather than keeping it for a workflow nobody expects to run.
func (t *WorkflowHealthTracker) Forget(workflowID string) {
	t.forget(func(id string) bool { return id == workflowID })
}

// Retain forgets every workflow not in keep. The reconciler calls it with the
// enabled workflows it just listed, which catches deletes and disables whose
// lifecycle events were missed.
func (t *WorkflowHealthTracker) Retain(keep map[string]struct{}) {
	t.forget(func(id string) bool {
		_, ok := keep[id]
		return !ok
	})
}

// Status returns a workflow's current health, and whether it is tracked.
func (t *WorkflowHealthTracker) Status(workflowID string) (WorkflowHealth, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	entry, ok := t.entries[workflowID]
	return entry, ok
}

// Snapshot returns every tracked workflow, ordered by id.
func (t *WorkflowHealthTracker) Snapshot() []WorkflowHealth {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.snapshotLocked(false)
}

// AnnounceSnapshot publishes the errors-only snapshot once, after the first
// complete load of the stored workflows, and switches to per-change
// announcements. Later calls do nothing, so every successful load pass can
// call it without knowing whether it was the first.
func (t *WorkflowHealthTracker) AnnounceSnapshot() {
	t.mu.Lock()
	if t.announced {
		t.mu.Unlock()
		return
	}
	t.announced = true
	errored := t.snapshotLocked(true)
	publisher := t.publisher
	at := t.now()
	t.mu.Unlock()

	if publisher == nil {
		return
	}
	event := &types.Event{
		ID:     uuid.New().String(),
		Type:   string(cloudevents.SubjectWorkflowHealthSnapshot),
		Source: "workflow",
		Time:   at,
		Data: map[string]any{
			"workflows": healthEntriesData(errored),
			"at":        at.UTC().Format(time.RFC3339Nano),
		},
	}
	if err := publisher.Publish(event); err != nil {
		t.logger.Warn("workflow health snapshot not published", "error", err)
	}
}

// HandleHealthRequest answers a SubjectWorkflowHealthGet request. The request
// body carries nothing.
//
// `loaded` is false until the first complete load of the stored workflows:
// before that the list is partial, and a client replacing its view with it
// would clear errors that still hold.
func (t *WorkflowHealthTracker) HandleHealthRequest() []byte {
	t.mu.Lock()
	body := struct {
		Loaded    bool             `json:"loaded"`
		At        time.Time        `json:"at"`
		Workflows []WorkflowHealth `json:"workflows"`
	}{Loaded: t.announced, At: t.now(), Workflows: t.snapshotLocked(false)}
	t.mu.Unlock()

	reply, err := json.Marshal(body)
	if err != nil {
		// Plain structs cannot fail to marshal; reaching here is a
		// programming error, not a runtime condition to recover from.
		panic(fmt.Sprintf("marshal workflow health: %v", err))
	}
	return reply
}

func (t *WorkflowHealthTracker) forget(drop func(id string) bool) {
	t.mu.Lock()
	var cleared []WorkflowHealth
	for id, entry := range t.entries {
		if !drop(id) {
			continue
		}
		delete(t.entries, id)
		if entry.Status == WorkflowHealthError {
			cleared = append(cleared, WorkflowHealth{WorkflowID: id, Status: WorkflowHealthOK, Since: t.now()})
		}
	}
	announce := t.announced
	publisher := t.publisher
	t.mu.Unlock()

	if !announce {
		return
	}
	for _, entry := range cleared {
		t.publishChange(publisher, entry)
	}
}

func (t *WorkflowHealthTracker) snapshotLocked(errorsOnly bool) []WorkflowHealth {
	out := make([]WorkflowHealth, 0, len(t.entries))
	for _, entry := range t.entries {
		if errorsOnly && entry.Status != WorkflowHealthError {
			continue
		}
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].WorkflowID < out[j].WorkflowID })
	return out
}

// publishChange is called outside t.mu, so two changes to one workflow racing
// each other may reach the bus out of order. Each carries `since`, which a
// client can use to keep the later one. Best-effort: a lost announcement is
// recovered through the health request.
func (t *WorkflowHealthTracker) publishChange(publisher engine.EventPublisher, health WorkflowHealth) {
	if publisher == nil {
		return
	}
	event := &types.Event{
		ID:     uuid.New().String(),
		Type:   string(cloudevents.SubjectWorkflowHealthChanged),
		Source: "workflow",
		Time:   health.Since,
		Data:   healthEntryData(health),
	}
	if err := publisher.Publish(event); err != nil {
		t.logger.Warn("workflow health not published", "workflow_id", health.WorkflowID, "error", err)
	}
}

func healthEntryData(health WorkflowHealth) map[string]any {
	data := map[string]any{
		"workflowId": health.WorkflowID,
		"status":     string(health.Status),
		"since":      health.Since.UTC().Format(time.RFC3339Nano),
	}
	if health.Reason != "" {
		data["reason"] = health.Reason
	}
	return data
}

func healthEntriesData(entries []WorkflowHealth) []map[string]any {
	out := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		out = append(out, healthEntryData(entry))
	}
	return out
}
