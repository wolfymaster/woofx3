package cloudevents

import (
	"fmt"
	"time"

	ce "github.com/cloudevents/sdk-go/v2"
)

const (
	// OperationCreated is the operation value for workflow creation events
	OperationCreated = "created"

	// OperationUpdated is the operation value for workflow update events
	OperationUpdated = "updated"

	// OperationDeleted is the operation value for workflow deletion events
	OperationDeleted = "deleted"

	WorkflowChangeEventSubject = ""
)

// WorkflowChange is a wrapper around ce.Event for workflow change events
type WorkflowChangeEvent struct {
	ce.Event
	subject string
}

// WorkflowChangeData is the workflow-consumer view of a workflow change event.
//
// The wire format names are generic (the db publisher serves every entity
// type — users, modules, workflows, etc. — so its extension is `entityid`).
// This struct translates the generic wire fields into workflow-specific
// names so callers can write `data.WorkflowID` instead of `data.EntityID`.
type WorkflowChangeData struct {
	Operation     string `json:"operation"`
	WorkflowID    string `json:"workflowId"`
	ApplicationID string `json:"applicationId"`
}

// Encode encodes the workflow change event to JSON bytes
func (w *WorkflowChangeEvent) Encode() ([]byte, error) {
	return Encode(w)
}

// Decode decodes JSON data into the workflow change event
func (w *WorkflowChangeEvent) Decode(data []byte) error {
	return Decode(data, w)
}

// Data extracts WorkflowChangeData from the workflow change event.
//
// Producers don't agree on where to put the metadata:
//   - NewWorkflowChangeEvent (this package) embeds it in the CloudEvent
//     data payload as `operation` / `workflowId` / `applicationId`.
//   - The db service's generic worker publisher sets it as CloudEvent
//     extensions (`operation` / `entityid` / `applicationid`) and uses
//     the data payload for the row body itself. The extensions are named
//     generically because the same publisher serves every entity type.
//
// Read both: prefer the data payload, fall back to extensions when missing.
// DataAs returning an error still tries extensions — the data shape may
// legitimately not match (the db publisher payloads carry the row, not
// WorkflowChangeData) but the extensions are still authoritative.
func (w *WorkflowChangeEvent) Data() (*WorkflowChangeData, error) {
	var parsed WorkflowChangeData
	dataErr := w.DataAs(&parsed)

	exts := w.Extensions()
	if parsed.Operation == "" {
		if v, ok := exts["operation"].(string); ok {
			parsed.Operation = v
		}
	}
	if parsed.WorkflowID == "" {
		if v, ok := exts["entityid"].(string); ok {
			parsed.WorkflowID = v
		}
	}
	if parsed.ApplicationID == "" {
		if v, ok := exts["applicationid"].(string); ok {
			parsed.ApplicationID = v
		}
	}

	if parsed.Operation == "" && parsed.WorkflowID == "" && dataErr != nil {
		return nil, dataErr
	}
	return &parsed, nil
}

// Helper functions for WorkflowChangeData
func (d WorkflowChangeData) IsCreated() bool {
	return d.Operation == OperationCreated
}

func (d WorkflowChangeData) IsUpdated() bool {
	return d.Operation == OperationUpdated
}

func (d WorkflowChangeData) IsDeleted() bool {
	return d.Operation == OperationDeleted
}

func (d WorkflowChangeData) IsCreateOrUpdate() bool {
	return d.IsCreated() || d.IsUpdated()
}

// NewWorkflowChangeEvent creates a new workflow change event with the
// metadata embedded in the data payload. Producers that prefer the
// extension-based wire format (e.g. db's generic worker publisher) do not
// use this helper.
func NewWorkflowChangeEvent(operation, workflowID, applicationID, source string) (*WorkflowChangeEvent, error) {
	eventType := fmt.Sprintf("woofx3.workflow.%s", operation)

	evt := ce.NewEvent()
	evt.SetType(eventType)
	evt.SetSource(source)
	evt.SetTime(time.Now())

	data := WorkflowChangeData{
		Operation:     operation,
		WorkflowID:    workflowID,
		ApplicationID: applicationID,
	}

	if err := evt.SetData(ce.ApplicationJSON, data); err != nil {
		return nil, err
	}

	return &WorkflowChangeEvent{Event: evt}, nil
}
