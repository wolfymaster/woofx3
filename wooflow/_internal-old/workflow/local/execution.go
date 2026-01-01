package local

import (
        "context"
        "fmt"
        "strings"
        "time"

        "github.com/wolfymaster/woofx3/wooflow/internal/core"
)

// executeStep executes a workflow step (action or wait)
func (e *Engine) executeStep(ctx context.Context, instance *WorkflowInstance, step core.Step, stepResult *map[string]any) error {
        switch step.Type {
        case "action":
                return e.executeActionStep(ctx, instance, step, stepResult)
        case "wait":
                return e.executeWaitStep(ctx, instance, step)
        default:
                return fmt.Errorf("unknown step type: %s", step.Type)
        }
}

// executeActionStep executes an action step
func (e *Engine) executeActionStep(ctx context.Context, instance *WorkflowInstance, step core.Step, stepResult *map[string]any) error {
        instance.Context.Logger.Info("Executing action step", "stepID", step.ID, "action", step.Action)

        // Resolve parameters
        resolvedParams, err := e.resolveParameterReferences(step.Parameters, instance.Context)
        if err != nil {
                return fmt.Errorf("failed to resolve parameters: %w", err)
        }

        // Merge with trigger event payload
        for key, value := range instance.Context.TriggeredBy.Payload {
                if _, exists := resolvedParams[key]; !exists {
                        resolvedParams[key] = value
                }
        }

        // Get activity function
        e.mu.RLock()
        activity, exists := e.activities[step.Action]
        e.mu.RUnlock()

        if !exists {
                return fmt.Errorf("activity not found: %s", step.Action)
        }

        // Execute activity with timeout
        activityCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
        defer cancel()

        result, err := activity(activityCtx, resolvedParams)
        if err != nil {
                if step.Critical {
                        return fmt.Errorf("critical step failed: %w", err)
                }
                (*stepResult)["error"] = err.Error()
                return nil
        }

        // Store exports in step result
        if result.Exports != nil {
                for key, value := range result.Exports {
                        (*stepResult)[key] = value
                }
        }

        (*stepResult)["success"] = result.Success
        
        return nil
}

// executeWaitStep executes a wait step
func (e *Engine) executeWaitStep(ctx context.Context, instance *WorkflowInstance, step core.Step) error {
        instance.Context.Logger.Info("Executing wait step", "stepID", step.ID)

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
        e.mu.Lock()
        if _, exists := e.waitingList[waitForEvent]; !exists {
                e.waitingList[waitForEvent] = make([]string, 0)
        }
        e.waitingList[waitForEvent] = append(e.waitingList[waitForEvent], instance.ID)
        e.state.WaitingWorkflows++
        e.mu.Unlock()

        // Mark instance as waiting
        instance.mu.Lock()
        instance.State = StateWaiting
        instance.mu.Unlock()

        instance.Context.Logger.Info("Workflow waiting for event", "workflowID", instance.ID, "eventType", waitForEvent)

        // For the local implementation, we'll use a simpler approach than Temporal's signals
        // The workflow will be resumed when the event arrives via signalWaitingWorkflows
        return nil
}

// buildDependencyGraph builds a dependency graph for workflow steps
func (e *Engine) buildDependencyGraph(steps []core.Step) map[string][]string {
        graph := make(map[string][]string)
        
        for _, step := range steps {
                graph[step.ID] = step.DependsOn
        }
        
        return graph
}

// findExecutableSteps finds steps that can be executed (dependencies satisfied)
func (e *Engine) findExecutableSteps(steps []core.Step, dependencyGraph map[string][]string, completedSteps map[string]bool) []core.Step {
        var executable []core.Step
        
        for _, step := range steps {
                if completedSteps[step.ID] {
                        continue
                }
                
                canExecute := true
                dependencies := dependencyGraph[step.ID]
                
                for _, dep := range dependencies {
                        if !completedSteps[dep] {
                                canExecute = false
                                break
                        }
                }
                
                if canExecute {
                        executable = append(executable, step)
                }
        }
        
        return executable
}

// resolveParameterReferences resolves parameter references in the workflow context
func (e *Engine) resolveParameterReferences(params map[string]interface{}, wfCtx *WorkflowContext) (map[string]interface{}, error) {
        resolved := make(map[string]interface{})
        
        for key, value := range params {
                resolvedValue, err := e.resolveParameterReference(value, wfCtx)
                if err != nil {
                        return nil, fmt.Errorf("failed to resolve parameter %s: %w", key, err)
                }
                resolved[key] = resolvedValue
        }
        
        return resolved, nil
}

// resolveParameterReference resolves a single parameter reference
func (e *Engine) resolveParameterReference(value interface{}, wfCtx *WorkflowContext) (interface{}, error) {
        if strValue, ok := value.(string); ok && strings.HasPrefix(strValue, "$") {
                // Handle parameter references like $trigger.payload.username
                reference := strings.TrimPrefix(strValue, "$")
                parts := strings.Split(reference, ".")
                
                switch parts[0] {
                case "trigger":
                        if len(parts) > 1 && parts[1] == "payload" {
                                if len(parts) == 2 {
                                        return wfCtx.TriggeredBy.Payload, nil
                                }
                                // Navigate deeper into payload
                                current := wfCtx.TriggeredBy.Payload
                                for i := 2; i < len(parts); i++ {
                                        if currentMap, ok := current.(map[string]any); ok {
                                                if val, exists := currentMap[parts[i]]; exists {
                                                        current = val
                                                } else {
                                                        return nil, fmt.Errorf("reference not found: %s", reference)
                                                }
                                        } else {
                                                return nil, fmt.Errorf("cannot navigate reference: %s", reference)
                                        }
                                }
                                return current, nil
                        }
                case "variables":
                        if len(parts) > 1 {
                                if val, exists := wfCtx.Variables[parts[1]]; exists {
                                        return val, nil
                                }
                        }
                case "steps":
                        if len(parts) > 1 {
                                if stepResult, exists := wfCtx.StepResults[parts[1]]; exists {
                                        if len(parts) == 2 {
                                                return stepResult, nil
                                        }
                                        // Navigate deeper into step result
                                        current := stepResult
                                        for i := 2; i < len(parts); i++ {
                                                if currentMap, ok := current.(map[string]any); ok {
                                                        if val, exists := currentMap[parts[i]]; exists {
                                                                current = val
                                                        } else {
                                                                return nil, fmt.Errorf("step result reference not found: %s", reference)
                                                        }
                                                } else {
                                                        return nil, fmt.Errorf("cannot navigate step result reference: %s", reference)
                                                }
                                        }
                                        return current, nil
                                }
                        }
                }
                
                return nil, fmt.Errorf("unresolved reference: %s", reference)
        }
        
        // Return value as-is if not a reference
        return value, nil
}

// evaluateConditions evaluates workflow trigger conditions
func (e *Engine) evaluateConditions(payload map[string]interface{}, condition interface{}) bool {
        // Simple condition evaluation - in a real implementation this would be more sophisticated
        if condition == nil {
                return true
        }
        
        // For now, just return true - conditions can be implemented later
        return true
}