package engine

import (
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func commandEvent() *types.Event {
	return &types.Event{
		ID:     "e1",
		Type:   "chat.command.hug",
		Source: "test",
		Time:   time.Now(),
		Data:   map[string]any{"command": "hug", "argsText": "everyone"},
	}
}

// An action list is written in the order it should happen, so the run must
// honour that order rather than the concurrency a bare dependency graph allows.
func TestRunActionsRunsInOrder(t *testing.T) {
	e := newExecEngine(t)
	var mu sync.Mutex
	var order []string
	done := make(chan struct{})

	if err := e.RegisterAction("record", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		mu.Lock()
		order = append(order, params["mark"].(string))
		finished := len(order) == 3
		mu.Unlock()
		if finished {
			close(done)
		}
		return nil, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}

	executionID, err := e.RunActions(ActionRun{
		Label:         "command:hug",
		ApplicationID: "app-1",
		Actions: []types.TaskDefinition{
			{Action: "record", Parameters: map[string]any{"mark": "first"}},
			{Action: "record", Parameters: map[string]any{"mark": "second"}},
			{Action: "record", Parameters: map[string]any{"mark": "third"}},
		},
		Event: commandEvent(),
	})
	if err != nil {
		t.Fatalf("RunActions: %v", err)
	}
	if executionID == "" {
		t.Fatal("RunActions returned no execution id")
	}

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("actions did not all run")
	}

	mu.Lock()
	defer mu.Unlock()
	for i, want := range []string{"first", "second", "third"} {
		if order[i] != want {
			t.Errorf("action %d = %q, want %q (order: %v)", i, order[i], want, order)
		}
	}
}

// The trigger event reaches the actions: a command's arguments are the whole
// reason an action list run from a command is worth anything.
func TestRunActionsResolvesAgainstTheTriggerEvent(t *testing.T) {
	e := newExecEngine(t)
	seen := make(chan any, 1)

	if err := e.RegisterAction("capture", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		seen <- params["message"]
		return nil, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}

	if _, err := e.RunActions(ActionRun{
		Label:   "command:hug",
		Actions: []types.TaskDefinition{{Action: "capture", Parameters: map[string]any{"message": "hugs ${trigger.data.argsText}"}}},
		Event:   commandEvent(),
	}); err != nil {
		t.Fatalf("RunActions: %v", err)
	}

	select {
	case message := <-seen:
		if message != "hugs everyone" {
			t.Errorf("message = %v, want %q", message, "hugs everyone")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("action never ran")
	}
}

// An ad-hoc run has no workflow row, so recording it would write a run against
// a workflow id that names nothing.
func TestRunActionsIsNotRecorded(t *testing.T) {
	e := newExecEngine(t)
	recorder := &countingRecorder{}
	e.SetRunRecorder(recorder)
	ran := make(chan struct{})

	if err := e.RegisterAction("noop", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		close(ran)
		return nil, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}

	if _, err := e.RunActions(ActionRun{
		Label:   "command:hug",
		Actions: []types.TaskDefinition{{Action: "noop"}},
		Event:   commandEvent(),
	}); err != nil {
		t.Fatalf("RunActions: %v", err)
	}

	select {
	case <-ran:
	case <-time.After(5 * time.Second):
		t.Fatal("action never ran")
	}
	// The run settles after the action returns; give it a moment before asking.
	time.Sleep(100 * time.Millisecond)

	if got := recorder.count(); got != 0 {
		t.Errorf("recorded %d run events, want 0", got)
	}
}

func TestRunActionsRefusesAnEmptyList(t *testing.T) {
	e := newExecEngine(t)
	if _, err := e.RunActions(ActionRun{Label: "command:hug", Event: commandEvent()}); err == nil {
		t.Error("RunActions accepted an empty action list")
	}
	if _, err := e.RunActions(ActionRun{Label: "command:hug", Actions: []types.TaskDefinition{{Action: "noop"}}}); err == nil {
		t.Error("RunActions accepted a run with no trigger event")
	}
}

func TestSequentialTasks(t *testing.T) {
	t.Run("names and chains every task", func(t *testing.T) {
		tasks, err := sequentialTasks([]types.TaskDefinition{{Action: "a"}, {Action: "b"}})
		if err != nil {
			t.Fatalf("sequentialTasks: %v", err)
		}
		if tasks[0].ID != "action-1" || tasks[1].ID != "action-2" {
			t.Errorf("ids = %q, %q", tasks[0].ID, tasks[1].ID)
		}
		if tasks[0].Type != "action" {
			t.Errorf("type = %q, want action", tasks[0].Type)
		}
		if len(tasks[0].DependsOn) != 0 {
			t.Errorf("first task depends on %v, want nothing", tasks[0].DependsOn)
		}
		if len(tasks[1].DependsOn) != 1 || tasks[1].DependsOn[0] != "action-1" {
			t.Errorf("second task depends on %v, want [action-1]", tasks[1].DependsOn)
		}
	})

	t.Run("keeps a dependency the caller declared", func(t *testing.T) {
		tasks, err := sequentialTasks([]types.TaskDefinition{
			{ID: "first", Action: "a"},
			{ID: "alongside", Action: "b", DependsOn: []string{}},
			{ID: "after", Action: "c", DependsOn: []string{"first"}},
		})
		if err != nil {
			t.Fatalf("sequentialTasks: %v", err)
		}
		if len(tasks[1].DependsOn) != 1 || tasks[1].DependsOn[0] != "first" {
			t.Errorf("second task depends on %v, want [first]", tasks[1].DependsOn)
		}
		if len(tasks[2].DependsOn) != 1 || tasks[2].DependsOn[0] != "first" {
			t.Errorf("third task depends on %v, want [first]", tasks[2].DependsOn)
		}
	})

	t.Run("refuses two tasks with one id", func(t *testing.T) {
		if _, err := sequentialTasks([]types.TaskDefinition{{ID: "same", Action: "a"}, {ID: "same", Action: "b"}}); err == nil {
			t.Error("sequentialTasks accepted a duplicate id")
		}
	})
}

type countingRecorder struct {
	mu     sync.Mutex
	events int
}

func (r *countingRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.events
}

func (r *countingRecorder) RunStarted(applicationID string, execution *types.WorkflowExecution) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events++
}

func (r *countingRecorder) RunSettled(applicationID string, execution *types.WorkflowExecution) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events++
}

func (r *countingRecorder) StepSettled(applicationID string, execution *types.WorkflowExecution, step RunStep) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events++
}
