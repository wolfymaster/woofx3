package main

import (
	"encoding/json"
	"testing"
)

func TestValidateCloudEvent(t *testing.T) {
	app := &WorkflowApp{}

	tests := []struct {
		name    string
		data    []byte
		want    string // event type or empty string for error
		wantErr bool
	}{
		{
			name: "valid event",
			data: []byte(`{"id":"123","type":"test","source":"test","data":{}}`),
			want: "test",
			wantErr: false,
		},
		{
			name: "missing id",
			data: []byte(`{"type":"test","source":"test","data":{}}`),
			wantErr: true,
		},
		{
			name: "missing type",
			data: []byte(`{"id":"123","source":"test","data":{}}`),
			wantErr: true,
		},
		{
			name: "missing source",
			data: []byte(`{"id":"123","type":"test","data":{}}`),
			wantErr: true,
		},
		{
			name: "invalid JSON",
			data: []byte(`{"id":"123","type":"test","source":"test","data":{`),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := app.validateCloudEvent(tt.data)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateCloudEvent() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && got.Type != tt.want {
				t.Errorf("validateCloudEvent() got.Type = %v, want %v", got.Type, tt.want)
			}
		})
	}
}

func TestEventPatternRegistry(t *testing.T) {
	registry := NewEventPatternRegistry()
	patterns := registry.GetPatterns()

	// Should have the default Twitch patterns
	expectedPatterns := []string{
		"*.user.twitch",
		"*.channel.twitch",
	}

	if len(patterns) != len(expectedPatterns) {
		t.Errorf("Expected %d patterns, got %d", len(expectedPatterns), len(patterns))
	}

	for i, expected := range expectedPatterns {
		if i >= len(patterns) || patterns[i] != expected {
			t.Errorf("Expected pattern %s at index %d, got %s", expected, i, patterns[i])
		}
	}

	// Test adding a new pattern
	registry.AddPattern("*.test.*")
	updatedPatterns := registry.GetPatterns()
	
	if len(updatedPatterns) != len(expectedPatterns)+1 {
		t.Errorf("Expected %d patterns after adding one, got %d", len(expectedPatterns)+1, len(updatedPatterns))
	}
}

func TestEventSerialization(t *testing.T) {
	// Test that our Event type matches what we expect from NATS messages
	testEvent := map[string]any{
		"id":     "test-123",
		"type":   "cheer.user.twitch",
		"source": "twitch",
		"data": map[string]any{
			"amount":   100,
			"userName": "testuser",
			"message":  "Great stream!",
		},
	}

	data, err := json.Marshal(testEvent)
	if err != nil {
		t.Fatalf("Failed to marshal test event: %v", err)
	}

	app := &WorkflowApp{}
	event, err := app.validateCloudEvent(data)
	if err != nil {
		t.Fatalf("validateCloudEvent() error = %v", err)
	}

	if event.ID != "test-123" {
		t.Errorf("Expected ID test-123, got %s", event.ID)
	}
	if event.Type != "cheer.user.twitch" {
		t.Errorf("Expected type cheer.user.twitch, got %s", event.Type)
	}
	if event.Source != "twitch" {
		t.Errorf("Expected source twitch, got %s", event.Source)
	}
	if event.Data["amount"] != float64(100) {
		t.Errorf("Expected amount 100, got %v", event.Data["amount"])
	}
}