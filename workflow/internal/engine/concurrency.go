package engine

import (
	"fmt"
	"strings"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// DefaultMaxConcurrentTasks bounds how many tasks of one wave run at once.
//
// A workflow fanning out to fifty alerts should not open fifty outbound calls
// simultaneously; the cap turns that into a bounded rolling window without the
// author having to think about it.
const DefaultMaxConcurrentTasks = 8

// concurrentRun is the slice of executionOrder starting at Start and ending
// before End that may run at the same time. A run of one is the ordinary
// sequential path.
type concurrentRun struct {
	Start int
	End   int
}

// Len is the number of tasks in the run.
func (r concurrentRun) Len() int { return r.End - r.Start }

// planConcurrentRun returns the maximal run of tasks starting at `start` that
// can safely execute together.
//
// Tasks join the run only while every one of these holds:
//
//   - The task is an ordinary action. `wait` and `workflow` tasks suspend the
//     whole execution and resume by index, and `condition` tasks decide which
//     later tasks are skipped. Running either concurrently would mean a
//     suspension point or a branch decision landing in the middle of a set of
//     tasks with no defined order between them.
//   - It declares no dependency on another task in the run. executionOrder is
//     topological, so checking direct dependencies against the run is enough:
//     a transitive dependency inside the run implies a direct one on some
//     member of it.
//   - It does not reference another run member's exports. A task reading
//     `${sibling.field}` without declaring `dependsOn` works today purely
//     because the sorted order happened to put them in that sequence.
//     Running those concurrently would turn working workflows into races, so
//     an undeclared reference keeps the task sequential rather than
//     rewarding the omission with a data race.
//   - It is not already known to be skipped.
//
// Returns a run of length 1 whenever any of that fails, which is exactly the
// behaviour the engine had before.
func planConcurrentRun(
	executionOrder []*types.TaskDefinition,
	start int,
	skipped map[string]bool,
	limit int,
) concurrentRun {
	single := concurrentRun{Start: start, End: start + 1}
	if start >= len(executionOrder) {
		return concurrentRun{Start: start, End: start}
	}
	if limit < 1 {
		limit = 1
	}
	if !isConcurrencySafe(executionOrder[start]) || skipped[executionOrder[start].ID] {
		return single
	}

	members := map[string]bool{executionOrder[start].ID: true}
	end := start + 1
	for end < len(executionOrder) && end-start < limit {
		candidate := executionOrder[end]
		if !isConcurrencySafe(candidate) || skipped[candidate.ID] {
			break
		}
		if dependsOnAny(candidate, members) || referencesAny(candidate, members) {
			break
		}
		// An earlier member referencing this candidate is the same hazard seen
		// from the other side, and the run is only safe if it holds for every
		// pair.
		if anyReferences(executionOrder[start:end], candidate.ID) {
			break
		}
		members[candidate.ID] = true
		end++
	}
	return concurrentRun{Start: start, End: end}
}

// isConcurrencySafe reports whether a task's type can run alongside others.
func isConcurrencySafe(task *types.TaskDefinition) bool {
	switch task.Type {
	case "wait", "workflow", "condition":
		return false
	default:
		return true
	}
}

func dependsOnAny(task *types.TaskDefinition, members map[string]bool) bool {
	for _, dep := range task.DependsOn {
		if members[dep] {
			return true
		}
	}
	return false
}

// referencesAny reports whether the task's parameters or conditions mention
// any member's exports as `${member.` or `${member}`.
func referencesAny(task *types.TaskDefinition, members map[string]bool) bool {
	for id := range members {
		if taskReferences(task, id) {
			return true
		}
	}
	return false
}

func anyReferences(tasks []*types.TaskDefinition, id string) bool {
	for _, t := range tasks {
		if taskReferences(t, id) {
			return true
		}
	}
	return false
}

// taskReferences reports whether `task` reads `${otherID...}` anywhere in its
// parameters or condition values.
//
// Deliberately a text scan: parameters are arbitrary nested JSON carrying
// expression strings, and the alternative is resolving them, which cannot
// happen before the referenced task has run. A false positive costs one task
// its concurrency; a false negative costs correctness.
func taskReferences(task *types.TaskDefinition, otherID string) bool {
	if task.ID == otherID {
		return false
	}
	needles := []string{"${" + otherID + ".", "${" + otherID + "}"}
	haystack := referenceHaystack(task)
	for _, needle := range needles {
		if strings.Contains(haystack, needle) {
			return true
		}
	}
	return false
}

func referenceHaystack(task *types.TaskDefinition) string {
	var b strings.Builder
	writeAny(&b, task.Parameters)
	if task.Condition != nil {
		b.WriteString(task.Condition.Field)
		writeAny(&b, task.Condition.Value)
	}
	for i := range task.Conditions {
		b.WriteString(task.Conditions[i].Field)
		writeAny(&b, task.Conditions[i].Value)
	}
	for _, expr := range task.Exports {
		b.WriteString(expr)
	}
	return b.String()
}

// writeAny flattens arbitrary nested parameter values into text so expression
// strings at any depth are visible to the scan.
func writeAny(b *strings.Builder, v any) {
	switch t := v.(type) {
	case nil:
	case string:
		b.WriteString(t)
	case map[string]any:
		for k, val := range t {
			b.WriteString(k)
			writeAny(b, val)
		}
	case []any:
		for _, val := range t {
			writeAny(b, val)
		}
	default:
		fmt.Fprintf(b, "%v", t)
	}
	b.WriteByte('\x00')
}
