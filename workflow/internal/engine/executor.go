package engine

import (
	"fmt"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type DependencyGraph struct {
	tasks      map[string]*types.TaskDefinition
	dependsOn  map[string][]string // task -> tasks it depends on
	dependents map[string][]string // task -> tasks that depend on it
	inDegree   map[string]int      // number of unresolved dependencies
}

func NewDependencyGraph(tasks []types.TaskDefinition) (*DependencyGraph, error) {
	g := &DependencyGraph{
		tasks:      make(map[string]*types.TaskDefinition),
		dependsOn:  make(map[string][]string),
		dependents: make(map[string][]string),
		inDegree:   make(map[string]int),
	}

	for i := range tasks {
		task := &tasks[i]
		g.tasks[task.ID] = task
		g.dependsOn[task.ID] = task.DependsOn
		g.inDegree[task.ID] = len(task.DependsOn)
	}

	for taskID, deps := range g.dependsOn {
		for _, depID := range deps {
			if _, exists := g.tasks[depID]; !exists {
				return nil, fmt.Errorf("task %s depends on unknown task %s", taskID, depID)
			}
			g.dependents[depID] = append(g.dependents[depID], taskID)
		}
	}

	if cycle := g.detectCycle(); cycle != nil {
		return nil, fmt.Errorf("circular dependency detected: %v", cycle)
	}

	return g, nil
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

		for _, depID := range g.dependsOn[taskID] {
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

	for taskID := range g.tasks {
		if !visited[taskID] {
			if cycle := dfs(taskID); cycle != nil {
				return cycle
			}
		}
	}

	return nil
}

func (g *DependencyGraph) GetReadyTasks(completed map[string]bool) []*types.TaskDefinition {
	ready := make([]*types.TaskDefinition, 0)

	for taskID, task := range g.tasks {
		if completed[taskID] {
			continue
		}

		allDepsComplete := true
		for _, depID := range g.dependsOn[taskID] {
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

func (g *DependencyGraph) GetExecutionOrder() ([]*types.TaskDefinition, error) {
	inDegree := make(map[string]int)
	for k, v := range g.inDegree {
		inDegree[k] = v
	}

	queue := make([]string, 0)
	for taskID, degree := range inDegree {
		if degree == 0 {
			queue = append(queue, taskID)
		}
	}

	order := make([]*types.TaskDefinition, 0, len(g.tasks))

	for len(queue) > 0 {
		taskID := queue[0]
		queue = queue[1:]

		order = append(order, g.tasks[taskID])

		for _, depID := range g.dependents[taskID] {
			inDegree[depID]--
			if inDegree[depID] == 0 {
				queue = append(queue, depID)
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
	task, ok := g.tasks[id]
	return task, ok
}
