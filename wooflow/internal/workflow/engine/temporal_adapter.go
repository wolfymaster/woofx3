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
	return t.client.Start(ctx)
}

// Stop shuts down the Temporal workflow engine
func (t *TemporalEngineAdapter) Stop() error {
	return t.client.Close()
}

// HandleEvent processes an event using the Temporal client
func (t *TemporalEngineAdapter) HandleEvent(ctx context.Context, event *core.Event) error {
	return t.client.HandleEvent(ctx, event)
}

// RegisterActivity registers an activity with the Temporal client
func (t *TemporalEngineAdapter) RegisterActivity(name string, activity ActivityFunc) error {
	// Convert ActivityFunc to temporal ActivityFunc format
	temporalActivity := func(ctx context.Context, params map[string]any) (temporal.ExecuteActionResult, error) {
		result, err := activity(ctx, params)
		return temporal.ExecuteActionResult{
			Success: result.Success,
			Exports: result.Exports,
			Error:   result.Error,
		}, err
	}
	
	return t.client.RegisterActivity(name, temporalActivity)
}

// GetState returns the current Temporal client state
func (t *TemporalEngineAdapter) GetState() interface{} {
	return t.client.GetState()
}

// IsHealthy returns true if the Temporal client is healthy
func (t *TemporalEngineAdapter) IsHealthy() bool {
	return t.client.IsHealthy()
}