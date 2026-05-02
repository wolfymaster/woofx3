package main

import (
	"testing"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
)

func TestConvertDBWorkflow_UnpacksJSONColumns(t *testing.T) {
	dbwf := &dbv1.Workflow{
		Id:          "wf-1",
		Name:        "Test Workflow",
		TriggerJson: `{"type":"event","event":"message.user.twitch"}`,
		StepsJson:   `[{"id":"task-1","type":"print","parameters":{"msg":"hi"}}]`,
	}

	got, err := convertDBWorkflowToEngineWorkflow(dbwf)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}

	if got.Trigger == nil {
		t.Fatal("Trigger is nil; expected populated TriggerConfig from trigger_json")
	}
	if got.Trigger.Type != "event" {
		t.Errorf("Trigger.Type = %q, want %q", got.Trigger.Type, "event")
	}
	if got.Trigger.Event != "message.user.twitch" {
		t.Errorf("Trigger.Event = %q, want %q", got.Trigger.Event, "message.user.twitch")
	}
	if len(got.Tasks) != 1 {
		t.Errorf("len(Tasks) = %d, want 1", len(got.Tasks))
	}
}

func TestConvertDBWorkflow_EmptyJSONColumnsLeaveDefinitionMinimal(t *testing.T) {
	dbwf := &dbv1.Workflow{
		Id:   "wf-2",
		Name: "Empty Workflow",
	}

	got, err := convertDBWorkflowToEngineWorkflow(dbwf)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if got.Trigger != nil {
		t.Errorf("Trigger = %+v, want nil (no trigger_json)", got.Trigger)
	}
	if len(got.Tasks) != 0 {
		t.Errorf("len(Tasks) = %d, want 0 (no steps_json)", len(got.Tasks))
	}
	if got.ID != "wf-2" {
		t.Errorf("ID = %q, want %q", got.ID, "wf-2")
	}
}

func TestConvertDBWorkflow_RejectsMalformedTriggerJSON(t *testing.T) {
	dbwf := &dbv1.Workflow{
		Id:          "wf-3",
		TriggerJson: `{not json`,
	}
	_, err := convertDBWorkflowToEngineWorkflow(dbwf)
	if err == nil {
		t.Fatal("expected error for malformed trigger_json")
	}
}
