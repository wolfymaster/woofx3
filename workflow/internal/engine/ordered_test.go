package engine

import (
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// orderHarness records the order `note` steps ran in across every workflow on
// one engine. A step whose `hold` parameter names a channel blocks until that
// channel is closed, so a test can keep a run in flight.
type orderHarness struct {
	engine *Engine[execSvcs]
	mu     sync.Mutex
	notes  []string
	holds  map[string]chan struct{}
	ran    chan string
}

func newOrderHarness(t *testing.T) *orderHarness {
	t.Helper()
	h := &orderHarness{
		engine: newExecEngine(t),
		holds:  make(map[string]chan struct{}),
		ran:    make(chan string, 16),
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
