package engine

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func chainOf(ids ...string) *types.Event {
	return &types.Event{ID: "e1", Type: "thing.happened", Source: "test", Time: time.Now(), WorkflowChain: strings.Join(ids, ",")}
}

func sameName(id string) string { return id }

func TestAChainShorterThanTheLimitRuns(t *testing.T) {
	ids := make([]string, MaxWorkflowChain-1)
	for i := range ids {
		ids[i] = "wf-a"
	}
	if err := checkWorkflowChain(chainOf(ids...), "wf-a", sameName); err != nil {
		t.Fatalf("a chain of %d is allowed, got %v", len(ids), err)
	}
	if err := checkWorkflowChain(nil, "wf-a", sameName); err != nil {
		t.Fatalf("a run with no trigger event starts a chain, got %v", err)
	}
}

// The error names the loop, so the run history says which workflows to fix.
func TestAChainAtTheLimitIsRefusedAndItsCycleNamed(t *testing.T) {
	var ids []string
	for len(ids) < MaxWorkflowChain {
		ids = append(ids, "wf-a", "wf-b")
	}
	err := checkWorkflowChain(chainOf(ids...), "wf-a", sameName)

	var loop *LoopError
	if !errors.As(err, &loop) {
		t.Fatalf("want a LoopError, got %v", err)
	}
	if got := strings.Join(loop.Cycle, " → "); got != "wf-a → wf-b → wf-a" {
		t.Errorf("cycle = %q", got)
	}
	if len(loop.Path) != MaxWorkflowChain+1 {
		t.Errorf("path has %d links, want the chain plus the refused run", len(loop.Path))
	}
	if !strings.Contains(err.Error(), "wf-a keeps triggering itself") {
		t.Errorf("message = %q", err.Error())
	}
}

func TestALongChainWithNoRepeatIsStillRefused(t *testing.T) {
	ids := make([]string, MaxWorkflowChain)
	for i := range ids {
		ids[i] = "wf-" + string(rune('a'+i))
	}
	err := checkWorkflowChain(chainOf(ids...), "wf-last", sameName)
	var loop *LoopError
	if !errors.As(err, &loop) || len(loop.Cycle) != 0 {
		t.Fatalf("want a LoopError with no cycle, got %v", err)
	}
	if !strings.Contains(err.Error(), "each triggered by the last") {
		t.Errorf("message = %q", err.Error())
	}
}

// settledRuns records every run that finishes, however it finished.
type settledRuns struct {
	mu   sync.Mutex
	runs []types.WorkflowExecution
	done chan struct{}
}

func (r *settledRuns) RunStarted(string, *types.WorkflowExecution)           {}
func (r *settledRuns) StepSettled(string, *types.WorkflowExecution, RunStep) {}
func (r *settledRuns) RunSettled(_ string, execution *types.WorkflowExecution) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runs = append(r.runs, *execution)
	if execution.Status == types.ExecutionStatusFailed && r.done != nil {
		close(r.done)
		r.done = nil
	}
}

func (r *settledRuns) snapshot() []types.WorkflowExecution {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]types.WorkflowExecution{}, r.runs...)
}

// loopbackPublisher hands every event the engine publishes straight back to
// it, as the bus would deliver it to the engine's own trigger subscription.
type loopbackPublisher struct {
	engine    *Engine[execSvcs]
	mu        sync.Mutex
	published []*types.Event
}

func (p *loopbackPublisher) Publish(event *types.Event) error {
	p.mu.Lock()
	p.published = append(p.published, event)
	p.mu.Unlock()
	return p.engine.HandleEvent(event)
}

func selfTriggeringWorkflow() *types.WorkflowDefinition {
	return &types.WorkflowDefinition{
		ID:      "wf-echo",
		Name:    "Echo",
		Trigger: &types.TriggerConfig{Type: "event", Event: "thing.happened"},
		Tasks: []types.TaskDefinition{{
			ID:         "again",
			Type:       "action",
			Action:     "publish_event",
			Parameters: map[string]any{"eventType": "thing.happened"},
		}},
	}
}

// The loop the guard exists for: a workflow whose step publishes the event it
// is triggered by. It runs the limit's worth of times, and the next run is
// recorded failed with the loop as its reason.
func TestAWorkflowThatTriggersItselfIsStoppedAtTheLimit(t *testing.T) {
	engine := newExecEngine(t)
	recorder := &settledRuns{done: make(chan struct{})}
	engine.SetRunRecorder(recorder)
	engine.SetPublisher(&loopbackPublisher{engine: engine})
	if err := engine.RegisterWorkflow(selfTriggeringWorkflow()); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}

	stopped := recorder.done
	if err := engine.HandleEvent(chainOf()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatalf("the loop was not stopped; %d runs settled", len(recorder.snapshot()))
	}

	var completed, failed []types.WorkflowExecution
	for _, run := range recorder.snapshot() {
		if run.Status == types.ExecutionStatusFailed {
			failed = append(failed, run)
		} else {
			completed = append(completed, run)
		}
	}
	if len(completed) != MaxWorkflowChain || len(failed) != 1 {
		t.Fatalf("completed %d and failed %d runs, want %d and 1", len(completed), len(failed), MaxWorkflowChain)
	}
	if !strings.Contains(failed[0].Error, "Echo keeps triggering itself") {
		t.Errorf("refusal = %q", failed[0].Error)
	}
}

// Each way a run causes an event continues the chain of the event it is
// handling: published events, sub-workflow events and the run's own
// lifecycle events alike.
func TestEventsARunCausesCarryItsChain(t *testing.T) {
	engine := newExecEngine(t)
	publisher := &loopbackPublisher{engine: engine}
	engine.SetPublisher(publisher)
	engine.SetRunRecorder(&settledRuns{})

	var subEvent *types.Event
	var subMu sync.Mutex
	subRan := make(chan struct{})
	if err := engine.RegisterAction("capture", func(ctx tasks.ActionContext[execSvcs], _ map[string]any) (map[string]any, error) {
		subMu.Lock()
		subEvent = ctx.TriggerEvent
		subMu.Unlock()
		close(subRan)
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	child := &types.WorkflowDefinition{
		ID:      "wf-child",
		Name:    "Child",
		Trigger: &types.TriggerConfig{Type: "event", Event: "child.run"},
		Tasks:   []types.TaskDefinition{{ID: "capture", Type: "action", Action: "capture"}},
	}
	parent := &types.WorkflowDefinition{
		ID:      "wf-parent",
		Name:    "Parent",
		Trigger: &types.TriggerConfig{Type: "event", Event: "parent.run"},
		Tasks: []types.TaskDefinition{
			{ID: "announce", Type: "action", Action: "publish_event", Parameters: map[string]any{"eventType": "nobody.listens"}},
			{ID: "call", Type: "workflow", DependsOn: []string{"announce"}, Workflow: &types.WorkflowConfig{WorkflowID: "wf-child"}},
		},
	}
	for _, wf := range []*types.WorkflowDefinition{child, parent} {
		if err := engine.RegisterWorkflow(wf); err != nil {
			t.Fatalf("RegisterWorkflow: %v", err)
		}
	}

	engine.executeWorkflow(parent, &types.Event{ID: "e1", Type: "parent.run", Source: "test", Time: time.Now(), WorkflowChain: "wf-root"})
	select {
	case <-subRan:
	case <-time.After(5 * time.Second):
		t.Fatal("the sub-workflow did not run")
	}

	publisher.mu.Lock()
	published := append([]*types.Event{}, publisher.published...)
	publisher.mu.Unlock()
	announced := 0
	for _, event := range published {
		switch {
		case event.Type == "nobody.listens":
			announced++
			if event.WorkflowChain != "wf-root,wf-parent" {
				t.Errorf("published event chained %q, want wf-root,wf-parent", event.WorkflowChain)
			}
		case strings.HasPrefix(event.Type, "workflow.run.") && event.Data["workflowId"] == "wf-parent":
			if event.WorkflowChain != "wf-root,wf-parent" {
				t.Errorf("%s chained %q, want wf-root,wf-parent", event.Type, event.WorkflowChain)
			}
		}
	}
	if announced != 1 {
		t.Errorf("published %d events from the step, want 1", announced)
	}
	subMu.Lock()
	defer subMu.Unlock()
	if subEvent == nil || subEvent.WorkflowChain != "wf-root,wf-parent" {
		t.Errorf("sub-workflow event = %+v, want it chained wf-root,wf-parent", subEvent)
	}
}
