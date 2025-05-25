package temporal

import (
	"fmt"
	"time"

	"maps"

	"github.com/wolfymaster/woofx3/wooflow/internal/core"
	"go.temporal.io/sdk/workflow"
)

// executeActionStep executes an action step
func executeActionStep(ctx workflow.Context, wfCtx *WorkflowContext, step core.Step, stepResult *map[string]any) error {
	wfCtx.Logger.Info("Executing action step", "stepID", step.ID, "action", step.Action)

	// Resolve parameters
	resolvedParams, err := resolveParameterReferences(step.Parameters, wfCtx)
	if err != nil {
		return fmt.Errorf("failed to resolve parameters: %w", err)
	}

	// Create activity input
	input := ExecuteActionInput{
		Action: step.Action,
		Params: resolvedParams,
		Context: map[string]any{
			"workflowID": workflow.GetInfo(ctx).WorkflowExecution.ID,
			"stepID":     step.ID,
		},
	}

	// Execute action
	var result *ExecuteActionResult
	err = workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: time.Minute,
		}),
		ExecuteAction,
		input,
	).Get(ctx, &result)
	if err != nil {
		if step.Critical {
			return fmt.Errorf("critical step failed: %w", err)
		}
		(*stepResult)["error"] = err.Error()
		return nil
	}

	// Store exports in step result
	if result.Exports != nil {
		maps.Copy((*stepResult), result.Exports)
	}

	return nil
}

// executeWaitStep executes a wait step
func executeWaitStep(ctx workflow.Context, wfCtx *WorkflowContext, step core.Step) error {
	wfCtx.Logger.Info("Executing wait step", "stepID", step.ID)

	if step.WaitFor == nil {
		return fmt.Errorf("wait step requires waitFor configuration")
	}

	var waitForEvent string
	switch step.WaitFor.Type {
	case "event":
		waitForEvent = step.WaitFor.EventType
	case "aggregation":
		waitForEvent = step.WaitFor.Aggregation.EventType
	default:
		return fmt.Errorf("unknown wait type: %s", step.WaitFor.Type)
	}

	// Register workflow as waiting for event
	err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: time.Minute,
		}),
		RegisterWaitingWorkflow,
		workflow.GetInfo(ctx).WorkflowExecution.ID,
		waitForEvent,
	).Get(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to register waiting workflow: %w", err)
	}

	switch step.WaitFor.Type {
	case "event":
		return executeEventWait(ctx, wfCtx, step)
	case "aggregation":
		return executeAggregationWait(ctx, wfCtx, step)
	// case "condition":
	// return executeConditionWait(ctx, wfCtx, step)
	default:
		return fmt.Errorf("unknown wait type: %s", step.WaitFor.Type)
	}
}

// executeEventWait waits for a specific event
func executeEventWait(ctx workflow.Context, wfCtx *WorkflowContext, step core.Step) error {
	// Create a channel for the event
	eventCh := workflow.GetSignalChannel(ctx, step.WaitFor.EventType)

	// Set timeout if specified
	var timeout time.Duration
	if step.WaitFor.Timeout != "" {
		var err error
		timeout, err = time.ParseDuration(step.WaitFor.Timeout)
		if err != nil {
			return fmt.Errorf("invalid timeout duration: %w", err)
		}
	}

	// Wait for event or timeout
	selector := workflow.NewSelector(ctx)
	selector.AddReceive(eventCh, func(ch workflow.ReceiveChannel, more bool) {
		var event core.Event
		ch.Receive(ctx, &event)

		// wfCtx.Events = append(wfCtx.Events, event)
	})

	if timeout > 0 {
		selector.AddFuture(workflow.NewTimer(ctx, timeout), func(f workflow.Future) {
			// Timeout occurred
		})
	}

	selector.Select(ctx)
	return nil
}

// executeAggregationWait waits for an aggregation condition
func executeAggregationWait(ctx workflow.Context, wfCtx *WorkflowContext, step core.Step) error {
	agg := step.WaitFor.Aggregation
	timeWindow, err := time.ParseDuration(agg.TimeWindow)
	if err != nil {
		return fmt.Errorf("invalid time window: %w", err)
	}

	sum := 0.0
	timeout := false

	selector := workflow.NewSelector(ctx)

	// Set timeout
	selector.AddFuture(workflow.NewTimer(ctx, timeWindow), func(f workflow.Future) {
		// Time window expired - terminate workflow
		workflow.GetLogger(ctx).Info("Aggregation time window expired - terminating workflow")
		timeout = true
	})

	// Receive event
	var result core.Event
	aggCh := workflow.GetSignalChannel(ctx, agg.EventType)
	selector.AddReceive(aggCh, func(ch workflow.ReceiveChannel, more bool) {
		ch.Receive(ctx, &result)
		aggregationField := "value"
		if agg.Field != "" {
			aggregationField = agg.Field
		}

		sum += result.Payload[aggregationField].(float64)
	})

	for {
		// Wait for either aggregation completion or timeout
		selector.Select(ctx)

		// Check if we timed out
		if timeout {
			return fmt.Errorf("aggregation time window expired")
		}

		// Aggregation Threshold is met
		if sum >= float64(agg.Threshold) {
			wfCtx.StepResults[step.ID] = result
			return nil
		}
	}
}

// executeConditionWait waits for a condition to be met
// func executeConditionWait(ctx workflow.Context, wfCtx *WorkflowContext, step core.Step) error {
// 	// Create a channel for condition updates
// 	condCh := workflow.GetSignalChannel(ctx, fmt.Sprintf("cond_%s", step.ID))

// 	// Wait for condition to be true
// 	selector := workflow.NewSelector(ctx)
// 	selector.AddReceive(condCh, func(ch workflow.ReceiveChannel, more bool) {
// 		var result bool
// 		ch.Receive(ctx, &result)
// 		if result {
// 			wfCtx.Output[step.ID] = result
// 		}
// 	})

// 	// Set timeout if specified
// 	if step.WaitFor.Timeout != "" {
// 		timeout, err := time.ParseDuration(step.WaitFor.Timeout)
// 		if err != nil {
// 			return fmt.Errorf("invalid timeout duration: %w", err)
// 		}
// 		selector.AddFuture(workflow.NewTimer(ctx, timeout), func(f workflow.Future) {
// 			// Timeout occurred
// 		})
// 	}

// 	selector.Select(ctx)
// 	return nil
// }

// // executeConditionStep executes a condition step
// func executeConditionStep(ctx workflow.Context, wfCtx *WorkflowContext, step core.Step, steps map[string]*core.Step, executed map[string]bool) error {
// 	wfCtx.Logger.Info("Executing condition step", "stepID", step.ID)

// 	// Evaluate condition
// 	var result bool
// 	err := workflow.ExecuteActivity(ctx, "evaluate_condition", step.Condition, wfCtx.Input).Get(ctx, &result)
// 	if err != nil {
// 		return fmt.Errorf("condition evaluation failed: %w", err)
// 	}

// 	// Execute appropriate branch
// 	branchSteps := step.TrueSteps
// 	if !result {
// 		branchSteps = step.FalseSteps
// 	}

// 	for _, branchStep := range branchSteps {
// 		if err := executeStep(ctx, wfCtx, branchStep, steps, executed); err != nil {
// 			return err
// 		}
// 	}

// 	return nil
// }

// // executeLoopStep executes a loop step
// func executeLoopStep(ctx workflow.Context, wfCtx *WorkflowContext, step core.Step, steps map[string]*core.Step, executed map[string]bool) error {
// 	wfCtx.Logger.Info("Executing loop step", "stepID", step.ID)

// 	if step.LoopConfig == nil {
// 		return fmt.Errorf("loop step requires loopConfig")
// 	}

// 	switch step.LoopConfig.Type {
// 	case "count":
// 		return executeCountLoop(ctx, wfCtx, step, steps, executed)
// 	case "condition":
// 		return executeConditionLoop(ctx, wfCtx, step, steps, executed)
// 	case "collection":
// 		return executeCollectionLoop(ctx, wfCtx, step, steps, executed)
// 	default:
// 		return fmt.Errorf("unknown loop type: %s", step.LoopConfig.Type)
// 	}
// }

// // executeCountLoop executes a count-based loop
// func executeCountLoop(ctx workflow.Context, wfCtx *WorkflowContext, step core.Step, steps map[string]*core.Step, executed map[string]bool) error {
// 	for i := 0; i < step.LoopConfig.Count; i++ {
// 		wfCtx.Input["loop_index"] = i
// 		for _, loopStep := range step.TrueSteps {
// 			if err := executeStep(ctx, wfCtx, loopStep, steps, executed); err != nil {
// 				return err
// 			}
// 		}
// 	}
// 	return nil
// }

// // executeConditionLoop executes a condition-based loop
// func executeConditionLoop(ctx workflow.Context, wfCtx *WorkflowContext, step core.Step, steps map[string]*core.Step, executed map[string]bool) error {
// 	for {
// 		var result bool
// 		err := workflow.ExecuteActivity(ctx, "evaluate_condition", step.LoopConfig.Condition, wfCtx.Input).Get(ctx, &result)
// 		if err != nil {
// 			return fmt.Errorf("condition evaluation failed: %w", err)
// 		}

// 		if !result {
// 			break
// 		}

// 		for _, loopStep := range step.TrueSteps {
// 			if err := executeStep(ctx, wfCtx, loopStep, steps, executed); err != nil {
// 				return err
// 			}
// 		}
// 	}
// 	return nil
// }

// // executeCollectionLoop executes a collection-based loop
// func executeCollectionLoop(ctx workflow.Context, wfCtx *WorkflowContext, step core.Step, steps map[string]*core.Step, executed map[string]bool) error {
// 	collection, ok := wfCtx.Input[step.LoopConfig.Collection].([]interface{})
// 	if !ok {
// 		return fmt.Errorf("collection not found or invalid type")
// 	}

// 	for i, item := range collection {
// 		wfCtx.Input["loop_index"] = i
// 		wfCtx.Input["loop_item"] = item
// 		for _, loopStep := range step.TrueSteps {
// 			if err := executeStep(ctx, wfCtx, loopStep, steps, executed); err != nil {
// 				return err
// 			}
// 		}
// 	}
// 	return nil
// }
