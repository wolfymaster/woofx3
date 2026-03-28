package core

import "context"

type EventRepository interface {
	StoreEvent(ctx context.Context, event *Event) error
	GetEventByID(ctx context.Context, id string) (*Event, error)
	QueryEvents(ctx context.Context, filter *EventFilter) ([]*Event, error)
}

// WorkflowDefinitionRepository defines the interface for workflow definition storage
type WorkflowDefinitionRepository interface {
	CreateWorkflowDefinition(ctx context.Context, workflow *WorkflowDefinition) error
	GetWorkflowDefinitionByID(ctx context.Context, id string) (*WorkflowDefinition, error)
	UpdateWorkflowDefinition(ctx context.Context, workflow *WorkflowDefinition) error
	DeleteWorkflowDefinition(ctx context.Context, id string) error
	QueryWorkflowDefinitions(ctx context.Context, filter *WorkflowDefinitionFilter) ([]*WorkflowDefinition, error)
}
