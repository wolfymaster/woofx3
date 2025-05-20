package core

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
