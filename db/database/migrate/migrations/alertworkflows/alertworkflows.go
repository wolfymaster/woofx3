// Package alertworkflows splits an event's alert triggers, stored as one
// workflow, into one workflow per trigger. Shared by the postgres and sqlite
// migrations.
//
// The UI's triggers screens stored every trigger of one event in a single
// workflow: each trigger a `condition` task with no else branch, its actions
// the tasks named in that condition's `onTrue`, and actions belonging to no
// condition forming a trigger that fires on every event. Each trigger becomes
// a workflow of its own, its conditions moved onto the workflow's trigger, so
// a trigger is edited like any other workflow and its steps can wait, pause
// and branch.
//
// What the one-workflow shape did, and how the split keeps it:
//
//   - Every trigger whose conditions held ran: nothing stopped at the first
//     match. Split, every trigger is a workflow the event starts on its own.
//   - Triggers ran one after another in the order they were stored, each
//     finishing before the next was checked. Split, each sets `trigger.order`
//     to its place, which the engine runs one at a time, lowest first (see
//     docs/workflow/execution.md). That this was the order is only true of a
//     workflow whose triggers' tasks are stored as consecutive blocks, each
//     step depending on the one stored before it, so nothing else is split.
//   - A paused trigger's condition was disabled, so it never matched. Split,
//     its workflow is disabled.
//
// A workflow the split cannot reproduce exactly is left as it is: a step
// shared by several triggers (it ran once when any of them matched, where a
// copy in each would run once per match), `or` between a trigger's conditions
// (a workflow trigger ANDs them), a step reading another trigger's results,
// steps set to run at the same time (the step editor has no way to show
// them, and the triggers screen that wrote them still can), and anything
// outside the shape above.
package alertworkflows

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

// Part is one trigger of a split workflow, as the workflow it becomes.
type Part struct {
	// Trigger is the workflow trigger: the original one with the trigger's
	// conditions and its `order`.
	Trigger string
	// Steps is the trigger's actions, no longer depending on the condition
	// task they hung off.
	Steps string
	// Paused is true for a trigger that never ran: one switched off, or one
	// with no actions yet, which the engine refuses to register as a
	// workflow of its own.
	Paused bool
}

// Plan is what becomes of one workflow. Parts is empty when it is left as it
// is, and Reason then says why.
type Plan struct {
	Parts  []Part
	Reason string
}

// Split reports whether a workflow, given as its stored trigger and steps
// JSON, is an event's triggers stored together, and if so the workflow each
// trigger becomes, in the order the triggers ran.
//
// A workflow already holding a single trigger with no condition task is the
// shape a split produces and is left alone, which makes splitting the same
// workflow twice a no-op.
func Split(triggerJSON, stepsJSON string) (Plan, error) {
	if strings.TrimSpace(triggerJSON) == "" {
		return untouched("it has no trigger")
	}
	var trigger map[string]any
	if err := decode(triggerJSON, &trigger); err != nil {
		return Plan{}, fmt.Errorf("parse trigger: %w", err)
	}
	var tasks []map[string]any
	if strings.TrimSpace(stepsJSON) != "" {
		if err := decode(stepsJSON, &tasks); err != nil {
			return Plan{}, fmt.Errorf("parse steps: %w", err)
		}
	}

	if trigger["type"] != "event" {
		return untouched("its trigger is not an event")
	}
	if _, ordered := trigger["order"]; ordered {
		return untouched("it is already ordered among its event's triggers")
	}
	if len(listOf(trigger["conditions"])) > 0 {
		return untouched("its conditions are on its trigger")
	}

	byID := make(map[string]map[string]any, len(tasks))
	for _, task := range tasks {
		id, _ := task["id"].(string)
		if id == "" {
			return untouched("a step has no id")
		}
		if _, duplicate := byID[id]; duplicate {
			return untouched(fmt.Sprintf("step %q appears twice", id))
		}
		byID[id] = task
		kind, _ := task["type"].(string)
		if kind != "action" && kind != "condition" {
			return untouched(fmt.Sprintf("it uses a %q step", kind))
		}
	}

	// Each task's trigger, named by its condition task's id, or by
	// unconditional for the actions no condition claims.
	const unconditional = ""
	blockOf := make(map[string]string, len(tasks))
	conditionCount := 0
	for _, task := range tasks {
		if task["type"] != "condition" {
			continue
		}
		conditionCount++
		id := task["id"].(string)
		if len(listOf(task["onFalse"])) > 0 {
			return untouched(fmt.Sprintf("condition %q has an else branch", id))
		}
		blockOf[id] = id
		for _, raw := range listOf(task["onTrue"]) {
			actionID, _ := raw.(string)
			action, ok := byID[actionID]
			if !ok || action["type"] != "action" {
				return untouched(fmt.Sprintf("condition %q names %q, which is not an action", id, actionID))
			}
			if _, claimed := blockOf[actionID]; claimed {
				return untouched(fmt.Sprintf("step %q belongs to more than one trigger", actionID))
			}
			blockOf[actionID] = id
		}
	}
	if conditionCount == 0 {
		return untouched("it holds a single trigger")
	}
	for _, task := range tasks {
		id := task["id"].(string)
		if _, claimed := blockOf[id]; claimed {
			continue
		}
		if hasGuard(task) {
			// Either a step shared between triggers, guarded on their
			// results, or a guard the triggers screens never wrote.
			return untouched(fmt.Sprintf("step %q runs only when other steps let it", id))
		}
		blockOf[id] = unconditional
	}

	// Blocks in stored order, each one run of consecutive tasks.
	var order []string
	for i, task := range tasks {
		block := blockOf[task["id"].(string)]
		if i == 0 || blockOf[tasks[i-1]["id"].(string)] != block {
			if slices.Contains(order, block) {
				return untouched("its triggers' steps are interleaved")
			}
			if block != unconditional && task["id"] != block {
				return untouched(fmt.Sprintf("trigger %q has a step stored before its condition", block))
			}
			order = append(order, block)
		}
	}

	for i, task := range tasks {
		id := task["id"].(string)
		var previous map[string]any
		if i > 0 && blockOf[tasks[i-1]["id"].(string)] == blockOf[id] {
			previous = tasks[i-1]
		}
		if !runsInSequence(task, previous) {
			return untouched(fmt.Sprintf("step %q does not run straight after the step before it", id))
		}
		if reason := crossReference(task, blockOf, tasks); reason != "" {
			return untouched(reason)
		}
	}

	parts := make([]Part, 0, len(order))
	for position, block := range order {
		part, reason, err := buildPart(trigger, tasks, blockOf, block, position)
		if err != nil {
			return Plan{}, err
		}
		if reason != "" {
			return untouched(reason)
		}
		parts = append(parts, part)
	}
	return Plan{Parts: parts}, nil
}

// runsInSequence reports whether task depends on exactly the step stored before
// it in its trigger: nothing for a trigger's first step, or optionally the
// condition it hangs off. That is how the triggers screens wrote steps that run
// one after another, and the only order the step editor reads back; steps the
// screens marked to run at the same time share a dependency instead, and are
// left in the shape that can still edit them.
func runsInSequence(task, previous map[string]any) bool {
	deps := listOf(task["dependsOn"])
	switch {
	case previous == nil:
		return len(deps) == 0
	case previous["type"] == "condition":
		return len(deps) == 0 || (len(deps) == 1 && deps[0] == previous["id"])
	default:
		return len(deps) == 1 && deps[0] == previous["id"]
	}
}

func untouched(reason string) (Plan, error) {
	return Plan{Reason: reason}, nil
}

// buildPart is the workflow one trigger becomes. A non-empty reason means the
// trigger's conditions cannot move onto a workflow trigger.
func buildPart(
	trigger map[string]any,
	tasks []map[string]any,
	blockOf map[string]string,
	block string,
	position int,
) (Part, string, error) {
	partTrigger := make(map[string]any, len(trigger)+2)
	for key, value := range trigger {
		partTrigger[key] = value
	}
	partTrigger["order"] = position

	paused := false
	steps := make([]map[string]any, 0)
	for _, task := range tasks {
		id := task["id"].(string)
		if blockOf[id] != block {
			continue
		}
		if task["type"] == "condition" {
			conditions, reason := triggerConditions(task)
			if reason != "" {
				return Part{}, reason, nil
			}
			if len(conditions) > 0 {
				partTrigger["conditions"] = conditions
			}
			paused = task["disabled"] == true
			continue
		}
		steps = append(steps, withoutDependency(task, block))
	}

	encodedTrigger, err := encode(partTrigger)
	if err != nil {
		return Part{}, "", err
	}
	encodedSteps, err := encode(steps)
	if err != nil {
		return Part{}, "", err
	}
	return Part{Trigger: encodedTrigger, Steps: encodedSteps, Paused: paused || len(steps) == 0}, "", nil
}

// triggerConditions are a condition task's conditions as a workflow trigger
// holds them, or a reason they cannot be held there.
func triggerConditions(task map[string]any) ([]any, string) {
	id := task["id"].(string)
	conditions := listOf(task["conditions"])
	if len(conditions) == 0 && task["condition"] != nil {
		conditions = []any{task["condition"]}
	}
	if len(conditions) == 0 && task["disabled"] != true {
		return nil, fmt.Sprintf("condition %q has nothing to check", id)
	}
	if task["conditionLogic"] == "or" && len(conditions) > 1 {
		return nil, fmt.Sprintf("condition %q needs only one of its conditions to hold", id)
	}
	return conditions, ""
}

// withoutDependency is a copy of task no longer depending on the condition
// task it hung off, which the split removes.
func withoutDependency(task map[string]any, condition string) map[string]any {
	out := make(map[string]any, len(task))
	for key, value := range task {
		out[key] = value
	}
	deps := listOf(task["dependsOn"])
	kept := make([]any, 0, len(deps))
	for _, dep := range deps {
		if dep != condition {
			kept = append(kept, dep)
		}
	}
	if len(kept) == 0 {
		delete(out, "dependsOn")
	} else {
		out["dependsOn"] = kept
	}
	return out
}

// crossReference says why a task reads a step it will not share a workflow
// with: one of another trigger, or a condition task, which a split turns into
// trigger conditions with no results to read. Empty when it reads neither.
func crossReference(task map[string]any, blockOf map[string]string, tasks []map[string]any) string {
	id := task["id"].(string)
	encoded, err := json.Marshal(task)
	if err != nil {
		return fmt.Sprintf("step %q cannot be read", id)
	}
	text := string(encoded)
	for _, other := range tasks {
		otherID := other["id"].(string)
		if otherID == id {
			continue
		}
		// A condition's checks move onto the workflow trigger, which sees only
		// the event, so it may read no step at all.
		if task["type"] != "condition" && blockOf[otherID] == blockOf[id] && other["type"] != "condition" {
			continue
		}
		if strings.Contains(text, "${"+otherID+".") || strings.Contains(text, "${"+otherID+"}") {
			return fmt.Sprintf("step %q reads the results of step %q", id, otherID)
		}
	}
	return ""
}

func hasGuard(task map[string]any) bool {
	return task["condition"] != nil || len(listOf(task["conditions"])) > 0
}

func listOf(value any) []any {
	list, _ := value.([]any)
	return list
}

func decode(text string, into any) error {
	decoder := json.NewDecoder(bytes.NewReader([]byte(text)))
	decoder.UseNumber()
	return decoder.Decode(into)
}

// encode writes JSON without escaping <, > and &, which step parameters such
// as alert messages hold as they were typed.
func encode(value any) (string, error) {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return "", fmt.Errorf("encode: %w", err)
	}
	return strings.TrimSuffix(out.String(), "\n"), nil
}
