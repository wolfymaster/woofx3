package engine

import (
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// orderHarness records the order `note` steps ran in across every workflow on
// one engine, and what the engine recorded about each run. A step whose `hold`
// parameter names a channel blocks until that channel is closed, so a test can
// keep a run in flight. A `boom` step fails.
type orderHarness struct {
	engine *Engine[execSvcs]
	log    *runLog
	mu     sync.Mutex
	notes  []string
	holds  map[string]chan struct{}
	ran    chan string
}

func newOrderHarness(t *testing.T) *orderHarness {
	t.Helper()
	h := &orderHarness{
		engine: newExecEngine(t),
		log:    newRunLog(),
		holds:  make(map[string]chan struct{}),
		ran:    make(chan string, 16),
	}
	h.engine.SetRunRecorder(h.log)
	if err := h.engine.RegisterAction("boom", func(_ tasks.ActionContext[execSvcs], _ map[string]any) (map[string]any, error) {
		return nil, errors.New("boom")
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	if err := h.engine.RegisterAction("note", func(_ tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		name, _ := params["name"].(string)
		if hold, ok := params["hold"].(string); ok {
			<-h.holds[hold]
		}
		h.mu.Lock()
		h.notes = append(h.notes, name)
		h.mu.Unlock()
		h.ran <- name
		return map[string]any{}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	return h
}

// hold makes a `hold` step naming it block until the test ends or release is
// called.
func (h *orderHarness) hold(t *testing.T, name string) (release func()) {
	t.Helper()
	ch := make(chan struct{})
	h.holds[name] = ch
	var once sync.Once
	release = func() { once.Do(func() { close(ch) }) }
	t.Cleanup(release)
	return release
}

// executionOf is the id of the one run begun for a workflow.
func (h *orderHarness) executionOf(t *testing.T, workflowID string) string {
	t.Helper()
	var found []string
	for id, execution := range h.engine.runs.executions() {
		if execution.WorkflowID == workflowID {
			found = append(found, id)
		}
	}
	if len(found) != 1 {
		t.Fatalf("workflow %s has runs %v, want exactly one", workflowID, found)
	}
	return found[0]
}

func (h *orderHarness) register(t *testing.T, id string, order *int, steps ...map[string]any) {
	t.Helper()
	tasksList := make([]types.TaskDefinition, 0, len(steps))
	for i, parameters := range steps {
		tasksList = append(tasksList, types.TaskDefinition{
			ID:         id + "-" + string(rune('a'+i)),
			Type:       "action",
			Action:     "note",
			Parameters: parameters,
		})
	}
	for i := 1; i < len(tasksList); i++ {
		tasksList[i].DependsOn = []string{tasksList[i-1].ID}
	}
	if err := h.engine.RegisterWorkflow(&types.WorkflowDefinition{
		ID:      id,
		Name:    id,
		Trigger: &types.TriggerConfig{Type: "event", Event: "channel.cheer", Order: order},
		Tasks:   tasksList,
	}); err != nil {
		t.Fatalf("RegisterWorkflow %s: %v", id, err)
	}
}

func (h *orderHarness) waitFor(t *testing.T, count int) []string {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for range count {
		select {
		case <-h.ran:
		case <-deadline:
			t.Fatalf("timed out waiting for %d steps; ran %v", count, h.snapshot())
		}
	}
	return h.snapshot()
}

func (h *orderHarness) snapshot() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return slices.Clone(h.notes)
}

func cheer() *types.Event {
	return &types.Event{ID: "e1", Type: "channel.cheer", Source: "test", Time: time.Now(), Data: map[string]any{"bits": 500}}
}

func orderOf(n int) *int {
	return &n
}

// Ordered workflows run one after another by order, each finishing before the
// next starts, whatever order they were registered in -- the order one
// workflow holding them as consecutive steps would have run them in.
func TestOrderedWorkflowsRunOneAfterAnotherByOrder(t *testing.T) {
	h := newOrderHarness(t)
	h.holds["first"] = make(chan struct{})
	h.register(t, "wf-third", orderOf(2), map[string]any{"name": "third"})
	h.register(t, "wf-first", orderOf(0), map[string]any{"name": "first", "hold": "first"}, map[string]any{"name": "first-2"})
	h.register(t, "wf-second", orderOf(1), map[string]any{"name": "second"})

	if err := h.engine.HandleEvent(cheer()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	// The first workflow is held inside its first step; nothing after it may start.
	time.Sleep(50 * time.Millisecond)
	if got := h.snapshot(); len(got) != 0 {
		t.Fatalf("ran %v while the first ordered workflow was still running", got)
	}
	close(h.holds["first"])

	got := h.waitFor(t, 4)
	want := []string{"first", "first-2", "second", "third"}
	if !slices.Equal(got, want) {
		t.Fatalf("ran %v, want %v", got, want)
	}
}

// Workflows sharing an order run by id, so the order never depends on the
// registry's map iteration.
func TestOrderedWorkflowsWithEqualOrderRunById(t *testing.T) {
	h := newOrderHarness(t)
	h.register(t, "wf-b", orderOf(0), map[string]any{"name": "b"})
	h.register(t, "wf-a", orderOf(0), map[string]any{"name": "a"})
	h.register(t, "wf-c", orderOf(0), map[string]any{"name": "c"})

	if err := h.engine.HandleEvent(cheer()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	if got, want := h.waitFor(t, 3), []string{"a", "b", "c"}; !slices.Equal(got, want) {
		t.Fatalf("ran %v, want %v", got, want)
	}
}

// A workflow without an order does not wait its turn behind ordered ones.
func TestUnorderedWorkflowRunsAlongsideOrderedOnes(t *testing.T) {
	h := newOrderHarness(t)
	h.holds["ordered"] = make(chan struct{})
	h.register(t, "wf-ordered", orderOf(0), map[string]any{"name": "ordered", "hold": "ordered"})
	h.register(t, "wf-free", nil, map[string]any{"name": "free"})

	if err := h.engine.HandleEvent(cheer()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	if got := h.waitFor(t, 1); !slices.Equal(got, []string{"free"}) {
		t.Fatalf("ran %v, want only the unordered workflow while the ordered one is held", got)
	}
	close(h.holds["ordered"])
	h.waitFor(t, 1)
}

// An ordered workflow that matches nothing is passed over rather than holding
// up the ones after it.
func TestOrderedWorkflowWhoseConditionsFailIsPassedOver(t *testing.T) {
	h := newOrderHarness(t)
	h.register(t, "wf-first", orderOf(0), map[string]any{"name": "first"})
	h.register(t, "wf-second", orderOf(1), map[string]any{"name": "second"})
	big := &types.WorkflowDefinition{
		ID:   "wf-big",
		Name: "wf-big",
		Trigger: &types.TriggerConfig{
			Type:       "event",
			Event:      "channel.cheer",
			Order:      orderOf(0),
			Conditions: []types.ConditionConfig{{Field: "${trigger.data.bits}", Operator: "gte", Value: 1000}},
		},
		Tasks: []types.TaskDefinition{{ID: "big", Type: "action", Action: "note", Parameters: map[string]any{"name": "big"}}},
	}
	if err := h.engine.RegisterWorkflow(big); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}

	if err := h.engine.HandleEvent(cheer()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	if got, want := h.waitFor(t, 2), []string{"first", "second"}; !slices.Equal(got, want) {
		t.Fatalf("ran %v, want %v", got, want)
	}
}

// A wait in one ordered workflow pauses only that run: the next starts as soon
// as it pauses.
func TestOrderedWorkflowPausedAtAWaitDoesNotHoldTheRestBack(t *testing.T) {
	h := newOrderHarness(t)
	paused := &types.WorkflowDefinition{
		ID:      "wf-paused",
		Name:    "wf-paused",
		Trigger: &types.TriggerConfig{Type: "event", Event: "channel.cheer", Order: orderOf(0)},
		Tasks: []types.TaskDefinition{
			{ID: "hold", Type: "wait", Wait: &types.WaitConfig{Type: "event", Event: "test.never"}},
			{ID: "after", Type: "action", Action: "note", DependsOn: []string{"hold"}, Parameters: map[string]any{"name": "after"}},
		},
	}
	if err := h.engine.RegisterWorkflow(paused); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	h.register(t, "wf-next", orderOf(1), map[string]any{"name": "next"})

	if err := h.engine.HandleEvent(cheer()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	if got := h.waitFor(t, 1); !slices.Equal(got, []string{"next"}) {
		t.Fatalf("ran %v, want the next workflow while the first waits", got)
	}
}

// A failed ordered run ends its turn like a completed one.
func TestFailedOrderedRunLetsTheNextStart(t *testing.T) {
	h := newOrderHarness(t)
	failing := &types.WorkflowDefinition{
		ID:      "wf-failing",
		Name:    "wf-failing",
		Trigger: &types.TriggerConfig{Type: "event", Event: "channel.cheer", Order: orderOf(0)},
		Tasks:   []types.TaskDefinition{{ID: "explode", Type: "action", Action: "boom"}},
	}
	if err := h.engine.RegisterWorkflow(failing); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	h.register(t, "wf-next", orderOf(1), map[string]any{"name": "next"})

	if err := h.engine.HandleEvent(cheer()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	if got := h.waitFor(t, 1); !slices.Equal(got, []string{"next"}) {
		t.Fatalf("ran %v, want the next workflow after the first failed", got)
	}
	if status := h.log.awaitSettled(t, h.executionOf(t, "wf-failing")); status != types.ExecutionStatusFailed {
		t.Fatalf("first run settled %q, want failed", status)
	}
}

// Cancelling the ordered run in flight ends its turn.
func TestCancelledOrderedRunLetsTheNextStart(t *testing.T) {
	h := newOrderHarness(t)
	h.hold(t, "first")
	h.register(t, "wf-first", orderOf(0), map[string]any{"name": "first", "hold": "first"})
	h.register(t, "wf-next", orderOf(1), map[string]any{"name": "next"})

	if err := h.engine.HandleEvent(cheer()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	first := h.executionOf(t, "wf-first")
	if _, err := h.engine.Cancel(first, "stop it"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if got := h.waitFor(t, 1); !slices.Equal(got, []string{"next"}) {
		t.Fatalf("ran %v, want the next workflow after the first was cancelled", got)
	}
	if status := h.log.awaitSettled(t, first); status != types.ExecutionStatusCancelled {
		t.Fatalf("first run settled %q, want cancelled", status)
	}
}

// A run cancelled while it waits its turn settles at once and never starts;
// the queue moves past it.
func TestCancellingAQueuedOrderedRunSettlesItWithoutStartingIt(t *testing.T) {
	h := newOrderHarness(t)
	release := h.hold(t, "first")
	h.register(t, "wf-first", orderOf(0), map[string]any{"name": "first", "hold": "first"})
	h.register(t, "wf-second", orderOf(1), map[string]any{"name": "second"})
	h.register(t, "wf-third", orderOf(2), map[string]any{"name": "third"})

	if err := h.engine.HandleEvent(cheer()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	second := h.executionOf(t, "wf-second")
	if _, err := h.engine.Cancel(second, "not this one"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if got := h.log.settlements(second); !slices.Equal(got, []types.ExecutionStatus{types.ExecutionStatusCancelled}) {
		t.Fatalf("queued run settlements = %v, want [cancelled] as soon as Cancel returns", got)
	}
	release()

	if got, want := h.waitFor(t, 2), []string{"first", "third"}; !slices.Equal(got, want) {
		t.Fatalf("ran %v, want %v", got, want)
	}
}

// Stopping the engine part-way through the queue starts no further run, and
// records every run it never reached as failed rather than losing it.
func TestStopMidQueueStartsNothingFurtherAndRecordsTheRest(t *testing.T) {
	h := newOrderHarness(t)
	h.engine.stopDrainTimeout = 30 * time.Millisecond
	h.hold(t, "first")
	h.register(t, "wf-first", orderOf(0), map[string]any{"name": "first", "hold": "first"})
	h.register(t, "wf-second", orderOf(1), map[string]any{"name": "second"})
	h.register(t, "wf-third", orderOf(2), map[string]any{"name": "third"})

	if err := h.engine.HandleEvent(cheer()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	if started := h.log.startedCount(); started != 3 {
		t.Fatalf("recorded %d runs as begun, want all 3 when the event matched", started)
	}
	first := h.executionOf(t, "wf-first")
	waitUntil(t, func() bool { return !h.engine.control(first).isQueued() })

	if err := h.engine.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	for _, id := range []string{"wf-first", "wf-second", "wf-third"} {
		execution := h.executionOf(t, id)
		if got := h.log.settlements(execution); !slices.Equal(got, []types.ExecutionStatus{types.ExecutionStatusFailed}) {
			t.Errorf("%s settlements = %v, want [failed] by the time Stop returns", id, got)
		}
		if run, _ := h.engine.GetExecution(execution); run.Error != errEngineStopped.Error() {
			t.Errorf("%s error = %q, want %q", id, run.Error, errEngineStopped)
		}
	}
	time.Sleep(50 * time.Millisecond)
	if got := h.snapshot(); len(got) != 0 {
		t.Fatalf("ran %v after the engine stopped", got)
	}
}

// A sub-workflow step that waits for its sub-workflow pauses the run, which
// ends its turn just as a wait does.
func TestOrderedRunWaitingOnASubWorkflowYieldsItsTurn(t *testing.T) {
	h := newOrderHarness(t)
	h.hold(t, "child")
	child := &types.WorkflowDefinition{
		ID:    "wf-child",
		Name:  "wf-child",
		Tasks: []types.TaskDefinition{{ID: "child", Type: "action", Action: "note", Parameters: map[string]any{"name": "child", "hold": "child"}}},
	}
	if err := h.engine.RegisterWorkflow(child); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	parent := &types.WorkflowDefinition{
		ID:      "wf-parent",
		Name:    "wf-parent",
		Trigger: &types.TriggerConfig{Type: "event", Event: "channel.cheer", Order: orderOf(0)},
		Tasks: []types.TaskDefinition{
			{ID: "call", Type: "workflow", Workflow: &types.WorkflowConfig{WorkflowID: "wf-child", WaitUntilCompletion: true}},
			{ID: "after", Type: "action", Action: "note", DependsOn: []string{"call"}, Parameters: map[string]any{"name": "after"}},
		},
	}
	if err := h.engine.RegisterWorkflow(parent); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	h.register(t, "wf-next", orderOf(1), map[string]any{"name": "next"})

	if err := h.engine.HandleEvent(cheer()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	if got := h.waitFor(t, 1); !slices.Equal(got, []string{"next"}) {
		t.Fatalf("ran %v, want the next workflow while the first waits on its sub-workflow", got)
	}
}

// A run still going when its turn's deadline passes is left running, and the
// next one starts.
func TestOrderedRunThatOverrunsItsTurnLetsTheNextStart(t *testing.T) {
	h := newOrderHarness(t)
	h.engine.SetOrderedTurnTimeout(30 * time.Millisecond)
	release := h.hold(t, "first")
	h.register(t, "wf-first", orderOf(0), map[string]any{"name": "first", "hold": "first"})
	h.register(t, "wf-next", orderOf(1), map[string]any{"name": "next"})

	if err := h.engine.HandleEvent(cheer()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	if got := h.waitFor(t, 1); !slices.Equal(got, []string{"next"}) {
		t.Fatalf("ran %v, want the next workflow once the first overran its turn", got)
	}
	release()
	if got, want := h.waitFor(t, 1), []string{"next", "first"}; !slices.Equal(got, want) {
		t.Fatalf("ran %v, want %v: the overrunning run still finishes", got, want)
	}
}
