package runtime

import (
        "context"
        "fmt"
        "time"

        "github.com/wolfymaster/woofx3/wooflow/internal/core"
        "github.com/wolfymaster/woofx3/wooflow/internal/workflow/api"
        "github.com/wolfymaster/woofx3/wooflow/internal/workflow/temporal"
)

// TemporalEngineAdapter adapts the existing Temporal client to the WorkflowEngine interface
type TemporalEngineAdapter struct {
        client    *temporal.Client
        isHealthy bool
        started   bool
}

// Start initializes the Temporal workflow engine
func (t *TemporalEngineAdapter) Start(ctx context.Context) error {
        if t.started {
                return nil
        }

        // Test Temporal connectivity by checking server status
        if err := t.checkTemporalHealth(ctx); err != nil {
                t.isHealthy = false
                return fmt.Errorf("failed to connect to Temporal server: %w", err)
        }

        t.isHealthy = true
        t.started = true
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
func (t *TemporalEngineAdapter) RegisterActivity(name string, activity api.ActivityFunc) error {
        // Wrap api.ActivityFunc to temporal's function signature and properly map all fields
        wrappedActivity := func(ctx context.Context, params map[string]any) (temporal.ExecuteActionResult, error) {
                result, err := activity(ctx, params)
                if err != nil {
                        // For consistency with local backend, return the error directly
                        return temporal.ExecuteActionResult{}, err
                }

                // Map api.ExecuteActionResult to temporal.ExecuteActionResult
                temporalResult := temporal.ExecuteActionResult{
                        Exports: result.Exports,
                        // Map Success field: if false, treat as an error in temporal format
                        Publish: false, // Don't publish by default unless specified
                        PublishData: make(map[string]any),
                        PublishTopic: temporal.PublishTopic{Valid: false},
                }

                // Handle semantic mapping of Success/Error fields
                if !result.Success {
                        // If Success is false, convert to error for semantic consistency
                        errorMsg := result.Error
                        if errorMsg == "" {
                                errorMsg = "activity execution failed"
                        }
                        return temporalResult, fmt.Errorf("activity failed: %s", errorMsg)
                }

                // If there's an error message but Success is true, add to exports for compatibility
                if result.Error != "" {
                        if temporalResult.Exports == nil {
                                temporalResult.Exports = make(map[string]any)
                        }
                        temporalResult.Exports["_warning"] = result.Error
                }

                return temporalResult, nil
        }
        
        t.client.RegisterActivity(name, wrappedActivity)
        return nil
}

// GetState returns the current Temporal client state
func (t *TemporalEngineAdapter) GetState() interface{} {
        return map[string]interface{}{
                "type":      "temporal",
                "running":   t.started,
                "healthy":   t.isHealthy,
                "connected": t.isHealthy && t.started,
        }
}

// checkTemporalHealth performs a health check on the Temporal server
func (t *TemporalEngineAdapter) checkTemporalHealth(ctx context.Context) error {
        if t.client == nil {
                return fmt.Errorf("temporal client is nil")
        }

        // Add a method to temporal.Client to expose health checking
        return t.checkTemporalConnectivity(ctx)
}

// checkTemporalConnectivity tests actual connectivity to Temporal server
func (t *TemporalEngineAdapter) checkTemporalConnectivity(ctx context.Context) error {
        // Use the new HealthCheck method from temporal.Client
        return t.client.HealthCheck(ctx)
}

// IsHealthy returns true if the Temporal client is healthy
func (t *TemporalEngineAdapter) IsHealthy() bool {
        if !t.started {
                return false
        }

        // Quick health check - test Temporal connectivity
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()

        if err := t.checkTemporalHealth(ctx); err != nil {
                t.isHealthy = false
                return false
        }

        t.isHealthy = true
        return true
}