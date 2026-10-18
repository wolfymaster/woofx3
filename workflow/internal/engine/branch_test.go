package engine

import (
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// stepNode is one entry of a vertical step list as the dashboard shows it: an
// action, or a condition with a step list on each side.
type stepNode struct {
	id        string
	condition bool
	whenTrue  []stepNode
	whenFalse []stepNode
}

func act(id string) stepNode {
	return stepNode{id: id}
}

func cond(id string, whenTrue []stepNode, whenFalse []stepNode) stepNode {
	return stepNode{id: id, condition: true, whenTrue: whenTrue, whenFalse: whenFalse}
}

// branchLayout writes a step list as a flat task list, the way one of the
// dashboard's writers does.
type branchLayout struct {
	name  string
	write func(steps []stepNode) []types.TaskDefinition
}

// Each layout mirrors a writer in woofx3-ui; the engine must run all three as
// the same step list.
var branchLayouts = []branchLayout{
	{name: "nested", write: writeNested},
	{name: "chained", write: writeChained},
	{name: "listed", write: writeListed},
}

func nodeTask(node stepNode) types.TaskDefinition {
	if !node.condition {
		return types.TaskDefinition{ID: node.id, Type: "action", Action: "mark", Parameters: map[string]any{"id": node.id}}
	}
	task := types.TaskDefinition{
		ID:        node.id,
		Type:      "condition",
		Condition: &types.ConditionConfig{Field: "${trigger.data." + node.id + "}", Operator: "eq", Value: true},
	}
	for _, child := range node.whenTrue {
		task.OnTrue = append(task.OnTrue, child.id)
	}
	for _, child := range node.whenFalse {
		task.OnFalse = append(task.OnFalse, child.id)
	}
	return task
}

// writeNested mirrors the editor's flattenSteps (client/src/lib/workflow-tree.ts):
// each step depends on the one before it in its own list, a branch's first step
// on its condition, the step after a condition on the condition, and a
// condition lists only its direct children.
func writeNested(steps []stepNode) []types.TaskDefinition {
	return writeNestedFrom(steps, "")
}

func writeNestedFrom(steps []stepNode, parent string) []types.TaskDefinition {
	out := []types.TaskDefinition{}
	prev := parent
	for _, step := range steps {
		task := nodeTask(step)
		if prev != "" {
			task.DependsOn = []string{prev}
		}
		out = append(out, task)
		prev = step.id
		if step.condition {
			out = append(out, writeNestedFrom(step.whenTrue, step.id)...)
			out = append(out, writeNestedFrom(step.whenFalse, step.id)...)
		}
	}
	return out
}

// writeChained mirrors the setup import (convex/lib/setupImport/compile.ts):
// one dependency chain in reading order, and a condition lists every task
// under each side, nested ones included.
func writeChained(steps []stepNode) []types.TaskDefinition {
	out := []types.TaskDefinition{}
	var write func(steps []stepNode) []string
	write = func(steps []stepNode) []string {
		ids := []string{}
		for _, step := range steps {
			task := nodeTask(step)
			task.OnTrue = nil
			task.OnFalse = nil
			if len(out) > 0 {
				task.DependsOn = []string{out[len(out)-1].ID}
			}
			out = append(out, task)
			at := len(out) - 1
			ids = append(ids, step.id)
			if step.condition {
				onTrue := write(step.whenTrue)
				onFalse := write(step.whenFalse)
				out[at].OnTrue = onTrue
				out[at].OnFalse = onFalse
				ids = append(ids, onTrue...)
				ids = append(ids, onFalse...)
			}
		}
		return ids
	}
	write(steps)
	return out
}

// writeListed mirrors older editor saves: tasks in reading order, every task no
// condition lists depending on the task before it in the flat list, and branch
// tasks depending on nothing.
func writeListed(steps []stepNode) []types.TaskDefinition {
	var flatten func(steps []stepNode) []types.TaskDefinition
	flatten = func(steps []stepNode) []types.TaskDefinition {
		out := []types.TaskDefinition{}
		for _, step := range steps {
			out = append(out, nodeTask(step))
			if step.condition {
				out = append(out, flatten(step.whenTrue)...)
				out = append(out, flatten(step.whenFalse)...)
			}
		}
		return out
	}
	out := flatten(steps)
	listed := map[string]bool{}
	for _, task := range out {
		for _, id := range task.OnTrue {
			listed[id] = true
		}
		for _, id := range task.OnFalse {
			listed[id] = true
		}
	}
	for i := 1; i < len(out); i++ {
		if !listed[out[i].ID] {
			out[i].DependsOn = []string{out[i-1].ID}
		}
	}
	return out
}

// expectedRun walks a step list as a reader would: the steps that run, in
// order, and every step under a side not taken.
func expectedRun(steps []stepNode, results map[string]bool) (ran []string, skipped []string) {
	var walk func(steps []stepNode, taken bool)
	walk = func(steps []stepNode, taken bool) {
		for _, step := range steps {
			if !taken {
				skipped = append(skipped, step.id)
				if step.condition {
					walk(step.whenTrue, false)
					walk(step.whenFalse, false)
				}
				continue
			}
			if !step.condition {
				ran = append(ran, step.id)
				continue
			}
			walk(step.whenTrue, results[step.id])
			walk(step.whenFalse, !results[step.id])
		}
	}
	walk(steps, true)
	return ran, skipped
}

// branchTrace is what one run did, on one clock: when each action started and
// ended, and when each condition settled.
type branchTrace struct {
	mu      sync.Mutex
	clock   int
	started map[string]int
	ended   map[string]int
	settled map[string]int
}

func (b *branchTrace) tick() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.clock++
	return b.clock
}

func (b *branchTrace) RunStarted(*types.WorkflowExecution) {}
func (b *branchTrace) RunSettled(*types.WorkflowExecution) {}
func (b *branchTrace) StepSettled(_ *types.WorkflowExecution, step RunStep) {
	at := b.tick()
	b.mu.Lock()
	defer b.mu.Unlock()
	b.settled[step.TaskID] = at
}

func newBranchTrace() *branchTrace {
	return &branchTrace{started: map[string]int{}, ended: map[string]int{}, settled: map[string]int{}}
}

// runBranchWorkflow runs a definition the way a trigger does and returns the
// execution and its trace. The mark action holds each action open briefly, so
// two actions running together overlap on the trace.
func runBranchWorkflow(t *testing.T, defTasks []types.TaskDefinition, results map[string]bool) (*types.WorkflowExecution, *branchTrace) {
	t.Helper()
	trace := newBranchTrace()
	e := newExecEngine(t)
	e.SetRunRecorder(trace)
	if err := e.RegisterAction("mark", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		id, ok := params["id"].(string)
		if !ok {
			return nil, fmt.Errorf("mark called without an id: %v", params)
		}
		start := trace.tick()
		time.Sleep(3 * time.Millisecond)
		end := trace.tick()
		trace.mu.Lock()
		trace.started[id] = start
		trace.ended[id] = end
		trace.mu.Unlock()
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}

	data := map[string]any{}
	for id, result := range results {
		data[id] = result
	}
	def := &types.WorkflowDefinition{ID: "wf-branches", Name: "branches", Tasks: defTasks}
	event := &types.Event{ID: "e1", Type: "test.start", Source: "test", Time: time.Now(), Data: data}
	execution := e.beginExecution(def, event)
	e.runExecution(def, execution, event)
	return execution, trace
}

// assertRunsLikeAStepList checks one run of `steps` against what a reader of
// the step list expects. `sequential` demands every action run strictly after
// the one before it; without it only the orderings the listed layout can
// express are checked: everything under a condition waits for it, and a root
// step after a condition waits for everything under it.
func assertRunsLikeAStepList(t *testing.T, steps []stepNode, defTasks []types.TaskDefinition, results map[string]bool, sequential bool) {
	t.Helper()
	execution, trace := runBranchWorkflow(t, defTasks, results)
	if execution.Status != types.ExecutionStatusCompleted {
		t.Fatalf("status = %v, want completed (error: %q)", execution.Status, execution.Error)
	}

	ran, skipped := expectedRun(steps, results)
	for _, id := range ran {
		if _, ok := trace.started[id]; !ok {
			t.Errorf("%s did not run", id)
		}
	}
	for _, id := range skipped {
		if _, ok := trace.started[id]; ok {
			t.Errorf("%s ran under a side that was not taken", id)
		}
		if got := execution.Tasks[id]; got == nil || got.Status != types.TaskStatusSkipped {
			t.Errorf("%s status = %+v, want skipped", id, got)
		}
	}

	if sequential {
		for i := 1; i < len(ran); i++ {
			if trace.started[ran[i]] < trace.ended[ran[i-1]] {
				t.Errorf("%s started before %s finished; ran %v", ran[i], ran[i-1], ran)
			}
		}
	}

	var check func(steps []stepNode, root bool)
	check = func(steps []stepNode, root bool) {
		for i, step := range steps {
			if !step.condition {
				continue
			}
			under := map[string]bool{}
			collectUnder(step, under)
			for id := range under {
				if start, ok := trace.started[id]; ok && start < trace.settled[step.id] {
					t.Errorf("%s started before its condition %s settled", id, step.id)
				}
			}
			// The listed layout orders nothing inside a side, so only its root
			// list says what follows a condition.
			followers := steps[i+1:]
			if !sequential && !root {
				followers = nil
			}
			for _, after := range followers {
				afterIDs := map[string]bool{after.id: true}
				collectUnder(after, afterIDs)
				for afterID := range afterIDs {
					start, ok := trace.started[afterID]
					if !ok {
						continue
					}
					for id := range under {
						if end, ran := trace.ended[id]; ran && start < end {
							t.Errorf("%s, listed after condition %s, started before %s under it finished", afterID, step.id, id)
						}
					}
				}
			}
			check(step.whenTrue, false)
			check(step.whenFalse, false)
		}
	}
	check(steps, true)
}

func collectUnder(node stepNode, into map[string]bool) {
	for _, child := range slices.Concat(node.whenTrue, node.whenFalse) {
		into[child.id] = true
		collectUnder(child, into)
	}
}

// threeDeep nests a condition three levels down, with a step after each
// condition at every level.
func threeDeep() []stepNode {
	return []stepNode{
		act("s1"),
		cond("c1",
			[]stepNode{
				act("a1"),
				cond("c2",
					[]stepNode{
						act("b1"),
						cond("c3", []stepNode{act("x1"), act("x2")}, []stepNode{act("y1")}),
						act("b2"),
					},
					[]stepNode{act("b3")},
				),
				act("a2"),
			},
			[]stepNode{act("f1")},
		),
		act("s2"),
	}
}

type branchCase struct {
	name    string
	steps   []stepNode
	results []map[string]bool
}

func everyResult(ids ...string) []map[string]bool {
	out := []map[string]bool{}
	for mask := 0; mask < 1<<len(ids); mask++ {
		results := map[string]bool{}
		for i, id := range ids {
			results[id] = mask&(1<<i) != 0
		}
		out = append(out, results)
	}
	return out
}

func branchCases() []branchCase {
	return []branchCase{
		{name: "three deep", steps: threeDeep(), results: everyResult("c1", "c2", "c3")},
		{
			name:    "both sides then a step",
			steps:   []stepNode{cond("c1", []stepNode{act("t1"), act("t2")}, []stepNode{act("f1"), act("f2")}), act("after")},
			results: everyResult("c1"),
		},
		{
			name:    "empty sides",
			steps:   []stepNode{act("before"), cond("c1", nil, nil), act("after")},
			results: everyResult("c1"),
		},
		{
			name:    "only a true side",
			steps:   []stepNode{cond("c1", []stepNode{act("t1"), act("t2")}, nil), act("after")},
			results: everyResult("c1"),
		},
		{
			name:    "only a false side",
			steps:   []stepNode{cond("c1", nil, []stepNode{act("f1")}), act("after")},
			results: everyResult("c1"),
		},
		{
			name: "condition after a condition",
			steps: []stepNode{
				cond("c1", []stepNode{act("t1")}, []stepNode{act("f1")}),
				cond("c2", []stepNode{act("t2")}, []stepNode{act("f2")}),
				act("after"),
			},
			results: everyResult("c1", "c2"),
		},
		{
			name: "condition ending a side",
			steps: []stepNode{
				cond("c1", []stepNode{act("t1"), cond("c2", []stepNode{act("t2")}, []stepNode{act("f2")})}, nil),
				act("after"),
			},
			results: everyResult("c1", "c2"),
		},
	}
}

func describeResults(results map[string]bool) string {
	ids := make([]string, 0, len(results))
	for id := range results {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	out := ""
	for _, id := range ids {
		out += fmt.Sprintf("%s=%v,", id, results[id])
	}
	return out
}

// Every layout the dashboard writes must run a step list as a reader expects:
// only the sides taken, at any depth, and each step after the one above it.
// The listed layout gives the steps inside a side no order of their own, so
// for it only the orderings around each condition are required.
func TestConditionLayoutsRunLikeAStepList(t *testing.T) {
	for _, layout := range branchLayouts {
		for _, c := range branchCases() {
			for _, results := range c.results {
				t.Run(layout.name+"/"+c.name+"/"+describeResults(results), func(t *testing.T) {
					t.Parallel()
					assertRunsLikeAStepList(t, c.steps, layout.write(c.steps), results, layout.name != "listed")
				})
			}
		}
	}
}

// A condition under a side not taken is skipped, and so is everything under
// it, though it lists only its own children.
func TestSkipPropagatesThroughNestedConditions(t *testing.T) {
	steps := threeDeep()
	results := map[string]bool{"c1": false, "c2": true, "c3": true}
	execution, trace := runBranchWorkflow(t, writeNested(steps), results)
	if execution.Status != types.ExecutionStatusCompleted {
		t.Fatalf("status = %v, want completed (error: %q)", execution.Status, execution.Error)
	}
	for _, id := range []string{"a1", "c2", "b1", "c3", "x1", "x2", "y1", "b2", "b3", "a2"} {
		if _, ran := trace.started[id]; ran {
			t.Errorf("%s ran under the side c1 did not take", id)
		}
		if got := execution.Tasks[id]; got == nil || got.Status != types.TaskStatusSkipped {
			t.Errorf("%s status = %+v, want skipped", id, got)
		}
	}
	for _, id := range []string{"s1", "f1", "s2"} {
		if _, ran := trace.started[id]; !ran {
			t.Errorf("%s did not run", id)
		}
	}
}

func orderIDs(t *testing.T, defTasks []types.TaskDefinition) []string {
	t.Helper()
	graph, err := NewDependencyGraph(defTasks)
	if err != nil {
		t.Fatalf("NewDependencyGraph: %v", err)
	}
	order, err := graph.GetExecutionOrder()
	if err != nil {
		t.Fatalf("GetExecutionOrder: %v", err)
	}
	ids := make([]string, len(order))
	for i, task := range order {
		ids[i] = task.ID
	}
	return ids
}

// The step after a condition depends only on the condition in the nested
// layout, yet must come after everything under it.
func TestStepAfterConditionWaitsForItsBranches(t *testing.T) {
	steps := []stepNode{cond("c1", []stepNode{act("t1"), act("t2")}, []stepNode{act("f1")}), act("after")}
	for range 50 {
		ids := orderIDs(t, writeNested(steps))
		if ids[len(ids)-1] != "after" {
			t.Fatalf("order = %v, want after last", ids)
		}
	}
}

// Branch steps in the listed layout depend on nothing, yet must never run
// before the condition that lists them.
func TestListedBranchStepsWaitForTheirCondition(t *testing.T) {
	steps := []stepNode{act("first"), cond("c1", []stepNode{act("t1")}, []stepNode{act("f1")})}
	defTasks := writeListed(steps)
	for range 50 {
		ids := orderIDs(t, defTasks)
		at := slices.Index(ids, "c1")
		for _, id := range []string{"t1", "f1"} {
			if slices.Index(ids, id) < at {
				t.Fatalf("order = %v, want %s after c1", ids, id)
			}
		}
	}
	for _, result := range []bool{true, false} {
		assertRunsLikeAStepList(t, steps, defTasks, map[string]bool{"c1": result}, false)
	}
}

// Tasks with no order between them run in the order they are declared, every
// time.
func TestExecutionOrderFollowsDeclarationOrder(t *testing.T) {
	defTasks := []types.TaskDefinition{
		{ID: "e", Type: "action"},
		{ID: "d", Type: "action"},
		{ID: "c", Type: "action", DependsOn: []string{"e"}},
		{ID: "b", Type: "action"},
		{ID: "a", Type: "action", DependsOn: []string{"d"}},
	}
	want := []string{"e", "d", "c", "b", "a"}
	for range 50 {
		if got := orderIDs(t, defTasks); !slices.Equal(got, want) {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
}

func TestBranchListingUnknownTaskIsRefused(t *testing.T) {
	_, err := NewDependencyGraph([]types.TaskDefinition{
		{ID: "c1", Type: "condition", OnTrue: []string{"gone"}},
	})
	if err == nil {
		t.Fatal("a condition listing an unknown task was accepted")
	}
}

func TestDuplicateTaskIDIsRefused(t *testing.T) {
	_, err := NewDependencyGraph([]types.TaskDefinition{
		{ID: "a", Type: "action"},
		{ID: "a", Type: "log"},
	})
	if err == nil || !strings.Contains(err.Error(), "task id a is used by more than one task") {
		t.Fatalf("err = %v, want the duplicate id refused", err)
	}
}

// A step graph no run could build is refused when the workflow registers,
// rather than registering and failing every run.
func TestRegisteringAWorkflowWithAnUnbuildableGraphIsRefused(t *testing.T) {
	tests := []struct {
		name  string
		tasks []types.TaskDefinition
		want  string
	}{
		{
			name:  "duplicate task id",
			tasks: []types.TaskDefinition{{ID: "a", Type: "log"}, {ID: "a", Type: "log"}},
			want:  "task id a is used by more than one task",
		},
		{
			name:  "branch lists an unknown task",
			tasks: []types.TaskDefinition{{ID: "c1", Type: "condition", OnTrue: []string{"gone"}}},
			want:  "condition c1 lists unknown task gone",
		},
		{
			name: "condition waits on its own branch",
			tasks: []types.TaskDefinition{
				{ID: "c1", Type: "condition", DependsOn: []string{"a"}, OnTrue: []string{"a"}},
				{ID: "a", Type: "log"},
			},
			want: "circular dependency detected",
		},
		{
			name: "a disabled step still has to fit the graph",
			tasks: []types.TaskDefinition{
				{ID: "a", Type: "log"},
				{ID: "b", Type: "log", Disabled: true, DependsOn: []string{"gone"}},
			},
			want: "task b depends on unknown task gone",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			e := newExecEngine(t)
			err := e.RegisterWorkflow(&types.WorkflowDefinition{
				ID:      "wf-bad",
				Name:    "wf-bad",
				Trigger: &types.TriggerConfig{Type: "event", Event: "channel.cheer"},
				Tasks:   tc.tasks,
			})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to contain %q", err, tc.want)
			}
			if _, err := e.GetWorkflow("wf-bad"); err == nil {
				t.Fatal("the refused workflow was registered")
			}
		})
	}
}

func TestConditionInsideItsOwnBranchIsRefused(t *testing.T) {
	_, err := NewDependencyGraph([]types.TaskDefinition{
		{ID: "c1", Type: "condition", OnTrue: []string{"a"}},
		{ID: "a", Type: "action"},
		{ID: "c2", Type: "condition", DependsOn: []string{"a"}, OnTrue: []string{"c1"}},
	})
	if err == nil {
		t.Fatal("a condition that runs after its own branch was accepted")
	}
}

// A task under a condition that also depends on a step after that condition
// keeps its declared order; the step after does not wait for it.
func TestDeclaredOrderInsideABranchIsKept(t *testing.T) {
	ids := orderIDs(t, []types.TaskDefinition{
		{ID: "c1", Type: "condition", OnTrue: []string{"t1", "t2"}},
		{ID: "t1", Type: "action", DependsOn: []string{"c1"}},
		{ID: "after", Type: "action", DependsOn: []string{"c1"}},
		{ID: "t2", Type: "action", DependsOn: []string{"after"}},
	})
	if want := []string{"c1", "t1", "after", "t2"}; !slices.Equal(ids, want) {
		t.Fatalf("order = %v, want %v", ids, want)
	}
}

// A resume that starts under a condition the original run skipped skips that
// condition's own branches too.
func TestResumeSkipsUnderASkippedCondition(t *testing.T) {
	steps := threeDeep()
	graph, err := NewDependencyGraph(writeNested(steps))
	if err != nil {
		t.Fatalf("NewDependencyGraph: %v", err)
	}
	order, err := graph.GetExecutionOrder()
	if err != nil {
		t.Fatalf("GetExecutionOrder: %v", err)
	}
	recorded := []ReplayStep{
		{TaskID: "s1", Status: string(types.TaskStatusSuccess), Outputs: map[string]any{"ok": true}},
		{TaskID: "c1", Status: string(types.TaskStatusSuccess), Outputs: map[string]any{"result": false}},
		{TaskID: "a1", Status: string(types.TaskStatusSkipped)},
		{TaskID: "c2", Status: string(types.TaskStatusSkipped)},
	}
	_, _, skipped, err := planResume(order, recorded, "b1")
	if err != nil {
		t.Fatalf("planResume: %v", err)
	}
	for _, id := range []string{"b1", "c3", "b2", "b3"} {
		if !skipped[id] {
			t.Errorf("%s not skipped on resume under skipped condition c2", id)
		}
	}
}
