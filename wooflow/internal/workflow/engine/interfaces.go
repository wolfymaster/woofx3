package engine

import (
        "context"

        "github.com/wolfymaster/woofx3/wooflow/internal/core"
        "go.temporal.io/sdk/log"
)

// WorkflowEngine defines the interface for workflow execution engines
type WorkflowEngine interface {
        // Start initializes the workflow engine
        Start(ctx context.Context) error

        // Stop shuts down the workflow engine gracefully
        Stop() error

        // HandleEvent processes an event and triggers/signals workflows
        HandleEvent(ctx context.Context, event *core.Event) error

        // RegisterActivity registers a custom activity with the engine
        RegisterActivity(name string, activity ActivityFunc) error

        // GetState returns the current state of the workflow engine
        GetState() interface{}

        // IsHealthy returns true if the engine is running and healthy
        IsHealthy() bool
}

// ActivityFunc defines the signature for workflow activities
type ActivityFunc func(ctx context.Context, params map[string]any) (ExecuteActionResult, error)

// ExecuteActionResult represents the result of executing an action
type ExecuteActionResult struct {
        Success bool                   `json:"success"`
        Exports map[string]interface{} `json:"exports,omitempty"`
        Error   string                 `json:"error,omitempty"`
}

// WorkflowEngineConfig holds configuration for workflow engines
type WorkflowEngineConfig struct {
        // Engine type: "temporal" or "local"
        Engine string

        // Temporal-specific configuration
        Temporal TemporalConfig

        // Local engine configuration
        Local LocalConfig

        // Common configuration
        TaskQueue    string
        Logger       log.Logger
        EventRepo    core.EventRepository
        WorkflowRepo core.WorkflowDefinitionRepository
}

// TemporalConfig holds Temporal-specific configuration
type TemporalConfig struct {
        Host      string
        Namespace string
}

// LocalConfig holds local engine configuration  
type LocalConfig struct {
        MaxConcurrentWorkflows int
        WorkflowTimeout        int // seconds
}

// Backend represents the workflow engine backend type
type Backend string

const (
        // BackendTemporal uses Temporal.io for workflow orchestration
        BackendTemporal Backend = "temporal"
        // BackendLocal uses local in-memory workflow execution
        BackendLocal Backend = "local"
)