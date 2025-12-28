package engine

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type EventPublisher interface {
	Publish(event *types.Event) error
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
	logger               tasks.Logger
	ctx                  context.Context
	cancel               context.CancelFunc
	servicesBuilder      tasks.ServicesBuilder[TServices]
	appContext           interface{}
}

type SubWorkflowWaiter struct {
	ParentExecutionID string
	ParentWorkflowID  string
	TaskID            string
	TaskDef           *types.TaskDefinition
	ExecutionOrder    []*types.TaskDefinition
	CurrentIndex      int
	TaskExports       map[string]map[string]interface{}
	TriggerEvent      *types.Event
}

type WaitingExecution struct {
	ExecutionID    string
	WorkflowID     string
	TaskID         string
	TaskDef        *types.TaskDefinition
	ExecutionOrder []*types.TaskDefinition
	CurrentIndex   int
	TaskExports    map[string]map[string]interface{}
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
	// Create a factory that closes over the engine to get the current servicesBuilder
	e.taskRegistry.Register("action", func(params map[string]interface{}) (tasks.Task, error) {
		return tasks.NewActionTask(e.actionRegistry, e.servicesBuilder, e.appContext)(params)
	})
	e.taskRegistry.Register("wait", tasks.NewWaitTask())
	e.taskRegistry.Register("condition", tasks.NewConditionTask())
	e.taskRegistry.Register("workflow", tasks.NewWorkflowTask())
}

func (e *Engine[TServices]) SetServices(builder tasks.ServicesBuilder[TServices], appContext interface{}) {
	e.servicesBuilder = builder
	e.appContext = appContext
	e.registerBuiltInTasks() // Re-register to update action task with new builder
}

func (e *Engine[TServices]) RegisterWorkflow(def *types.WorkflowDefinition) error {
	return e.workflowRegistry.Register(def)
}

func (e *Engine[TServices]) RegisterAction(name string, action tasks.ActionFunc[TServices]) error {
	return e.actionRegistry.Register(name, action)
}

func (e *Engine[TServices]) SetPublisher(publisher EventPublisher) {
	e.publisher = publisher
	e.registerPublishAction()
}

func (e *Engine[TServices]) registerPublishAction() {
	e.actionRegistry.Register("publish_event", func(ctx tasks.ActionContext[TServices], params map[string]interface{}) (map[string]interface{}, error) {
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
			Data:   make(map[string]interface{}),
		}

		if data, ok := params["data"].(map[string]interface{}); ok {
			event.Data = data
		}

		if source, ok := params["source"].(string); ok {
			event.Source = source
		}

		if err := e.publisher.Publish(event); err != nil {
			return nil, fmt.Errorf("failed to publish event: %w", err)
		}

		e.logger.Info("Published event", "type", eventType, "id", event.ID)

		return map[string]interface{}{
			"eventId":   event.ID,
			"eventType": eventType,
			"published": true,
		}, nil
	})
}

func (e *Engine[TServices]) HandleEvent(event *types.Event) error {
	e.processWaitingExecutions(event)

	workflows := e.workflowRegistry.GetByEventType(event.Type)

	for _, wf := range workflows {
		if err := e.evaluateTrigger(wf, event); err == nil {
			go e.executeWorkflow(wf, event)
		}
	}

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

	if wf.Trigger.EventType != event.Type {
		return fmt.Errorf("event type mismatch")
	}

	return nil
}

func (e *Engine[TServices]) executeWorkflow(wf *types.WorkflowDefinition, event *types.Event) {
	executionID := uuid.New().String()

	execution := &types.WorkflowExecution{
		ID:           executionID,
		WorkflowID:   wf.ID,
		Status:       types.ExecutionStatusRunning,
		TriggerEvent: event,
		StartedAt:    time.Now(),
		Tasks:        make(map[string]*types.TaskExecution),
		Variables:    make(map[string]interface{}),
	}

	taskExports := make(map[string]map[string]interface{})

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
		return
	}

	executionOrder, err := graph.GetExecutionOrder()
	if err != nil {
		execution.Status = types.ExecutionStatusFailed
		execution.Error = err.Error()
		e.logger.Error("Failed to resolve execution order", "workflow", wf.ID, "execution", executionID, "error", err)
		now := time.Now()
		execution.CompletedAt = &now
		return
	}

	e.executeTasksFromIndex(execution, executionOrder, 0, taskExports, event)
}

func (e *Engine[TServices]) executeTasksFromIndex(execution *types.WorkflowExecution, executionOrder []*types.TaskDefinition, startIndex int, taskExports map[string]map[string]interface{}, triggerEvent *types.Event) {
	skippedTasks := make(map[string]bool)

	for i := startIndex; i < len(executionOrder); i++ {
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
					Data: map[string]interface{}{
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
				Data: map[string]interface{}{
					"result":        result,
					"branchTaken":   branchTasks,
					"branchSkipped": skippedBranch,
				},
				Exports: map[string]interface{}{
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
					if params, ok := resolvedParams.(map[string]interface{}); ok {
						workflowConfig = &types.WorkflowConfig{}
						if workflowID, ok := params["workflowId"].(string); ok {
							workflowConfig.WorkflowID = workflowID
						}
						if waitUntilCompletion, ok := params["waitUntilCompletion"].(bool); ok {
							workflowConfig.WaitUntilCompletion = waitUntilCompletion
						}
						if eventType, ok := params["eventType"].(string); ok {
							workflowConfig.EventType = eventType
						}
						if eventData, ok := params["eventData"].(map[string]interface{}); ok {
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
				exports := make(map[string]interface{})
				exports["executionId"] = taskExec.WorkflowState.ExecutionID
				exports["completed"] = true
				if taskExec.WorkflowState.Result != nil {
					exports["result"] = taskExec.WorkflowState.Result
					exports["variables"] = taskExec.WorkflowState.Result
				}
				taskExports[taskDef.ID] = exports
			} else {
				// Task completed immediately without waiting
				exports := make(map[string]interface{})
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

		if result != nil && result.Exports != nil {
			taskExports[taskDef.ID] = result.Exports
		}

		e.logger.Info("Task completed", "workflow", execution.WorkflowID, "execution", execution.ID, "task", taskDef.ID)
	}

	execution.Status = types.ExecutionStatusCompleted
	now := time.Now()
	execution.CompletedAt = &now

	e.logger.Info("Workflow execution completed", "workflow", execution.WorkflowID, "execution", execution.ID, "status", execution.Status)

	// Check if any parent workflows are waiting for this execution to complete
	e.checkSubWorkflowCompletion(execution.ID)
}

func (e *Engine[TServices]) buildResolver(triggerEvent *types.Event, taskExports map[string]map[string]interface{}) *expression.Resolver {
	resolver := expression.NewResolver()

	triggerData := map[string]interface{}{
		"id":     triggerEvent.ID,
		"type":   triggerEvent.Type,
		"source": triggerEvent.Source,
		"time":   triggerEvent.Time,
		"data":   triggerEvent.Data,
	}
	resolver.AddSource("trigger", triggerData)

	for taskID, exports := range taskExports {
		resolver.AddSource(taskID, exports)
	}

	return resolver
}

func (e *Engine[TServices]) handleWaitTask(execution *types.WorkflowExecution, taskDef *types.TaskDefinition, taskExec *types.TaskExecution, executionOrder []*types.TaskDefinition, currentIndex int, taskExports map[string]map[string]interface{}, triggerEvent *types.Event) string {
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
		e.waitingExecutions[taskDef.Wait.EventType] = append(e.waitingExecutions[taskDef.Wait.EventType], waitingExec)
		e.waitingMu.Unlock()

		e.logger.Info("Task waiting for events", "workflow", execution.WorkflowID, "task", taskDef.ID, "eventType", taskDef.Wait.EventType)
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

func (e *Engine[TServices]) handleWorkflowTask(execution *types.WorkflowExecution, taskDef *types.TaskDefinition, taskExec *types.TaskExecution, executionOrder []*types.TaskDefinition, currentIndex int, taskExports map[string]map[string]interface{}, triggerEvent *types.Event) string {
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
		eventData := make(map[string]interface{})
		if taskDef.Workflow.EventData != nil {
			// Resolve event data using resolver
			resolvedData, err := resolver.Resolve(taskDef.Workflow.EventData)
			if err == nil {
				if dataMap, ok := resolvedData.(map[string]interface{}); ok {
					eventData = dataMap
				}
			}
		}

		// Determine event type - use the workflow's trigger event type or a default
		eventType := taskDef.Workflow.EventType
		if eventType == "" && wf.Trigger != nil {
			eventType = wf.Trigger.EventType
		}
		if eventType == "" {
			eventType = "workflow.trigger"
		}

		// Create trigger event for the sub-workflow
		subEvent := &types.Event{
			ID:     uuid.New().String(),
			Type:   eventType,
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
		Variables:    make(map[string]interface{}),
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
	taskExports := make(map[string]map[string]interface{})

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
		if subExecution.Status == types.ExecutionStatusCompleted {
			taskExec.WorkflowState.Result = subExecution.Variables
			taskExec.Status = types.TaskStatusSuccess
		} else if subExecution.Status == types.ExecutionStatusFailed {
			// Sub-workflow failed, fail the parent task
			taskExec.Status = types.TaskStatusFailed
			taskExec.Error = fmt.Sprintf("sub-workflow execution failed: %s", subExecution.Error)
		} else {
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

func (e *Engine[TServices]) executeTask(taskDef *types.TaskDefinition, execution *types.WorkflowExecution, event *types.Event, taskExports map[string]map[string]interface{}) (*types.TaskResult, error) {
	resolver := expression.NewResolver()

	triggerData := map[string]interface{}{
		"id":     event.ID,
		"type":   event.Type,
		"source": event.Source,
		"time":   event.Time,
		"data":   event.Data,
	}
	resolver.AddSource("trigger", triggerData)

	for taskID, exports := range taskExports {
		resolver.AddSource(taskID, exports)
	}

	resolvedParams, err := resolver.Resolve(taskDef.Parameters)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve parameters: %w", err)
	}

	params, ok := resolvedParams.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("resolved parameters must be a map")
	}

	task, err := e.taskRegistry.Create(taskDef.Type, params)
	if err != nil {
		return nil, fmt.Errorf("failed to create task: %w", err)
	}

	taskCtx := &tasks.TaskContext{
		WorkflowID:   execution.WorkflowID,
		TaskID:       taskDef.ID,
		TriggerEvent: event,
		Variables:    execution.Variables,
		TaskExports:  taskExports,
		Logger:       e.logger,
	}

	result, err := task.Execute(taskCtx)
	if err != nil {
		return result, err
	}

	if result != nil && taskDef.Exports != nil && result.Data != nil {
		if result.Exports == nil {
			result.Exports = make(map[string]interface{})
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
