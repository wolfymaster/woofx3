package engine

import (
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func action(id string, dependsOn ...string) *types.TaskDefinition {
	return &types.TaskDefinition{ID: id, Type: "action", Action: "print", DependsOn: dependsOn}
}

func typed(id, taskType string) *types.TaskDefinition {
	return &types.TaskDefinition{ID: id, Type: taskType}
}

func TestIndependentActionsFormOneRun(t *testing.T) {
	order := []*types.TaskDefinition{action("a", "rule_1"), action("b", "rule_1")}
	run := planConcurrentRun(order, 0, nil, DefaultMaxConcurrentTasks)
	if run.Len() != 2 {
		t.Errorf("run length = %d, want 2 — a and b declare no dependency on each other", run.Len())
	}
}

func TestADependentTaskEndsTheRun(t *testing.T) {
	order := []*types.TaskDefinition{action("a"), action("b", "a")}
	run := planConcurrentRun(order, 0, nil, DefaultMaxConcurrentTasks)
	if run.Len() != 1 {
		t.Errorf("run length = %d, want 1 — b depends on a", run.Len())
	}
}

// The hazard the issue names: a task reading a sibling's exports without
// declaring dependsOn works today only because the sorted order happened to
// put them in sequence. Running those concurrently would turn a working
// workflow into a race.
func TestAnUndeclaredExportReferenceEndsTheRun(t *testing.T) {
	b := action("b")
	b.Parameters = map[string]any{"text": "value was ${a.result}"}
	order := []*types.TaskDefinition{action("a"), b}
	run := planConcurrentRun(order, 0, nil, DefaultMaxConcurrentTasks)
	if run.Len() != 1 {
		t.Errorf("run length = %d, want 1 — b reads ${a.result} without declaring it", run.Len())
	}
}

func TestAnUndeclaredReferenceIsFoundAtAnyNesting(t *testing.T) {
	b := action("b")
	b.Parameters = map[string]any{
		"options": map[string]any{"list": []any{"x", map[string]any{"deep": "${a.result}"}}},
	}
	order := []*types.TaskDefinition{action("a"), b}
	if run := planConcurrentRun(order, 0, nil, DefaultMaxConcurrentTasks); run.Len() != 1 {
		t.Errorf("run length = %d, want 1 — the reference is nested, not absent", run.Len())
	}
}

// The same hazard seen from the other side: an earlier member referencing a
// later candidate is equally a race.
func TestAReferenceFromTheEarlierTaskAlsoEndsTheRun(t *testing.T) {
	a := action("a")
	a.Parameters = map[string]any{"text": "${b.result}"}
	order := []*types.TaskDefinition{a, action("b")}
	if run := planConcurrentRun(order, 0, nil, DefaultMaxConcurrentTasks); run.Len() != 1 {
		t.Errorf("run length = %d, want 1 — a reads ${b.result}", run.Len())
	}
}

func TestAConditionReferenceEndsTheRun(t *testing.T) {
	b := action("b")
	b.Conditions = []types.ConditionConfig{{Field: "${a.result}", Operator: "eq", Value: true}}
	order := []*types.TaskDefinition{action("a"), b}
	if run := planConcurrentRun(order, 0, nil, DefaultMaxConcurrentTasks); run.Len() != 1 {
		t.Errorf("run length = %d, want 1 — b's guard reads a", run.Len())
	}
}

// wait and workflow tasks suspend the whole execution and resume by index;
// condition tasks decide which later tasks are skipped. None can sit inside a
// set of tasks with no defined order between them.
func TestSuspendingAndBranchingTasksNeverRunConcurrently(t *testing.T) {
	for _, taskType := range []string{"wait", "workflow", "condition"} {
		order := []*types.TaskDefinition{typed("a", taskType), action("b")}
		if run := planConcurrentRun(order, 0, nil, DefaultMaxConcurrentTasks); run.Len() != 1 {
			t.Errorf("%s: run length = %d, want 1", taskType, run.Len())
		}
		order = []*types.TaskDefinition{action("a"), typed("b", taskType)}
		if run := planConcurrentRun(order, 0, nil, DefaultMaxConcurrentTasks); run.Len() != 1 {
			t.Errorf("%s as candidate: run length = %d, want 1", taskType, run.Len())
		}
	}
}

func TestTheRunStopsAtTheConcurrencyCap(t *testing.T) {
	order := []*types.TaskDefinition{action("a"), action("b"), action("c"), action("d")}
	if run := planConcurrentRun(order, 0, nil, 2); run.Len() != 2 {
		t.Errorf("run length = %d, want 2 — the cap bounds the run", run.Len())
	}
}

func TestASkippedTaskIsNotRunConcurrently(t *testing.T) {
	order := []*types.TaskDefinition{action("a"), action("b")}
	skipped := map[string]bool{"b": true}
	if run := planConcurrentRun(order, 0, skipped, DefaultMaxConcurrentTasks); run.Len() != 1 {
		t.Errorf("run length = %d, want 1 — b is on a branch that was not taken", run.Len())
	}
}

func TestAFanOutFormsOneRunUpToTheCap(t *testing.T) {
	order := make([]*types.TaskDefinition, 0, 5)
	for _, id := range []string{"a", "b", "c", "d", "e"} {
		order = append(order, action(id, "rule_1"))
	}
	if run := planConcurrentRun(order, 0, nil, DefaultMaxConcurrentTasks); run.Len() != 5 {
		t.Errorf("run length = %d, want 5 — all five share a dependency and none reference each other", run.Len())
	}
}

func TestPlanningPastTheEndYieldsAnEmptyRun(t *testing.T) {
	order := []*types.TaskDefinition{action("a")}
	if run := planConcurrentRun(order, 1, nil, DefaultMaxConcurrentTasks); run.Len() != 0 {
		t.Errorf("run length = %d, want 0", run.Len())
	}
}

// A task naming a prefix of another id must not be mistaken for a reference
// to it -- ${ab.x} is not a reference to task "a".
func TestAPrefixIsNotMistakenForAReference(t *testing.T) {
	b := action("b")
	b.Parameters = map[string]any{"text": "${ab.result}"}
	order := []*types.TaskDefinition{action("a"), b}
	if run := planConcurrentRun(order, 0, nil, DefaultMaxConcurrentTasks); run.Len() != 2 {
		t.Errorf("run length = %d, want 2 — ${ab.result} does not reference task a", run.Len())
	}
}
