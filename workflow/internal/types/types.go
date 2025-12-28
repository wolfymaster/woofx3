package types

import (
	"encoding/json"
	"fmt"
	"time"
)

type WorkflowDefinition struct {
	ID          string           `json:"id" yaml:"id"`
	Name        string           `json:"name" yaml:"name"`
	Description string           `json:"description,omitempty" yaml:"description,omitempty"`
	Trigger     *TriggerConfig   `json:"trigger" yaml:"trigger"`
	Tasks       []TaskDefinition `json:"tasks" yaml:"tasks"`
	Options     *WorkflowOptions `json:"options,omitempty" yaml:"options,omitempty"`
}

type TriggerConfig struct {
	Type       string            `json:"type" yaml:"type"`
	EventType  string            `json:"eventType,omitempty" yaml:"eventType,omitempty"`
	Conditions []ConditionConfig `json:"conditions,omitempty" yaml:"conditions,omitempty"`
}

type ConditionConfig struct {
	Field    string      `json:"field" yaml:"field"`
	Operator string      `json:"operator" yaml:"operator"`
	Value    interface{} `json:"value" yaml:"value"`
}

type TaskDefinition struct {
	ID             string                 `json:"id" yaml:"id"`
	Type           string                 `json:"type" yaml:"type"`
	DependsOn      []string               `json:"dependsOn,omitempty" yaml:"dependsOn,omitempty"`
	Parameters     map[string]interface{} `json:"parameters" yaml:"parameters"`
	Exports        map[string]string      `json:"exports,omitempty" yaml:"exports,omitempty"`
	OnError        string                 `json:"onError,omitempty" yaml:"onError,omitempty"`
	Timeout        *Duration              `json:"timeout,omitempty" yaml:"timeout,omitempty"`
	Wait           *WaitConfig            `json:"wait,omitempty" yaml:"wait,omitempty"`
	Condition      *ConditionConfig       `json:"condition,omitempty" yaml:"condition,omitempty"`           // Single condition (backward compatible)
	Conditions     []ConditionConfig      `json:"conditions,omitempty" yaml:"conditions,omitempty"`         // Multiple conditions
	ConditionLogic string                 `json:"conditionLogic,omitempty" yaml:"conditionLogic,omitempty"` // "and" (default) or "or"
	OnTrue         []string               `json:"onTrue,omitempty" yaml:"onTrue,omitempty"`
	OnFalse        []string               `json:"onFalse,omitempty" yaml:"onFalse,omitempty"`
	Workflow       *WorkflowConfig        `json:"workflow,omitempty" yaml:"workflow,omitempty"`
}

type WaitConfig struct {
	Type        string             `json:"type" yaml:"type"`                                   // "event" or "aggregation"
	EventType   string             `json:"eventType" yaml:"eventType"`                         // Event type to wait for
	Conditions  []ConditionConfig  `json:"conditions,omitempty" yaml:"conditions,omitempty"`   // Conditions to match
	Aggregation *AggregationConfig `json:"aggregation,omitempty" yaml:"aggregation,omitempty"` // Aggregation settings
	Timeout     *Duration          `json:"timeout,omitempty" yaml:"timeout,omitempty"`         // Wait timeout
	OnTimeout   string             `json:"onTimeout,omitempty" yaml:"onTimeout,omitempty"`     // "continue" or "fail"
}

type WorkflowConfig struct {
	WorkflowID          string                 `json:"workflowId" yaml:"workflowId"`                   // ID of the workflow to trigger
	WaitUntilCompletion bool                   `json:"waitUntilCompletion" yaml:"waitUntilCompletion"` // Whether to wait for completion
	EventType           string                 `json:"eventType,omitempty" yaml:"eventType,omitempty"` // Event type to trigger the workflow
	EventData           map[string]interface{} `json:"eventData,omitempty" yaml:"eventData,omitempty"` // Data to pass to the workflow
	Timeout             *Duration              `json:"timeout,omitempty" yaml:"timeout,omitempty"`     // Timeout when waiting for completion
}

type AggregationConfig struct {
	Strategy   string    `json:"strategy" yaml:"strategy"`     // "count", "sum", "threshold"
	Field      string    `json:"field,omitempty" yaml:"field"` // Field for sum strategy
	Threshold  float64   `json:"threshold" yaml:"threshold"`   // Threshold value
	TimeWindow *Duration `json:"timeWindow,omitempty" yaml:"timeWindow,omitempty"`
}

type Duration struct {
	time.Duration
}

func (d *Duration) UnmarshalJSON(b []byte) error {
	var v interface{}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	switch value := v.(type) {
	case float64:
		d.Duration = time.Duration(value)
		return nil
	case string:
		var err error
		d.Duration, err = time.ParseDuration(value)
		return err
	default:
		return fmt.Errorf("invalid duration")
	}
}

func (d *Duration) UnmarshalYAML(unmarshal func(interface{}) error) error {
	var v string
	if err := unmarshal(&v); err != nil {
		return err
	}
	var err error
	d.Duration, err = time.ParseDuration(v)
	return err
}

type WorkflowOptions struct {
	Timeout       *Duration `json:"timeout,omitempty" yaml:"timeout,omitempty"`
	MaxConcurrent int       `json:"maxConcurrent,omitempty" yaml:"maxConcurrent,omitempty"`
}

type Event struct {
	ID      string                 `json:"id"`
	Type    string                 `json:"type"`
	Source  string                 `json:"source"`
	Time    time.Time              `json:"time"`
	Data    map[string]interface{} `json:"data"`
	Subject string                 `json:"subject,omitempty"`
}

type TaskStatus string

const (
	TaskStatusPending TaskStatus = "pending"
	TaskStatusRunning TaskStatus = "running"
	TaskStatusWaiting TaskStatus = "waiting"
	TaskStatusSuccess TaskStatus = "success"
	TaskStatusFailed  TaskStatus = "failed"
	TaskStatusSkipped TaskStatus = "skipped"
)

type TaskResult struct {
	Status  TaskStatus             `json:"status"`
	Data    map[string]interface{} `json:"data,omitempty"`
	Exports map[string]interface{} `json:"exports,omitempty"`
	Error   string                 `json:"error,omitempty"`
}

type ExecutionStatus string

const (
	ExecutionStatusRunning   ExecutionStatus = "running"
	ExecutionStatusWaiting   ExecutionStatus = "waiting"
	ExecutionStatusCompleted ExecutionStatus = "completed"
	ExecutionStatusFailed    ExecutionStatus = "failed"
)

type WorkflowExecution struct {
	ID           string
	WorkflowID   string
	Status       ExecutionStatus
	TriggerEvent *Event
	StartedAt    time.Time
	CompletedAt  *time.Time
	Tasks        map[string]*TaskExecution
	Variables    map[string]interface{}
	Error        string
}

type TaskExecution struct {
	TaskID        string
	Status        TaskStatus
	StartedAt     time.Time
	CompletedAt   *time.Time
	Result        *TaskResult
	Error         string
	WaitState     *WaitState
	WorkflowState *WorkflowState
}

type WaitState struct {
	EventType      string            `json:"eventType"`
	Conditions     []ConditionConfig `json:"conditions,omitempty"`
	Timeout        time.Time         `json:"timeout"`
	OnTimeout      string            `json:"onTimeout"`
	Aggregation    *AggregationState `json:"aggregation,omitempty"`
	ReceivedEvents []*Event          `json:"receivedEvents,omitempty"`
	Satisfied      bool              `json:"satisfied"`
}

type AggregationState struct {
	Strategy    string    `json:"strategy"`
	Count       int       `json:"count"`
	Sum         float64   `json:"sum"`
	Threshold   float64   `json:"threshold"`
	WindowStart time.Time `json:"windowStart"`
	WindowEnd   time.Time `json:"windowEnd"`
}

type WorkflowState struct {
	SubWorkflowID       string                 `json:"subWorkflowId"`         // ID of the sub-workflow to execute
	ExecutionID         string                 `json:"executionId,omitempty"` // Execution ID of the triggered sub-workflow
	WaitUntilCompletion bool                   `json:"waitUntilCompletion"`   // Whether waiting for completion
	Timeout             time.Time              `json:"timeout"`               // Timeout for waiting
	Completed           bool                   `json:"completed"`             // Whether the sub-workflow has completed
	Result              map[string]interface{} `json:"result,omitempty"`      // Result from the sub-workflow (variables)
}
