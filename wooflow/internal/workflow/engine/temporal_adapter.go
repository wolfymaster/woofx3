package engine

import (
        "context"

        "github.com/wolfymaster/woofx3/wooflow/internal/core"
        "github.com/wolfymaster/woofx3/wooflow/internal/workflow/temporal"
)

// TemporalEngineAdapter adapts the existing Temporal client to the WorkflowEngine interface
type TemporalEngineAdapter struct {
        client *temporal.Client
}

// Start initializes the Temporal workflow engine
func (t *TemporalEngineAdapter) Start(ctx context.Context) error {
        // Temporal client doesn't have a Start method - it's always ready
        return nil
}

// Stop shuts down the Temporal workflow engine
func (t *TemporalEngineAdapter) Stop() error {
        t.client.Close()
        return nil
}

// HandleEvent processes an event using the Temporal client
func (t *TemporalEngineAdapter) HandleEvent(ctx context.Context, event *core.Event) error {
        return t.client.HandleEvent(ctx, event)
}

// RegisterActivity registers an activity with the Temporal client
func (t *TemporalEngineAdapter) RegisterActivity(name string, activity ActivityFunc) error {
        // Convert ActivityFunc to temporal ActivityFunc format - use type assertion
        if temporalActivity, ok := activity.(func(context.Context, map[string]any) (temporal.ExecuteActionResult, error)); ok {
                t.client.RegisterActivity(name, temporalActivity)
        } else {
                // If it's not temporal format, wrap it
                wrappedActivity := func(ctx context.Context, params map[string]any) (temporal.ExecuteActionResult, error) {
                        result, err := activity(ctx, params)
                        return temporal.ExecuteActionResult{
                                Exports: result.Exports,
                        }, err
                }
                t.client.RegisterActivity(name, wrappedActivity)
        }
        return nil
}

// GetState returns the current Temporal client state
func (t *TemporalEngineAdapter) GetState() interface{} {
        // Return a simple state since Temporal client doesn't expose internal state
        return map[string]interface{}{
                "type": "temporal",
                "running": true,
        }
}

// IsHealthy returns true if the Temporal client is healthy
func (t *TemporalEngineAdapter) IsHealthy() bool {
        // Simple health check - could be enhanced
        return true
}