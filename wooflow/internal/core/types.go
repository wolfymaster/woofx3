package core

import (
	"context"
	"log"
)

// Event represents a workflow event
type Event struct {
	ID      string         `json:"id,omitempty"`
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
}

// WorkflowDefinition represents a workflow definition
type WorkflowDefinition struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Steps   []Step   `json:"steps"`
	Trigger *Trigger `json:"trigger,omitempty"`
}

// Step represents a workflow step
type Step struct {
	ID         string                 `json:"id"`
	Type       string                 `json:"type"` // "action" or "wait"
	Action     string                 `json:"action,omitempty"`
	Parameters map[string]interface{} `json:"parameters,omitempty"`
	DependsOn  []string               `json:"dependsOn,omitempty"`
	Exports    map[string]string      `json:"exports,omitempty"`
	Critical   bool                   `json:"critical,omitempty"`
	WaitFor    *WaitCondition         `json:"waitFor,omitempty"`
}

// Trigger represents a workflow trigger
type Trigger struct {
	Type      string                 `json:"type"`
	Event     string                 `json:"event,omitempty"`
	Condition map[string]interface{} `json:"condition,omitempty"`
}

// WaitCondition represents a wait step condition
type WaitCondition struct {
	Type        string             `json:"type"` // "event" or "aggregation"
	EventType   string             `json:"eventType,omitempty"`
	Condition   map[string]any     `json:"condition,omitempty"`
	Aggregation *AggregationConfig `json:"aggregation,omitempty"`
	Timeout     string             `json:"timeout,omitempty"`
}

// AggregationConfig represents an aggregation configuration
type AggregationConfig struct {
	Type       string `json:"type"` // "sum", "count", etc.
	EventType  string `json:"eventType"`
	Field      string `json:"field,omitempty"`
	Threshold  int    `json:"threshold"`
	TimeWindow string `json:"timeWindow,omitempty"` // e.g., "1h", "30m"
}

// EventFilter represents a filter for querying events
type EventFilter struct {
	Type  string `json:"type,omitempty"`
	Limit int    `json:"limit,omitempty"`
}

// WorkflowDefinitionFilter represents a filter for querying workflow definitions
type WorkflowDefinitionFilter struct {
	Name         string `json:"name,omitempty"`
	TriggerEvent string `json:"triggerEvent,omitempty"`
	Limit        int    `json:"limit,omitempty"`
}

// ActivityFunc defines the signature for workflow activities
type ActivityFunc func(ctx context.Context, params map[string]any) (ExecuteActionResult, error)

type WorkflowEngine interface {
	// Start initializes the workflow engine
	Start(ctx context.Context) error

	// Stop shuts down the workflow engine gracefully
	Stop() error

	// HandleEvent processes an event and triggers/signals workflows
	HandleEvent(ctx context.Context, event *Event) error

	// RegisterActivity registers a custom activity with the engine
	RegisterActivity(name string, activity ActivityFunc) error

	// GetState returns the current state of the workflow engine
	GetState() any

	// IsHealthy returns true if the engine is running and healthy
	IsHealthy() bool
}

// WorkflowStatus represents the current state of a workflow instance
type WorkflowStatus struct {
	ID         string                 `json:"id"`
	Definition string                 `json:"definition"`
	Status     string                 `json:"status"`
	Input      map[string]interface{} `json:"input"`
	Output     map[string]interface{} `json:"output,omitempty"`
	Error      string                 `json:"error,omitempty"`
	StartedAt  int64                  `json:"started_at"`
	UpdatedAt  int64                  `json:"updated_at"`
}

// ExecuteActionResult represents the result of executing an action
type ExecuteActionResult struct {
	Success bool           `json:"success"`
	Exports map[string]any `json:"exports,omitempty"`
	Error   string         `json:"error,omitempty"`
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
	EventRepo    EventRepository
	WorkflowRepo WorkflowDefinitionRepository
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
