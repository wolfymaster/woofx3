package cloudevents

import (
	"encoding/json"
	"testing"
)

func TestHeartbeat_NewHeartbeatEvent(t *testing.T) {
	appName := "test-app"
	ready := true

	// Create a new heartbeat event
	evt, err := NewHeartbeatEvent(appName, ready)
	if err != nil {
		t.Fatalf("Failed to create heartbeat event: %v", err)
	}
	if evt == nil {
		t.Fatal("Expected non-nil event, got nil")
	}

	// Verify the correct type returned for the event
	expectedType := "com.woofx3.heartbeat"
	if evt.Type() != expectedType {
		t.Errorf("Expected event type %q, got %q", expectedType, evt.Type())
	}

	// Verify source
	if evt.Source() != appName {
		t.Errorf("Expected source %q, got %q", appName, evt.Source())
	}

	// Verify subject
	expectedSubject := "HEARTBEAT"
	if evt.Subject() != expectedSubject {
		t.Errorf("Expected subject %q, got %q", expectedSubject, evt.Subject())
	}

	// Verify we can call Encode() helper method on Heartbeat type
	heartbeat := Heartbeat{Event: *evt}
	jsonBytes, err := heartbeat.Encode()
	if err != nil {
		t.Fatalf("Failed to encode heartbeat: %v", err)
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

	if jsonMap["source"] != appName {
		t.Errorf("Expected JSON source %q, got %q", appName, jsonMap["source"])
	}

	if jsonMap["subject"] != expectedSubject {
		t.Errorf("Expected JSON subject %q, got %q", expectedSubject, jsonMap["subject"])
	}

	// Verify data field
	data, ok := jsonMap["data"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected data field in JSON, got nil or wrong type")
	}

	if data["application"] != appName {
		t.Errorf("Expected data.application %q, got %v", appName, data["application"])
	}

	if data["ready"] != ready {
		t.Errorf("Expected data.ready %v, got %v", ready, data["ready"])
	}
}

func TestHeartbeat_NewHeartbeatEvent_WithReadyFalse(t *testing.T) {
	appName := "test-app-2"
	ready := false

	// Create a heartbeat event with ready=false
	evt, err := NewHeartbeatEvent(appName, ready)
	if err != nil {
		t.Fatalf("Failed to create heartbeat event: %v", err)
	}

	// Use Heartbeat helper method to extract data
	heartbeat := Heartbeat{Event: *evt}
	heartbeatData, err := heartbeat.Data()
	if err != nil {
		t.Fatalf("Failed to extract heartbeat data: %v", err)
	}

	if heartbeatData.Application != appName {
		t.Errorf("Expected application %q, got %q", appName, heartbeatData.Application)
	}

	if heartbeatData.Ready != ready {
		t.Errorf("Expected ready %v, got %v", ready, heartbeatData.Ready)
	}

	// Also verify via JSON unmarshal
	jsonBytes, _ := evt.MarshalJSON()
	var jsonMap map[string]interface{}
	json.Unmarshal(jsonBytes, &jsonMap)
	data := jsonMap["data"].(map[string]interface{})

	if data["ready"] != ready {
		t.Errorf("Expected JSON data.ready %v, got %v", ready, data["ready"])
	}
}

func TestHeartbeat_ParseHeartbeatEvent(t *testing.T) {
	appName := "test-app-3"
	ready := true

	// Create a heartbeat event
	originalEvt, err := NewHeartbeatEvent(appName, ready)
	if err != nil {
		t.Fatalf("Failed to create heartbeat event: %v", err)
	}

	// Encode it to bytes using Heartbeat helper
	heartbeat := Heartbeat{Event: *originalEvt}
	messageBytes, err := heartbeat.Encode()
	if err != nil {
		t.Fatalf("Failed to encode heartbeat to bytes: %v", err)
	}

	// Parse it back from bytes using Heartbeat Decode helper
	var parsedHeartbeat Heartbeat
	if err := parsedHeartbeat.Decode(messageBytes); err != nil {
		t.Fatalf("Failed to decode heartbeat from bytes: %v", err)
	}

	// Verify that we can call evt.Type() and get the correct value
	expectedType := "com.woofx3.heartbeat"
	if parsedHeartbeat.Type() != expectedType {
		t.Errorf("Expected parsed event type %q, got %q", expectedType, parsedHeartbeat.Type())
	}

	// Verify source
	if parsedHeartbeat.Source() != appName {
		t.Errorf("Expected parsed event source %q, got %q", appName, parsedHeartbeat.Source())
	}

	// Verify subject
	expectedSubject := "HEARTBEAT"
	if parsedHeartbeat.Subject() != expectedSubject {
		t.Errorf("Expected parsed event subject %q, got %q", expectedSubject, parsedHeartbeat.Subject())
	}

	// Verify that we can call Data() helper method to get the correct values
	parsedHeartbeatData, err := parsedHeartbeat.Data()
	if err != nil {
		t.Fatalf("Failed to extract data from parsed heartbeat: %v", err)
	}

	if parsedHeartbeatData.Application != appName {
		t.Errorf("Expected parsed data.application %q, got %q", appName, parsedHeartbeatData.Application)
	}

	if parsedHeartbeatData.Ready != ready {
		t.Errorf("Expected parsed data.ready %v, got %v", ready, parsedHeartbeatData.Ready)
	}
}

func TestHeartbeat_HeartbeatData(t *testing.T) {
	// Test HeartbeatData struct
	data := HeartbeatData{
		Application: "test-app",
		Ready:       true,
	}

	if data.Application != "test-app" {
		t.Errorf("Expected Application %q, got %q", "test-app", data.Application)
	}

	if !data.Ready {
		t.Error("Expected Ready to be true, got false")
	}
}
