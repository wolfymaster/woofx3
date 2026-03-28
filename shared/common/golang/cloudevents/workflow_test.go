package cloudevents

import (
	"encoding/json"
	"testing"
)

func TestWorkflow_NewWorkflowChangeEvent(t *testing.T) {
	entityID := "workflow-123"
	source := "/woofx3/workflow"

	// Create a new workflow change event
	evt, err := WorkflowEvent.WorkflowChangeEvent(OperationCreated, entityID, source)
	if err != nil {
		t.Fatalf("Failed to create workflow change event: %v", err)
	}
	if evt == nil {
		t.Fatal("Expected non-nil event, got nil")
	}

	// Verify the correct type returned for the event
	expectedType := "woofx3.workflow.created"
	if evt.Type() != expectedType {
		t.Errorf("Expected event type %q, got %q", expectedType, evt.Type())
	}

	// Verify source
	if evt.Source() != source {
		t.Errorf("Expected source %q, got %q", source, evt.Source())
	}

	// Verify we can call MarshalJSON (encode) on the event
	jsonBytes, err := evt.MarshalJSON()
	if err != nil {
		t.Fatalf("Failed to marshal event to JSON: %v", err)
	}
	if len(jsonBytes) == 0 {
		t.Fatal("Expected non-empty JSON bytes, got empty")
	}

	// Verify that the correct json string is returned
	var jsonMap map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &jsonMap); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	if jsonMap["type"] != expectedType {
		t.Errorf("Expected JSON type %q, got %q", expectedType, jsonMap["type"])
	}

	if jsonMap["source"] != source {
		t.Errorf("Expected JSON source %q, got %q", source, jsonMap["source"])
	}

	// Verify data field
	data, ok := jsonMap["data"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected data field in JSON, got nil or wrong type")
	}

	if data["operation"] != OperationCreated {
		t.Errorf("Expected JSON extension %q=%q, got %v", "operation", OperationCreated, data["operation"])
	}

	if data["entityId"] != entityID {
		t.Errorf("Expected JSON extension %q=%q, got %v", "entityId", entityID, data["entityId"])
	}
}

func TestWorkflow_ParseWorkflowChangeEvent(t *testing.T) {
	entityID := "workflow-456"
	source := "/woofx3/workflow"

	// Create a new workflow change event
	originalEvt, err := WorkflowEvent.WorkflowChangeEvent(OperationUpdated, entityID, source)
	if err != nil {
		t.Fatalf("Failed to create workflow change event: %v", err)
	}

	// Marshal it to bytes
	messageBytes, err := originalEvt.MarshalJSON()
	if err != nil {
		t.Fatalf("Failed to marshal event to bytes: %v", err)
	}

	// Parse it back from bytes
	var parsedEvt WorkflowChangeEvent
	err = parsedEvt.Decode(messageBytes)
	if err != nil {
		t.Fatalf("Failed to parse event from bytes: %v", err)
	}

	// Verify that we can call evt.Type() and get the correct value
	expectedType := "woofx3.workflow.updated"
	if parsedEvt.Type() != expectedType {
		t.Errorf("Expected parsed event type %q, got %q", expectedType, parsedEvt.Type())
	}

	// Verify source
	if parsedEvt.Source() != source {
		t.Errorf("Expected parsed event source %q, got %q", source, parsedEvt.Source())
	}

	changeData, err := parsedEvt.Data()
	if err != nil {
		t.Fatalf("Failed to get workflow change data: %v", err)
	}

	if changeData.Operation != OperationUpdated {
		t.Errorf("Expected change data operation %q, got %q", OperationUpdated, changeData.Operation)
	}

	if changeData.EntityID != entityID {
		t.Errorf("Expected change data entityID %q, got %q", entityID, changeData.EntityID)
	}

	// Verify helper methods
	if !changeData.IsUpdated() {
		t.Error("Expected IsUpdated() to return true")
	}
	if changeData.IsCreated() {
		t.Error("Expected IsCreated() to return false")
	}
	if changeData.IsDeleted() {
		t.Error("Expected IsDeleted() to return false")
	}
	if !changeData.IsCreateOrUpdate() {
		t.Error("Expected IsCreateOrUpdate() to return true")
	}
}

func TestWorkflow_ParseWorkflowChangeEventWithSubject(t *testing.T) {
	entityID := "workflow-789"
	source := "/woofx3/workflow"
	subject := "db.workflow.updated.app-3"

	// Create a new workflow change event
	evt, err := WorkflowEvent.WorkflowChangeEvent(OperationUpdated, entityID, source)
	if err != nil {
		t.Fatalf("Failed to create workflow change event: %v", err)
	}

	// Set a subject
	evt.SetSubject(subject)

	// Marshal and parse it back
	messageBytes, err := evt.MarshalJSON()
	if err != nil {
		t.Fatalf("Failed to marshal event: %v", err)
	}

	var parsedEvt WorkflowChangeEvent
	err = parsedEvt.Decode(messageBytes)
	if err != nil {
		t.Fatalf("Failed to parse event: %v", err)
	}

	// Verify that we can call evt.Subject() and get the correct value
	if parsedEvt.Subject() != subject {
		t.Errorf("Expected parsed event subject %q, got %q", subject, parsedEvt.Subject())
	}
}

func TestWorkflow_WorkflowChangeDataHelpers(t *testing.T) {
	// Test IsCreated
	createdData := WorkflowChangeData{Operation: OperationCreated}
	if !createdData.IsCreated() {
		t.Error("Expected IsCreated() to return true for created operation")
	}
	if createdData.IsUpdated() {
		t.Error("Expected IsUpdated() to return false for created operation")
	}
	if createdData.IsDeleted() {
		t.Error("Expected IsDeleted() to return false for created operation")
	}
	if !createdData.IsCreateOrUpdate() {
		t.Error("Expected IsCreateOrUpdate() to return true for created operation")
	}

	// Test IsUpdated
	updatedData := WorkflowChangeData{Operation: OperationUpdated}
	if updatedData.IsCreated() {
		t.Error("Expected IsCreated() to return false for updated operation")
	}
	if !updatedData.IsUpdated() {
		t.Error("Expected IsUpdated() to return true for updated operation")
	}
	if updatedData.IsDeleted() {
		t.Error("Expected IsDeleted() to return false for updated operation")
	}
	if !updatedData.IsCreateOrUpdate() {
		t.Error("Expected IsCreateOrUpdate() to return true for updated operation")
	}

	// Test IsDeleted
	deletedData := WorkflowChangeData{Operation: OperationDeleted}
	if deletedData.IsCreated() {
		t.Error("Expected IsCreated() to return false for deleted operation")
	}
	if deletedData.IsUpdated() {
		t.Error("Expected IsUpdated() to return false for deleted operation")
	}
	if !deletedData.IsDeleted() {
		t.Error("Expected IsDeleted() to return true for deleted operation")
	}
	if deletedData.IsCreateOrUpdate() {
		t.Error("Expected IsCreateOrUpdate() to return false for deleted operation")
	}
}
