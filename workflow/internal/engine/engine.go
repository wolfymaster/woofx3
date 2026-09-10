package engine

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/common/logging"
	"github.com/wolfymaster/woofx3/workflow/internal/eventmatch"
	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

type EventPublisher interface {
	Publish(event *types.Event) error
}

// AssetURLResolver resolves the engine's configured `overlay.publicUrl`
// setting (bare, no suffix — buildResolver appends `/overlay/assets`) —
// the base URL `${woofx3_asset_url:<repositoryKey>}` tokens (baked by
// barkloader at module-install time; see ManifestWorkflow::register /
// encode_asset_url_markers in module_manifest.rs) are resolved against.
// Backed by the db-proxy `settings` table in production (see
// workflow/overlay_public_url_resolver.go) so a UI settings page can
// override the default without redeploying the engine; kept as an
// interface here so the engine package doesn't need to depend on the db
// client. Process-wide, not per-application.
type AssetURLResolver interface {
	Resolve() string
}

type Engine[TServices any] struct {
	workflowRegistry     *WorkflowRegistry
	taskRegistry         *tasks.TaskRegistry
	actionRegistry       *tasks.ActionRegistry[TServices]
	executions           map[string]*types.WorkflowExecution
	executionsMu         sync.RWMutex
	waitingExecutions    map[string][]*WaitingExecution // eventType -> waiting executions
	waitingMu            sync.RWMutex
	subWorkflowWaiters   map[string][]*SubWorkflowWaiter // subWorkflowExecutionID -> parent executions waiting for it
	subWorkflowWaitersMu sync.RWMutex
	publisher            EventPublisher
	assetURLResolver     AssetURLResolver
	logger               tasks.Logger
	ctx                  context.Context
	cancel               context.CancelFunc
	// maxConcurrency caps how many independent tasks run at once. Zero means
	// DefaultMaxConcurrentTasks.
	maxConcurrency int
}

type SubWorkflowWaiter struct {
	ParentExecutionID string
	ParentWorkflowID  string
	TaskID            string
	TaskDef           *types.TaskDefinition
	ExecutionOrder    []*types.TaskDefinition
	CurrentIndex      int
	TaskExports       map[string]map[string]any
	TriggerEvent      *types.Event
}

type WaitingExecution struct {
	ExecutionID    string
	WorkflowID     string
	TaskID         string
	TaskDef        *types.TaskDefinition
	ExecutionOrder []*types.TaskDefinition
	CurrentIndex   int
	TaskExports    map[string]map[string]any
	TriggerEvent   *types.Event
}

func New[TServices any](logger tasks.Logger) *Engine[TServices] {
	ctx, cancel := context.WithCancel(context.Background())

	engine := &Engine[TServices]{
		workflowRegistry:   NewWorkflowRegistry(),
		taskRegistry:       tasks.NewTaskRegistry(),
		actionRegistry:     tasks.NewActionRegistry[TServices](),
		executions:         make(map[string]*types.WorkflowExecution),
		waitingExecutions:  make(map[string][]*WaitingExecution),
		subWorkflowWaiters: make(map[string][]*SubWorkflowWaiter),
		logger:             logger,
		ctx:                ctx,
		cancel:             cancel,
	}

	engine.registerBuiltInTasks()

	return engine
}

func (e *Engine[TServices]) registerBuiltInTasks() {
	e.taskRegistry.Register("log", tasks.NewLogTask())
	e.taskRegistry.Register("action", tasks.NewActionTask(e.actionRegistry))
	e.taskRegistry.Register("wait", tasks.NewWaitTask())
	e.taskRegistry.Register("condition", tasks.NewConditionTask())
	e.taskRegistry.Register("workflow", tasks.NewWorkflowTask())
}

// Registry exposes the underlying workflow registry so callers (the workflow
// app binary) can wire trigger registrars and a logger after construction.
func (e *Engine[TServices]) Registry() *WorkflowRegistry {
	return e.workflowRegistry
}

func (e *Engine[TServices]) RegisterWorkflow(def *types.WorkflowDefinition) error {
	return e.workflowRegistry.Register(def)
}

func (e *Engine[TServices]) UnregisterWorkflow(id string) error {
	return e.workflowRegistry.Remove(id)
}

func (e *Engine[TServices]) GetWorkflow(id string) (*types.WorkflowDefinition, error) {
	return e.workflowRegistry.Get(id)
}

func (e *Engine[TServices]) RegisterAction(name string, action tasks.ActionFunc[TServices]) error {
	return e.actionRegistry.Register(name, action)
}

func (e *Engine[TServices]) SetPublisher(publisher EventPublisher) {
	e.publisher = publisher
	e.registerPublishAction()
}

// SetAssetURLResolver wires the resolver backing `${woofx3_asset_url:...}`
// tokens. Optional — a workflow containing such a token fails to resolve
// (rather than silently resolving to an empty/broken URL) when unset; see
// expression.Resolver.SetAssetURLBase.
func (e *Engine[TServices]) SetAssetURLResolver(resolver AssetURLResolver) {
	e.assetURLResolver = resolver
}

func (e *Engine[TServices]) registerPublishAction() {
	e.actionRegistry.Register("publish_event", func(ctx tasks.ActionContext[TServices], params map[string]any) (map[string]any, error) {
		if e.publisher == nil {
			return nil, fmt.Errorf("no event publisher configured")
		}

		eventType, ok := params["eventType"].(string)
		if !ok || eventType == "" {
			return nil, fmt.Errorf("eventType parameter is required")
		}

		event := &types.Event{
			ID:     uuid.New().String(),
			Type:   eventType,
			Source: "workflow",
			Time:   time.Now(),
			Data:   make(map[string]any),
		}

		if data, ok := params["data"].(map[string]any); ok {
			event.Data = data
		}

		if source, ok := params["source"].(string); ok {
			event.Source = source
		}

		if err := e.publisher.Publish(event); err != nil {
			return nil, fmt.Errorf("failed to publish event: %w", err)
		}

		e.logger.Info("Published event", "type", eventType, "id", event.ID)

		return map[string]any{
			"eventId":   event.ID,
			"eventType": eventType,
			"published": true,
		}, nil
	})
}

func (e *Engine[TServices]) HandleEvent(event *types.Event) error {
	e.processWaitingExecutions(event)

	workflows := e.workflowRegistry.GetByEvent(event.Type)

	// "I received the event, here's what I'm doing about it" — without
	// these lines, the most common debug question ("trigger fired but
	// my workflow didn't run, why?") is invisible. The match step,
	// per-workflow trigger evaluation, and dispatch decision are all
	// independently informative.
	if len(workflows) == 0 {
		e.logger.Info("Event matched no workflows",
			"event_type", event.Type,
			"event_id", event.ID)
		return nil
	}
	e.logger.Info("Event matched workflows",
		"event_type", event.Type,
		"event_id", event.ID,
		"match_count", len(workflows))

	for _, wf := range workflows {
		if err := e.evaluateTrigger(wf, event); err != nil {
			// `evaluateTrigger` returns errors for legitimate
			// non-matches (event-type mismatch, trigger conditions
			// false). Log them so users can see why a workflow that
			// listens on the right subject still didn't fire.
			e.logger.Info("Trigger evaluation rejected workflow",
				"workflow", wf.ID,
				"workflow_name", wf.Name,
				"event_type", event.Type,
				"event_id", event.ID,
				"reason", err.Error())
			continue
		}
		e.logger.Info("Dispatching workflow",
			"workflow", wf.ID,
			"workflow_name", wf.Name,
			"event_type", event.Type,
			"event_id", event.ID)
		go e.executeWorkflow(wf, event)
	}

	return nil
}

// FireByWorkflowID runs the named workflow with a synthesized trigger event.
// Used by non-bus trigger types (schedule, manual) that already know the target
// and so bypass GetByEvent / evaluateTrigger. Dispatch mirrors HandleEvent:
// launch executeWorkflow in a goroutine so callers never block on task execution.
func (e *Engine[TServices]) FireByWorkflowID(workflowID string, event *types.Event) error {
	def, err := e.workflowRegistry.Get(workflowID)
	if err != nil {
		return fmt.Errorf("FireByWorkflowID: %w", err)
	}
	go e.executeWorkflow(def, event)
	return nil
}

func (e *Engine[TServices]) processWaitingExecutions(event *types.Event) {
	e.waitingMu.Lock()
	waiting := e.waitingExecutions[event.Type]
	if len(waiting) == 0 {
		e.waitingMu.Unlock()
		return
	}

	remaining := make([]*WaitingExecution, 0)
	toResume := make([]*WaitingExecution, 0)

	for _, w := range waiting {
		e.executionsMu.RLock()
		execution := e.executions[w.ExecutionID]
		e.executionsMu.RUnlock()

		if execution == nil {
			continue
		}

		taskExec := execution.Tasks[w.TaskID]
		if taskExec == nil || taskExec.WaitState == nil {
			continue
		}

		waitTask := &tasks.WaitTask{}
		resolver := expression.NewResolver()

		satisfied, err := waitTask.ProcessEvent(event, taskExec.WaitState, resolver)
		if err != nil {
			e.logger.Error("Error processing event for waiting execution",
				"execution", w.ExecutionID, "task", w.TaskID, "error", err)
			continue
		}

		if satisfied {
			toResume = append(toResume, w)
		} else {
			remaining = append(remaining, w)
		}
	}

	e.waitingExecutions[event.Type] = remaining
	e.waitingMu.Unlock()

	for _, w := range toResume {
		go e.resumeExecution(w)
	}
}

func (e *Engine[TServices]) evaluateTrigger(wf *types.WorkflowDefinition, event *types.Event) error {
	if wf.Trigger == nil {
		return fmt.Errorf("workflow has no trigger")
	}

	if wf.Trigger.Type != "event" {
		return fmt.Errorf("only event triggers supported in MVP")
	}

	// `event` may be an exact subject ("twitch.channel.cheer") or a
	// NATS-style pattern ("channel.*", "workflow.>").
	// eventmatch.Matches handles both.
	if !eventmatch.Matches(wf.Trigger.Event, event.Type) {
		return fmt.Errorf("trigger event mismatch: pattern=%q event=%q", wf.Trigger.Event, event.Type)
	}

	// Evaluate trigger conditions against the matching event before
	// the workflow starts. Same expression syntax as step conditions:
	// `${trigger.data.X}` resolves against the event payload.
	// Workflows whose trigger has no conditions short-circuit; an
	// empty result from EvaluateMultiple is treated as success.
	if len(wf.Trigger.Conditions) > 0 {
		resolver := expression.NewResolver()
		resolver.AddSource("trigger", event.TriggerFields())
		exprConds := make([]expression.Condition, 0, len(wf.Trigger.Conditions))
		for _, c := range wf.Trigger.Conditions {
			exprConds = append(exprConds, expression.Condition{
				Field:    c.Field,
				Operator: c.Operator,
				Value:    c.Value,
			})
		}
		// Trigger conditions use AND logic — there's no
		// `conditionLogic` field on TriggerConfig (yet).
		ok, err := expression.EvaluateMultiple(exprConds, "and", resolver)
		if err != nil {
			return fmt.Errorf("trigger condition evaluation failed: %w", err)
		}
		if !ok {
			return fmt.Errorf("trigger conditions not satisfied")
		}
	}

	return nil
}

func (e *Engine[TServices]) executeWorkflow(wf *types.WorkflowDefinition, event *types.Event) {
	executionID := uuid.New().String()

	// Top-level entry point for the engine: a trigger fired and a workflow
	// run begins here. Task-level child spans need the context threaded
	// through executeTasksFromIndex, which is tracked separately.
	_, span := logging.StartSpan(context.Background(), "workflow.execute",
		attribute.String("workflow.id", wf.ID),
		attribute.String("workflow.execution_id", executionID),
	)
	defer span.End()

	execution := &types.WorkflowExecution{
		ID:           executionID,
		WorkflowID:   wf.ID,
		Status:       types.ExecutionStatusRunning,
		TriggerEvent: event,
		StartedAt:    time.Now(),
		Tasks:        make(map[string]*types.TaskExecution),
		Variables:    make(map[string]any),
	}

	taskExports := make(map[string]map[string]any)

	e.executionsMu.Lock()
	e.executions[executionID] = execution
	e.executionsMu.Unlock()

	e.logger.Info("Starting workflow execution", "workflow", wf.ID, "execution", executionID)

	graph, err := NewDependencyGraph(wf.Tasks)
	if err != nil {
		execution.Status = types.ExecutionStatusFailed
		execution.Error = err.Error()
		e.logger.Error("Failed to build dependency graph", "workflow", wf.ID, "execution", executionID, "error", err)
		now := time.Now()
		execution.CompletedAt = &now
		span.RecordError(err)
		span.SetStatus(codes.Error, "build dependency graph")
		return
	}

	executionOrder, err := graph.GetExecutionOrder()
	if err != nil {
		execution.Status = types.ExecutionStatusFailed
		execution.Error = err.Error()
		e.logger.Error("Failed to resolve execution order", "workflow", wf.ID, "execution", executionID, "error", err)
		now := time.Now()
		execution.CompletedAt = &now
		span.RecordError(err)
		span.SetStatus(codes.Error, "resolve execution order")
		return
	}

	e.executeTasksFromIndex(execution, executionOrder, 0, taskExports, event)
}

func (e *Engine[TServices]) executeTasksFromIndex(execution *types.WorkflowExecution, executionOrder []*types.TaskDefinition, startIndex int, taskExports map[string]map[string]any, triggerEvent *types.Event) {
	skippedTasks := make(map[string]bool)

	for i := startIndex; i < len(executionOrder); i++ {
		// Independent adjacent tasks run together. `planConcurrentRun` returns
		// a run of one whenever anything makes that unsafe, so the loop body
		// below is unchanged for every workflow that was sequential before.
		if run := planConcurrentRun(executionOrder, i, skippedTasks, e.maxConcurrentTasks()); run.Len() > 1 {
			if !e.executeConcurrentRun(execution, executionOrder, run, taskExports, triggerEvent) {
				return
			}
			i = run.End - 1
			continue
		}

		taskDef := executionOrder[i]

		if skippedTasks[taskDef.ID] {
			taskExec := &types.TaskExecution{
				TaskID:    taskDef.ID,
				Status:    types.TaskStatusSkipped,
				StartedAt: time.Now(),
			}
			now := time.Now()
			taskExec.CompletedAt = &now
			execution.Tasks[taskDef.ID] = taskExec
			e.logger.Info("Task skipped (branch not taken)", "workflow", execution.WorkflowID, "task", taskDef.ID)
			continue
		}

		taskExec := execution.Tasks[taskDef.ID]
		if taskExec == nil {
			taskExec = &types.TaskExecution{
				TaskID:    taskDef.ID,
				Status:    types.TaskStatusRunning,
				StartedAt: time.Now(),
			}
			execution.Tasks[taskDef.ID] = taskExec
		} else {
			taskExec.Status = types.TaskStatusRunning
		}

		// For non-condition tasks, evaluate conditions as guards (skip if false)
		// Condition tasks use conditions for branching (OnTrue/OnFalse), not skipping
		if taskDef.Type != "condition" && (taskDef.Condition != nil || len(taskDef.Conditions) > 0) {
			resolver := e.buildResolver(triggerEvent, taskExports)
			condTask := &tasks.ConditionTask{}

			shouldRun, err := condTask.Evaluate(taskDef, resolver)
			if err != nil {
				taskExec.Status = types.TaskStatusFailed
				taskExec.Error = err.Error()
				execution.Status = types.ExecutionStatusFailed
				execution.Error = err.Error()
				now := time.Now()
				taskExec.CompletedAt = &now
				execution.CompletedAt = &now
				e.logger.Error("Task condition evaluation failed", "workflow", execution.WorkflowID, "task", taskDef.ID, "error", err)
				e.checkSubWorkflowCompletion(execution.ID)
				return
			}

			if !shouldRun {
				taskExec.Status = types.TaskStatusSkipped
				now := time.Now()
				taskExec.CompletedAt = &now
				taskExec.Result = &types.TaskResult{
					Status: types.TaskStatusSkipped,
					Data: map[string]any{
						"skipped": true,
						"reason":  "condition evaluated to false",
					},
				}
				e.logger.Info("Task skipped (condition false)", "workflow", execution.WorkflowID, "task", taskDef.ID)
				continue
			}
		}

		if taskDef.Type == "condition" && (taskDef.Condition != nil || len(taskDef.Conditions) > 0) {
			resolver := e.buildResolver(triggerEvent, taskExports)
			condTask := &tasks.ConditionTask{}

			result, err := condTask.Evaluate(taskDef, resolver)
			if err != nil {
				taskExec.Status = types.TaskStatusFailed
				taskExec.Error = err.Error()
				execution.Status = types.ExecutionStatusFailed
				execution.Error = err.Error()
				now := time.Now()
				taskExec.CompletedAt = &now
				execution.CompletedAt = &now
				e.logger.Error("Condition evaluation failed", "workflow", execution.WorkflowID, "task", taskDef.ID, "error", err)
				e.checkSubWorkflowCompletion(execution.ID)
				return
			}

			branchTasks := condTask.GetBranchTasks(taskDef, result)
			skippedBranch := condTask.GetBranchTasks(taskDef, !result)

			for _, skipID := range skippedBranch {
				skippedTasks[skipID] = true
			}

			taskExec.Status = types.TaskStatusSuccess
			now := time.Now()
			taskExec.CompletedAt = &now
			taskExec.Result = &types.TaskResult{
				Status: types.TaskStatusSuccess,
				Data: map[string]any{
					"result":        result,
					"branchTaken":   branchTasks,
					"branchSkipped": skippedBranch,
				},
				Exports: map[string]any{
					"result": result,
				},
			}
			taskExports[taskDef.ID] = taskExec.Result.Exports

			e.logger.Info("Condition evaluated", "workflow", execution.WorkflowID, "task", taskDef.ID, "result", result, "branch", branchTasks)
			continue
		}

		if taskDef.Type == "wait" && taskDef.Wait != nil {
			waitResult := e.handleWaitTask(execution, taskDef, taskExec, executionOrder, i, taskExports, triggerEvent)
			if waitResult == "waiting" {
				return
			} else if waitResult == "timeout" {
				if taskDef.Wait.OnTimeout == "fail" {
					taskExec.Status = types.TaskStatusFailed
					taskExec.Error = "wait timeout"
					execution.Status = types.ExecutionStatusFailed
					execution.Error = "wait timeout"
					now := time.Now()
					execution.CompletedAt = &now
					e.logger.Error("Wait task timed out", "workflow", execution.WorkflowID, "task", taskDef.ID)
					e.checkSubWorkflowCompletion(execution.ID)
					return
				}
				taskExec.Status = types.TaskStatusSuccess
				e.logger.Info("Wait task timed out, continuing", "workflow", execution.WorkflowID, "task", taskDef.ID)
				continue
			}

			if taskExec.WaitState != nil {
				waitTask := &tasks.WaitTask{}
				taskExports[taskDef.ID] = waitTask.GetExports(taskExec.WaitState)
			}
			taskExec.Status = types.TaskStatusSuccess
			now := time.Now()
			taskExec.CompletedAt = &now
			e.logger.Info("Wait task satisfied", "workflow", execution.WorkflowID, "task", taskDef.ID)
			continue
		}

		if taskDef.Type == "workflow" {
			// Note: Condition checking is now handled by the general guard above
			// Handle workflow task - can use Workflow config or Parameters
			workflowConfig := taskDef.Workflow
			if workflowConfig == nil {
				// Try to build workflow config from parameters
				resolver := e.buildResolver(triggerEvent, taskExports)
				resolvedParams, err := resolver.Resolve(taskDef.Parameters)
				if err == nil {
					if params, ok := resolvedParams.(map[string]any); ok {
						workflowConfig = &types.WorkflowConfig{}
						if workflowID, ok := params["workflowId"].(string); ok {
							workflowConfig.WorkflowID = workflowID
						}
						if waitUntilCompletion, ok := params["waitUntilCompletion"].(bool); ok {
							workflowConfig.WaitUntilCompletion = waitUntilCompletion
						}
						if event, ok := params["event"].(string); ok {
							workflowConfig.Event = event
						}
						if eventData, ok := params["eventData"].(map[string]any); ok {
							workflowConfig.EventData = eventData
						}
					}
				}
			}

			if workflowConfig == nil || workflowConfig.WorkflowID == "" {
				taskExec.Status = types.TaskStatusFailed
				taskExec.Error = "workflow task missing workflowId"
				execution.Status = types.ExecutionStatusFailed
				execution.Error = "workflow task missing workflowId"
				now := time.Now()
				execution.CompletedAt = &now
				e.logger.Error("Workflow task missing workflowId", "workflow", execution.WorkflowID, "task", taskDef.ID)
				e.checkSubWorkflowCompletion(execution.ID)
				return
			}

			// Temporarily set Workflow config for handleWorkflowTask
			originalWorkflow := taskDef.Workflow
			taskDef.Workflow = workflowConfig
			workflowResult := e.handleWorkflowTask(execution, taskDef, taskExec, executionOrder, i, taskExports, triggerEvent)
			taskDef.Workflow = originalWorkflow // Restore original
			switch workflowResult {
			case "waiting":
				return
			case "failed":
				taskExec.Status = types.TaskStatusFailed
				execution.Status = types.ExecutionStatusFailed
				now := time.Now()
				execution.CompletedAt = &now
				e.logger.Error("Workflow task failed", "workflow", execution.WorkflowID, "task", taskDef.ID)
				e.checkSubWorkflowCompletion(execution.ID)
				return
			}

			// Workflow task completed (either immediately or after waiting)
			if taskExec.WorkflowState != nil && taskExec.WorkflowState.Completed {
				// Export the sub-workflow result
				exports := make(map[string]any)
				exports["executionId"] = taskExec.WorkflowState.ExecutionID
				exports["completed"] = true
				if taskExec.WorkflowState.Result != nil {
					exports["result"] = taskExec.WorkflowState.Result
					exports["variables"] = taskExec.WorkflowState.Result
				}
				taskExports[taskDef.ID] = exports
			} else {
				// Task completed immediately without waiting
				exports := make(map[string]any)
				if taskExec.WorkflowState != nil {
					exports["executionId"] = taskExec.WorkflowState.ExecutionID
				}
				exports["completed"] = false
				taskExports[taskDef.ID] = exports
			}
			taskExec.Status = types.TaskStatusSuccess
			now := time.Now()
			taskExec.CompletedAt = &now
			e.logger.Info("Workflow task completed", "workflow", execution.WorkflowID, "task", taskDef.ID)
			continue
		}

		result, err := e.executeTask(taskDef, execution, triggerEvent, taskExports)

		now := time.Now()
		taskExec.CompletedAt = &now
		taskExec.Result = result

		if err != nil {
			taskExec.Status = types.TaskStatusFailed
			taskExec.Error = err.Error()
			execution.Status = types.ExecutionStatusFailed
			execution.Error = err.Error()
			now := time.Now()
			execution.CompletedAt = &now
			e.logger.Error("Task failed", "workflow", execution.WorkflowID, "execution", execution.ID, "task", taskDef.ID, "error", err)
			e.checkSubWorkflowCompletion(execution.ID)
			return
		}

		taskExec.Status = types.TaskStatusSuccess

		publishTaskResultExports(taskExports, taskDef.ID, result)

		if result != nil && result.Data != nil {
			e.logger.Info("Task completed", "workflow", execution.WorkflowID, "execution", execution.ID, "task", taskDef.ID, "result", result.Data)
		} else {
			e.logger.Info("Task completed", "workflow", execution.WorkflowID, "execution", execution.ID, "task", taskDef.ID)
		}
	}

	execution.Status = types.ExecutionStatusCompleted
	now := time.Now()
	execution.CompletedAt = &now

	e.logger.Info("Workflow execution completed", "workflow", execution.WorkflowID, "execution", execution.ID, "status", execution.Status)

	// Check if any parent workflows are waiting for this execution to complete
	e.checkSubWorkflowCompletion(execution.ID)
}

// maxConcurrentTasks is the cap on tasks running together in one run.
func (e *Engine[TServices]) maxConcurrentTasks() int {
	if e.maxConcurrency > 0 {
		return e.maxConcurrency
	}
	return DefaultMaxConcurrentTasks
}

// executeConcurrentRun runs every task in `run` at the same time and joins
// before returning. Reports whether the execution should continue.
//
// A failing task fails the execution, as it does sequentially -- `OnError` is
// declared on TaskDefinition but not read anywhere in the engine, so there is
// only one failure behaviour to preserve. Siblings already in flight are left
// to finish rather than cancelled: they are independent by construction, and
// tearing them down halfway would make a task's side effects depend on how
// fast an unrelated sibling failed.
func (e *Engine[TServices]) executeConcurrentRun(
	execution *types.WorkflowExecution,
	executionOrder []*types.TaskDefinition,
	run concurrentRun,
	taskExports map[string]map[string]any,
	triggerEvent *types.Event,
) bool {
	// Guards read exports written by earlier tasks, all of which have
	// completed -- the run boundary is the happens-before edge. Resolving
	// every guard up front keeps that read off the concurrent path entirely.
	toRun := make([]*types.TaskDefinition, 0, run.Len())
	for i := run.Start; i < run.End; i++ {
		taskDef := executionOrder[i]
		taskExec := &types.TaskExecution{
			TaskID:    taskDef.ID,
			Status:    types.TaskStatusRunning,
			StartedAt: time.Now(),
		}
		execution.Tasks[taskDef.ID] = taskExec

		if taskDef.Condition == nil && len(taskDef.Conditions) == 0 {
			toRun = append(toRun, taskDef)
			continue
		}
		resolver := e.buildResolver(triggerEvent, taskExports)
		shouldRun, err := (&tasks.ConditionTask{}).Evaluate(taskDef, resolver)
		if err != nil {
			e.failExecution(execution, taskExec, err, "Task condition evaluation failed", taskDef.ID)
			return false
		}
		if !shouldRun {
			now := time.Now()
			taskExec.Status = types.TaskStatusSkipped
			taskExec.CompletedAt = &now
			taskExec.Result = &types.TaskResult{
				Status: types.TaskStatusSkipped,
				Data:   map[string]any{"skipped": true, "reason": "condition evaluated to false"},
			}
			e.logger.Info("Task skipped (condition false)", "workflow", execution.WorkflowID, "task", taskDef.ID)
			continue
		}
		toRun = append(toRun, taskDef)
	}

	if len(toRun) == 0 {
		return true
	}

	type outcome struct {
		taskDef *types.TaskDefinition
		result  *types.TaskResult
		err     error
	}
	results := make([]outcome, len(toRun))
	var wg sync.WaitGroup
	for idx, taskDef := range toRun {
		wg.Add(1)
		go func(idx int, taskDef *types.TaskDefinition) {
			defer wg.Done()
			// `taskExports` is only read here, and only for tasks that
			// completed before this run began -- no member of the run is
			// referenced by another (planConcurrentRun rejects the run
			// otherwise), so there is nothing to synchronise on the read side.
			result, err := e.executeTask(taskDef, execution, triggerEvent, taskExports)
			results[idx] = outcome{taskDef: taskDef, result: result, err: err}
		}(idx, taskDef)
	}
	wg.Wait()

	e.logger.Info("Concurrent task run completed", "workflow", execution.WorkflowID, "execution", execution.ID, "tasks", len(toRun))

	// Apply outcomes in declaration order so the recorded result, the logs and
	// the exports do not depend on which goroutine finished first.
	var firstFailure *outcome
	for i := range results {
		out := results[i]
		taskExec := execution.Tasks[out.taskDef.ID]
		now := time.Now()
		taskExec.CompletedAt = &now
		taskExec.Result = out.result

		if out.err != nil {
			taskExec.Status = types.TaskStatusFailed
			taskExec.Error = out.err.Error()
			e.logger.Error("Task failed", "workflow", execution.WorkflowID, "execution", execution.ID, "task", out.taskDef.ID, "error", out.err)
			if firstFailure == nil {
				firstFailure = &results[i]
			}
			continue
		}

		taskExec.Status = types.TaskStatusSuccess
		publishTaskResultExports(taskExports, out.taskDef.ID, out.result)
		e.logger.Info("Task completed", "workflow", execution.WorkflowID, "execution", execution.ID, "task", out.taskDef.ID)
	}

	if firstFailure != nil {
		execution.Status = types.ExecutionStatusFailed
		execution.Error = firstFailure.err.Error()
		now := time.Now()
		execution.CompletedAt = &now
		e.checkSubWorkflowCompletion(execution.ID)
		return false
	}
	return true
}

// failExecution records a task-level error as an execution failure. Extracted
// so the concurrent path fails identically to the sequential one.
func (e *Engine[TServices]) failExecution(execution *types.WorkflowExecution, taskExec *types.TaskExecution, err error, msg, taskID string) {
	now := time.Now()
	taskExec.Status = types.TaskStatusFailed
	taskExec.Error = err.Error()
	taskExec.CompletedAt = &now
	execution.Status = types.ExecutionStatusFailed
	execution.Error = err.Error()
	execution.CompletedAt = &now
	e.logger.Error(msg, "workflow", execution.WorkflowID, "task", taskID, "error", err)
	e.checkSubWorkflowCompletion(execution.ID)
}

func (e *Engine[TServices]) buildResolver(triggerEvent *types.Event, taskExports map[string]map[string]any) *expression.Resolver {
	resolver := expression.NewResolver()

	resolver.AddSource("trigger", triggerEvent.TriggerFields())

	for taskID, exports := range taskExports {
		resolver.AddSource(taskID, exports)
	}

	if e.assetURLResolver != nil {
		// The resolver returns the bare overlay.publicUrl value; the
		// /overlay/assets suffix is asset-resolution-specific, not part of
		// the setting itself (see OverlayPublicURLResolver doc comment).
		resolver.SetAssetURLBase(e.assetURLResolver.Resolve() + "/overlay/assets")
	}

	return resolver
}

// resolveApplicationID looks up the owning workflow's applicationId from the
// registry. Mirrors the fallback used for action-handler attribution
// (executeTask below) — a missing definition just yields "".
func (e *Engine[TServices]) resolveApplicationID(workflowID string) string {
	if def, err := e.workflowRegistry.Get(workflowID); err == nil && def != nil {
		return def.ApplicationID
	}
	return ""
}

func (e *Engine[TServices]) handleWaitTask(execution *types.WorkflowExecution, taskDef *types.TaskDefinition, taskExec *types.TaskExecution, executionOrder []*types.TaskDefinition, currentIndex int, taskExports map[string]map[string]any, triggerEvent *types.Event) string {
	if taskExec.WaitState == nil {
		waitTask := &tasks.WaitTask{}
		taskExec.WaitState = waitTask.InitWaitState(taskDef, execution)
		taskExec.Status = types.TaskStatusWaiting
		execution.Status = types.ExecutionStatusWaiting

		e.waitingMu.Lock()
		waitingExec := &WaitingExecution{
			ExecutionID:    execution.ID,
			WorkflowID:     execution.WorkflowID,
			TaskID:         taskDef.ID,
			TaskDef:        taskDef,
			ExecutionOrder: executionOrder,
			CurrentIndex:   currentIndex,
			TaskExports:    taskExports,
			TriggerEvent:   triggerEvent,
		}
		e.waitingExecutions[taskDef.Wait.Event] = append(e.waitingExecutions[taskDef.Wait.Event], waitingExec)
		e.waitingMu.Unlock()

		e.logger.Info("Task waiting for events", "workflow", execution.WorkflowID, "task", taskDef.ID, "event", taskDef.Wait.Event)
		return "waiting"
	}

	waitTask := &tasks.WaitTask{}
	if waitTask.CheckTimeout(taskExec.WaitState) {
		return "timeout"
	}

	if taskExec.WaitState.Satisfied {
		return "satisfied"
	}

	return "waiting"
}

func (e *Engine[TServices]) handleWorkflowTask(execution *types.WorkflowExecution, taskDef *types.TaskDefinition, taskExec *types.TaskExecution, executionOrder []*types.TaskDefinition, currentIndex int, taskExports map[string]map[string]any, triggerEvent *types.Event) string {
	if taskExec.WorkflowState == nil {
		// Resolve workflow config parameters
		resolver := e.buildResolver(triggerEvent, taskExports)

		// Resolve workflowID if it contains expressions
		workflowIDRaw := taskDef.Workflow.WorkflowID
		if workflowIDRaw == "" {
			e.logger.Error("Workflow task missing workflowId", "workflow", execution.WorkflowID, "task", taskDef.ID)
			return "failed"
		}

		workflowIDResolved, err := resolver.ResolveString(workflowIDRaw)
		if err != nil {
			e.logger.Error("Failed to resolve workflowId", "workflow", execution.WorkflowID, "task", taskDef.ID, "error", err)
			return "failed"
		}

		workflowID, ok := workflowIDResolved.(string)
		if !ok {
			e.logger.Error("WorkflowId must resolve to a string", "workflow", execution.WorkflowID, "task", taskDef.ID)
			return "failed"
		}

		if workflowID == "" {
			e.logger.Error("Resolved workflowId is empty", "workflow", execution.WorkflowID, "task", taskDef.ID)
			return "failed"
		}

		// Get the workflow definition
		wf, err := e.workflowRegistry.Get(workflowID)
		if err != nil {
			e.logger.Error("Workflow not found", "workflow", execution.WorkflowID, "task", taskDef.ID, "subWorkflow", workflowID, "error", err)
			return "failed"
		}

		// Create event data for the sub-workflow
		eventData := make(map[string]any)
		if taskDef.Workflow.EventData != nil {
			// Resolve event data using resolver
			resolvedData, err := resolver.Resolve(taskDef.Workflow.EventData)
			if err == nil {
				if dataMap, ok := resolvedData.(map[string]any); ok {
					eventData = dataMap
				}
			}
		}

		// Determine the NATS subject — use the sub-workflow task's
		// explicit `event` if set, then fall back to the target
		// workflow's trigger event, then a generic default.
		eventSubject := taskDef.Workflow.Event
		if eventSubject == "" && wf.Trigger != nil {
			eventSubject = wf.Trigger.Event
		}
		if eventSubject == "" {
			eventSubject = "workflow.trigger"
		}

		// Create trigger event for the sub-workflow
		subEvent := &types.Event{
			ID:     uuid.New().String(),
			Type:   eventSubject,
			Source: "workflow-task",
			Time:   time.Now(),
			Data:   eventData,
		}

		// Execute the sub-workflow
		subExecutionID := e.executeWorkflowSync(wf, subEvent)
		if subExecutionID == "" {
			e.logger.Error("Failed to execute sub-workflow", "workflow", execution.WorkflowID, "task", taskDef.ID, "subWorkflow", workflowID)
			return "failed"
		}

		// Initialize workflow state
		timeout := time.Now().Add(5 * time.Minute) // Default timeout
		if taskDef.Workflow.Timeout != nil {
			timeout = time.Now().Add(taskDef.Workflow.Timeout.Duration)
		}

		taskExec.WorkflowState = &types.WorkflowState{
			SubWorkflowID:       workflowID,
			ExecutionID:         subExecutionID,
			WaitUntilCompletion: taskDef.Workflow.WaitUntilCompletion,
			Timeout:             timeout,
			Completed:           false,
		}

		// If not waiting for completion, we're done
		if !taskDef.Workflow.WaitUntilCompletion {
			taskExec.WorkflowState.Completed = true
			return "completed"
		}

		// If waiting for completion, mark as waiting and register the waiter
		taskExec.Status = types.TaskStatusWaiting
		execution.Status = types.ExecutionStatusWaiting

		e.subWorkflowWaitersMu.Lock()
		waiter := &SubWorkflowWaiter{
			ParentExecutionID: execution.ID,
			ParentWorkflowID:  execution.WorkflowID,
			TaskID:            taskDef.ID,
			TaskDef:           taskDef,
			ExecutionOrder:    executionOrder,
			CurrentIndex:      currentIndex,
			TaskExports:       taskExports,
			TriggerEvent:      triggerEvent,
		}
		e.subWorkflowWaiters[subExecutionID] = append(e.subWorkflowWaiters[subExecutionID], waiter)
		e.subWorkflowWaitersMu.Unlock()

		e.logger.Info("Workflow task waiting for sub-workflow completion", "workflow", execution.WorkflowID, "task", taskDef.ID, "subWorkflow", workflowID, "subExecution", subExecutionID)
		return "waiting"
	}

	// Check if the sub-workflow has completed
	e.executionsMu.RLock()
	subExecution, exists := e.executions[taskExec.WorkflowState.ExecutionID]
	e.executionsMu.RUnlock()

	if !exists {
		e.logger.Error("Sub-workflow execution not found", "workflow", execution.WorkflowID, "task", taskDef.ID, "subExecution", taskExec.WorkflowState.ExecutionID)
		return "failed"
	}

	// Check timeout
	if time.Now().After(taskExec.WorkflowState.Timeout) {
		e.logger.Error("Workflow task timed out waiting for sub-workflow", "workflow", execution.WorkflowID, "task", taskDef.ID, "subExecution", taskExec.WorkflowState.ExecutionID)
		return "failed"
	}

	// Check if completed
	if subExecution.Status == types.ExecutionStatusCompleted {
		taskExec.WorkflowState.Completed = true
		taskExec.WorkflowState.Result = subExecution.Variables
		return "completed"
	}

	if subExecution.Status == types.ExecutionStatusFailed {
		e.logger.Error("Sub-workflow execution failed", "workflow", execution.WorkflowID, "task", taskDef.ID, "subExecution", taskExec.WorkflowState.ExecutionID, "error", subExecution.Error)
		return "failed"
	}

	// Still running or waiting
	return "waiting"
}

func (e *Engine[TServices]) executeWorkflowSync(wf *types.WorkflowDefinition, event *types.Event) string {
	executionID := uuid.New().String()

	execution := &types.WorkflowExecution{
		ID:           executionID,
		WorkflowID:   wf.ID,
		Status:       types.ExecutionStatusRunning,
		TriggerEvent: event,
		StartedAt:    time.Now(),
		Tasks:        make(map[string]*types.TaskExecution),
		Variables:    make(map[string]any),
	}

	e.executionsMu.Lock()
	e.executions[executionID] = execution
	e.executionsMu.Unlock()

	e.logger.Info("Starting sub-workflow execution", "workflow", wf.ID, "execution", executionID)

	// Execute in a goroutine (async)
	go e.executeWorkflowInternal(wf, execution, event)

	return executionID
}

func (e *Engine[TServices]) executeWorkflowInternal(wf *types.WorkflowDefinition, execution *types.WorkflowExecution, event *types.Event) {
	taskExports := make(map[string]map[string]any)

	graph, err := NewDependencyGraph(wf.Tasks)
	if err != nil {
		execution.Status = types.ExecutionStatusFailed
		execution.Error = err.Error()
		e.logger.Error("Failed to build dependency graph", "workflow", wf.ID, "execution", execution.ID, "error", err)
		now := time.Now()
		execution.CompletedAt = &now
		e.checkSubWorkflowCompletion(execution.ID)
		return
	}

	executionOrder, err := graph.GetExecutionOrder()
	if err != nil {
		execution.Status = types.ExecutionStatusFailed
		execution.Error = err.Error()
		e.logger.Error("Failed to resolve execution order", "workflow", wf.ID, "execution", execution.ID, "error", err)
		now := time.Now()
		execution.CompletedAt = &now
		e.checkSubWorkflowCompletion(execution.ID)
		return
	}

	e.executeTasksFromIndex(execution, executionOrder, 0, taskExports, event)
}

func (e *Engine[TServices]) checkSubWorkflowCompletion(subExecutionID string) {
	e.subWorkflowWaitersMu.Lock()
	waiters, exists := e.subWorkflowWaiters[subExecutionID]
	if !exists || len(waiters) == 0 {
		e.subWorkflowWaitersMu.Unlock()
		return
	}

	// Remove from waiters map
	delete(e.subWorkflowWaiters, subExecutionID)
	e.subWorkflowWaitersMu.Unlock()

	// Get the sub-execution status
	e.executionsMu.RLock()
	subExecution, exists := e.executions[subExecutionID]
	e.executionsMu.RUnlock()

	if !exists {
		return
	}

	// Resume all parent executions waiting for this sub-workflow
	for _, waiter := range waiters {
		go e.resumeSubWorkflowExecution(waiter, subExecution)
	}
}

func (e *Engine[TServices]) resumeSubWorkflowExecution(waiter *SubWorkflowWaiter, subExecution *types.WorkflowExecution) {
	e.executionsMu.RLock()
	execution := e.executions[waiter.ParentExecutionID]
	e.executionsMu.RUnlock()

	if execution == nil {
		return
	}

	taskExec := execution.Tasks[waiter.TaskID]
	if taskExec != nil && taskExec.WorkflowState != nil {
		taskExec.WorkflowState.Completed = true
		switch subExecution.Status {
		case types.ExecutionStatusCompleted:
			taskExec.WorkflowState.Result = subExecution.Variables
			taskExec.Status = types.TaskStatusSuccess
		case types.ExecutionStatusFailed:
			// Sub-workflow failed, fail the parent task
			taskExec.Status = types.TaskStatusFailed
			taskExec.Error = fmt.Sprintf("sub-workflow execution failed: %s", subExecution.Error)
		default:
			// Shouldn't happen, but handle it
			taskExec.Status = types.TaskStatusFailed
			taskExec.Error = "sub-workflow execution status unknown"
		}
		now := time.Now()
		taskExec.CompletedAt = &now
	}

	// If the task failed, mark the execution as failed and return
	if taskExec != nil && taskExec.Status == types.TaskStatusFailed {
		execution.Status = types.ExecutionStatusFailed
		execution.Error = taskExec.Error
		now := time.Now()
		execution.CompletedAt = &now
		e.logger.Error("Workflow execution failed due to sub-workflow failure", "workflow", waiter.ParentWorkflowID, "execution", waiter.ParentExecutionID, "task", waiter.TaskID, "error", taskExec.Error)
		e.checkSubWorkflowCompletion(execution.ID)
		return
	}

	execution.Status = types.ExecutionStatusRunning

	e.logger.Info("Resuming workflow execution after sub-workflow completion", "workflow", waiter.ParentWorkflowID, "execution", waiter.ParentExecutionID, "fromTask", waiter.TaskID, "subExecution", subExecution.ID)

	e.executeTasksFromIndex(execution, waiter.ExecutionOrder, waiter.CurrentIndex+1, waiter.TaskExports, waiter.TriggerEvent)
}

func (e *Engine[TServices]) resumeExecution(w *WaitingExecution) {
	e.executionsMu.RLock()
	execution := e.executions[w.ExecutionID]
	e.executionsMu.RUnlock()

	if execution == nil {
		return
	}

	taskExec := execution.Tasks[w.TaskID]
	if taskExec != nil {
		waitTask := &tasks.WaitTask{}
		w.TaskExports[w.TaskID] = waitTask.GetExports(taskExec.WaitState)
		taskExec.Status = types.TaskStatusSuccess
		now := time.Now()
		taskExec.CompletedAt = &now
	}

	execution.Status = types.ExecutionStatusRunning

	e.logger.Info("Resuming workflow execution", "workflow", w.WorkflowID, "execution", w.ExecutionID, "fromTask", w.TaskID)

	e.executeTasksFromIndex(execution, w.ExecutionOrder, w.CurrentIndex+1, w.TaskExports, w.TriggerEvent)
}

func (e *Engine[TServices]) executeTask(taskDef *types.TaskDefinition, execution *types.WorkflowExecution, event *types.Event, taskExports map[string]map[string]any) (*types.TaskResult, error) {
	resolver := e.buildResolver(event, taskExports)

	// Diagnostic: log what the resolver will see and what it produced.
	// Workflow authors hit "${trigger.data.X} not substituted" most often
	// because X isn't actually on event.Data (different field name, or
	// nested deeper). Logging both sides makes the mismatch obvious.
	e.logger.Info("Resolving task parameters",
		"workflow", execution.WorkflowID,
		"execution", execution.ID,
		"task", taskDef.ID,
		"action", taskDef.Action,
		"trigger.id", event.ID,
		"trigger.type", event.Type,
		"trigger.source", event.Source,
		"trigger.data", event.Data,
		"taskExports.keys", taskExportKeys(taskExports),
		"parameters.before", taskDef.Parameters,
	)

	resolvedParams, err := resolver.Resolve(taskDef.Parameters)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve parameters: %w", err)
	}

	e.logger.Info("Resolved task parameters",
		"workflow", execution.WorkflowID,
		"task", taskDef.ID,
		"parameters.after", resolvedParams,
	)

	params, ok := resolvedParams.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("resolved parameters must be a map")
	}

	task, err := e.taskRegistry.Create(taskDef, params)
	if err != nil {
		return nil, fmt.Errorf("failed to create task: %w", err)
	}

	// Resolve the owning workflow's applicationId so action handlers can
	// attribute their side effects (e.g. NewAlertAction stamps it onto
	// the published envelope). A missing definition is non-fatal — we
	// just leave ApplicationID empty and let downstream consumers fall
	// back to their own resolution.
	applicationID := e.resolveApplicationID(execution.WorkflowID)

	taskCtx := &tasks.TaskContext{
		WorkflowID:    execution.WorkflowID,
		ApplicationID: applicationID,
		TaskID:        taskDef.ID,
		TriggerEvent:  event,
		Variables:     execution.Variables,
		TaskExports:   taskExports,
		Logger:        e.logger,
	}

	result, err := task.Execute(taskCtx)
	if err != nil {
		return result, err
	}

	if result != nil && taskDef.Exports != nil && result.Data != nil {
		if result.Exports == nil {
			result.Exports = make(map[string]any)
		}
		for exportName, dataPath := range taskDef.Exports {
			value, pathErr := expression.ResolvePath(result.Data, dataPath)
			if pathErr == nil {
				result.Exports[exportName] = value
			}
		}
	}

	return result, nil
}

// taskExportKeys returns just the step ids that have published exports,
// for diagnostic logging. Logging the full export map would dump
// arbitrarily large prior-step output into the log; the keys alone are
// enough for an author to know which `${stepId.X}` references are
// available in this scope.
func taskExportKeys(taskExports map[string]map[string]any) []string {
	keys := make([]string, 0, len(taskExports))
	for k := range taskExports {
		keys = append(keys, k)
	}
	return keys
}

// publishTaskResultExports exposes a completed task's outputs for ${taskId.*}
// references. Explicit export mappings win; otherwise the full result Data map
// is published (e.g. function action return values like `{ sent: true }`).
func publishTaskResultExports(taskExports map[string]map[string]any, taskID string, result *types.TaskResult) {
	if result == nil {
		return
	}
	exports := result.Exports
	if exports == nil && result.Data != nil {
		exports = result.Data
	}
	if exports != nil {
		taskExports[taskID] = exports
	}
}

func (e *Engine[TServices]) GetExecution(id string) (*types.WorkflowExecution, error) {
	e.executionsMu.RLock()
	defer e.executionsMu.RUnlock()

	exec, ok := e.executions[id]
	if !ok {
		return nil, fmt.Errorf("execution not found: %s", id)
	}
	return exec, nil
}

func (e *Engine[TServices]) Start(ctx context.Context) error {
	e.logger.Info("Workflow engine started")
	<-ctx.Done()
	e.logger.Info("Workflow engine stopping")
	return nil
}

func (e *Engine[TServices]) Stop() error {
	e.cancel()
	e.logger.Info("Workflow engine stopped")
	return nil
}
