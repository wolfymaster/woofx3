package main

import (
	"encoding/json"
	"testing"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
)

func TestConvertDBWorkflow_UnpacksCanonicalDefinition(t *testing.T) {
	definition := map[string]any{
		"id":   "wf-1",
		"name": "Test Workflow",
		"trigger": map[string]any{
			"type":      "event",
			"eventType": "message.user.twitch",
		},
		"tasks": []map[string]any{
			{"id": "task-1", "type": "print", "parameters": map[string]any{"msg": "hi"}},
		},
	}
	defJSON, err := json.Marshal(definition)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	dbwf := &dbv1.Workflow{
		Id:        "wf-1",
		Name:      "Test Workflow",
		Variables: map[string]string{"_definition": string(defJSON)},
	}

	got, err := convertDBWorkflowToEngineWorkflow(dbwf)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}

	if got.Trigger == nil {
		t.Fatal("Trigger is nil; expected populated TriggerConfig from _definition")
	}
	if got.Trigger.Type != "event" {
		t.Errorf("Trigger.Type = %q, want %q", got.Trigger.Type, "event")
	}
	if got.Trigger.EventType != "message.user.twitch" {
		t.Errorf("Trigger.EventType = %q, want %q", got.Trigger.EventType, "message.user.twitch")
	}
	if len(got.Tasks) != 1 {
		t.Errorf("len(Tasks) = %d, want 1", len(got.Tasks))
	}
}

func TestConvertDBWorkflow_FallsBackToProtoFields(t *testing.T) {
	dbwf := &dbv1.Workflow{
		Id:   "wf-2",
		Name: "Legacy Workflow",
		Steps: []*dbv1.WorkflowStep{
			{Id: "step-1", Type: "print"},
		},
	}

	got, err := convertDBWorkflowToEngineWorkflow(dbwf)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if got.Trigger != nil {
		t.Errorf("Trigger = %+v, want nil (no _definition and proto has no trigger)", got.Trigger)
	}
	if len(got.Tasks) != 1 {
		t.Errorf("len(Tasks) = %d, want 1", len(got.Tasks))
	}
}
