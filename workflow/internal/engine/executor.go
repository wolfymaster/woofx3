package engine

import (
	"fmt"
	"slices"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// DependencyGraph orders a run's tasks.
//
// A task waits for what it declares in `dependsOn`, and for two orderings a
// condition implies whether or not they are declared:
//
//   - Every task a condition lists in `onTrue` or `onFalse` waits for that
//     condition. A branch task that ran before its condition settled could not
//     be skipped by it.
//   - A task outside a condition's branches that waits for the condition, or
//     for anything in its branches, waits for everything in its branches. This
//     is what makes the step listed after a condition run after the branch the
//     condition took, whichever of the branch's tasks it was chained from.
//
// A condition's branches include the branches of every condition listed in
// them, at any depth, because a branch not taken skips all of that.
//
// The graph holds copies of the definition's tasks, in declaration order,
// whose DependsOn lists every dependency enforced. Copies, so a run never
// writes into the registered definition, and the full list, so planning that
// reads DependsOn later (planConcurrentRun) sees the implied orderings too.
type DependencyGraph struct {
	tasks    []types.TaskDefinition
	position map[string]int
}

func NewDependencyGraph(defTasks []types.TaskDefinition) (*DependencyGraph, error) {
	g := &DependencyGraph{
		tasks:    make([]types.TaskDefinition, len(defTasks)),
		position: make(map[string]int, len(defTasks)),
	}
	for i := range defTasks {
		id := defTasks[i].ID
		if _, seen := g.position[id]; seen {
			return nil, fmt.Errorf("task id %s is used by more than one task", id)
		}
		g.position[id] = i
		g.tasks[i] = defTasks[i]
		g.tasks[i].DependsOn = nil
	}

	for i := range defTasks {
		for _, depID := range defTasks[i].DependsOn {
			if _, exists := g.position[depID]; !exists {
				return nil, fmt.Errorf("task %s depends on unknown task %s", defTasks[i].ID, depID)
			}
			g.addDependency(i, depID)
		}
	}

	for i := range g.tasks {
		condition := &g.tasks[i]
		if condition.Type != types.TaskTypeCondition {
			continue
		}
		for _, memberID := range slices.Concat(condition.OnTrue, condition.OnFalse) {
			member, exists := g.position[memberID]
			if !exists {
				return nil, fmt.Errorf("condition %s lists unknown task %s", condition.ID, memberID)
			}
			if member == i {
				return nil, fmt.Errorf("condition %s lists itself in its own branch", condition.ID)
			}
			g.addDependency(member, condition.ID)
		}
	}

	// Checked before following branches: a condition that waits on its own
	// branch makes "everything in its branches" unbounded.
	if cycle := g.detectCycle(); cycle != nil {
		return nil, fmt.Errorf("circular dependency detected: %v", cycle)
	}

	g.orderAfterBranches()
	return g, nil
}

func (g *DependencyGraph) addDependency(task int, depID string) {
	if !slices.Contains(g.tasks[task].DependsOn, depID) {
		g.tasks[task].DependsOn = append(g.tasks[task].DependsOn, depID)
	}
}

// orderAfterBranches makes every task that follows a condition wait for all of
// the condition's branches.
//
// A task inside the branches that declares a dependency on a follower keeps
// it: that follower does not also wait for that task, since both orders cannot
// hold. The author's declared order wins over the implied one.
func (g *DependencyGraph) orderAfterBranches() {
	for i := range g.tasks {
		if g.tasks[i].Type != types.TaskTypeCondition {
			continue
		}
		under := g.underCondition(i)
		if len(under) == 0 {
			continue
		}
		inBranch := make(map[int]bool, len(under))
		for _, member := range under {
			inBranch[member] = true
		}
		conditionID := g.tasks[i].ID
		for follower := range g.tasks {
			if follower == i || inBranch[follower] || !g.followsCondition(follower, conditionID, inBranch) {
				continue
			}
			for _, member := range under {
				if !g.reaches(member, follower) {
					g.addDependency(follower, g.tasks[member].ID)
				}
			}
		}
	}
}

// underCondition is every task in a condition's branches, nested conditions'
// branches included, in declaration order.
func (g *DependencyGraph) underCondition(condition int) []int {
	seen := make(map[int]bool)
	var visit func(condition int)
	visit = func(condition int) {
		for _, memberID := range slices.Concat(g.tasks[condition].OnTrue, g.tasks[condition].OnFalse) {
			member := g.position[memberID]
			if seen[member] {
				continue
			}
			seen[member] = true
			if g.tasks[member].Type == types.TaskTypeCondition {
				visit(member)
			}
		}
	}
	visit(condition)

	under := make([]int, 0, len(seen))
	for member := range seen {
		under = append(under, member)
	}
	slices.Sort(under)
	return under
}

func (g *DependencyGraph) followsCondition(task int, conditionID string, inBranch map[int]bool) bool {
	for _, depID := range g.tasks[task].DependsOn {
		if depID == conditionID || inBranch[g.position[depID]] {
			return true
		}
	}
	return false
}

// reaches reports whether task `from` waits, directly or transitively, for
// task `to`.
func (g *DependencyGraph) reaches(from int, to int) bool {
	seen := make(map[int]bool)
	stack := []int{from}
	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, depID := range g.tasks[current].DependsOn {
			dep := g.position[depID]
			if dep == to {
				return true
			}
			if !seen[dep] {
				seen[dep] = true
				stack = append(stack, dep)
			}
		}
	}
	return false
}

func (g *DependencyGraph) detectCycle() []string {
	visited := make(map[string]bool)
	recStack := make(map[string]bool)
	path := make([]string, 0)

	var dfs func(taskID string) []string
	dfs = func(taskID string) []string {
		visited[taskID] = true
		recStack[taskID] = true
		path = append(path, taskID)

		for _, depID := range g.tasks[g.position[taskID]].DependsOn {
			if !visited[depID] {
				if cycle := dfs(depID); cycle != nil {
					return cycle
				}
			} else if recStack[depID] {
				cycleStart := -1
				for i, id := range path {
					if id == depID {
						cycleStart = i
						break
					}
				}
				if cycleStart >= 0 {
					return append(path[cycleStart:], depID)
				}
				return []string{depID, taskID}
			}
		}

		path = path[:len(path)-1]
		recStack[taskID] = false
		return nil
	}

	for i := range g.tasks {
		if !visited[g.tasks[i].ID] {
			if cycle := dfs(g.tasks[i].ID); cycle != nil {
				return cycle
			}
		}
	}

	return nil
}

func (g *DependencyGraph) GetReadyTasks(completed map[string]bool) []*types.TaskDefinition {
	ready := make([]*types.TaskDefinition, 0)

	for i := range g.tasks {
		task := &g.tasks[i]
		if completed[task.ID] {
			continue
		}

		allDepsComplete := true
		for _, depID := range task.DependsOn {
			if !completed[depID] {
				allDepsComplete = false
				break
			}
		}

		if allDepsComplete {
			ready = append(ready, task)
		}
	}

	return ready
}

// GetExecutionOrder is a topological order of the tasks in which, whenever
// more than one task is ready, the one declared first goes first. So a
// definition always runs in the same order, and tasks with no order between
// them run in the order they are written.
func (g *DependencyGraph) GetExecutionOrder() ([]*types.TaskDefinition, error) {
	inDegree := make([]int, len(g.tasks))
	dependents := make([][]int, len(g.tasks))
	for i := range g.tasks {
		inDegree[i] = len(g.tasks[i].DependsOn)
		for _, depID := range g.tasks[i].DependsOn {
			dep := g.position[depID]
			dependents[dep] = append(dependents[dep], i)
		}
	}

	ready := make([]int, 0, len(g.tasks))
	for i, degree := range inDegree {
		if degree == 0 {
			ready = append(ready, i)
		}
	}

	order := make([]*types.TaskDefinition, 0, len(g.tasks))
	for len(ready) > 0 {
		next := slices.Min(ready)
		ready = slices.DeleteFunc(ready, func(i int) bool { return i == next })

		order = append(order, &g.tasks[next])

		for _, dependent := range dependents[next] {
			inDegree[dependent]--
			if inDegree[dependent] == 0 {
				ready = append(ready, dependent)
			}
		}
	}

	if len(order) != len(g.tasks) {
		return nil, fmt.Errorf("could not resolve all dependencies (possible deadlock)")
	}

	return order, nil
}

func (g *DependencyGraph) TaskCount() int {
	return len(g.tasks)
}

func (g *DependencyGraph) GetTask(id string) (*types.TaskDefinition, bool) {
	position, ok := g.position[id]
	if !ok {
		return nil, false
	}
	return &g.tasks[position], true
}
