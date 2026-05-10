package main

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func TestBuildAlertEnvelope_WithTriggerEvent(t *testing.T) {
	event := &types.Event{
		ID:     "evt-1",
		Type:   "cheer.user.twitch",
		Source: "twitch",
		Time:   time.Date(2026, 5, 2, 12, 0, 0, 0, time.UTC),
		Data: map[string]any{
			"userName":    "alice",
			"amount":      100.0,
			"isAnonymous": false,
		},
	}
	params := map[string]any{
		"widget":   "MediaWidget",
		"text":     "{event.data.userName} cheered",
		"mediaUrl": "https://example.com/cheer.mp4",
	}

	payload, err := buildAlertEnvelope("app-uuid-1", params, event)
	if err != nil {
		t.Fatalf("buildAlertEnvelope: %v", err)
	}

	var got struct {
		ID            string         `json:"id"`
		ApplicationID string         `json:"applicationId"`
		Parameters    map[string]any `json:"parameters"`
		Event         *types.Event   `json:"event"`
	}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if got.ID == "" {
		t.Errorf("envelope id is empty; expected an auto-generated UUID")
	}
	if got.ApplicationID != "app-uuid-1" {
		t.Errorf("applicationId = %q, want app-uuid-1", got.ApplicationID)
	}
	if got.Parameters["widget"] != "MediaWidget" {
		t.Errorf("parameters.widget = %v, want MediaWidget", got.Parameters["widget"])
	}
	if got.Parameters["text"] != "{event.data.userName} cheered" {
		t.Errorf("parameters.text = %v", got.Parameters["text"])
	}
	if got.Event == nil {
		t.Fatal("event was unexpectedly nil")
	}
	if got.Event.Type != "cheer.user.twitch" {
		t.Errorf("event.type = %v, want cheer.user.twitch", got.Event.Type)
	}
	if got.Event.Data["userName"] != "alice" {
		t.Errorf("event.data.userName = %v, want alice", got.Event.Data["userName"])
	}
}

func TestBuildAlertEnvelope_OmitsEmptyApplicationID(t *testing.T) {
	// Manual / debug publishers don't have an applicationId. The
	// envelope must omit the field entirely (rather than emit "")
	// so api/'s alert-log handler falls through to its singleton
	// fallback instead of recording a row attributed to "" — which
	// would never round-trip cleanly through the db proxy's UUID
	// column.
	payload, err := buildAlertEnvelope("", map[string]any{"widget": "MediaWidget"}, nil)
	if err != nil {
		t.Fatalf("buildAlertEnvelope: %v", err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, present := got["applicationId"]; present {
		t.Errorf("applicationId key should be absent for empty input, got %s", string(got["applicationId"]))
	}
}

func TestBuildAlertEnvelope_NilTriggerEvent(t *testing.T) {
	params := map[string]any{
		"widget": "MediaWidget",
		"text":   "manual fire",
	}

	payload, err := buildAlertEnvelope("", params, nil)
	if err != nil {
		t.Fatalf("buildAlertEnvelope: %v", err)
	}

	// Confirm event serializes as JSON null (not omitted, not zero-value).
	// Widgets that depend on the event need to see null distinctly so they
	// can degrade gracefully rather than crash on missing data.
	var got map[string]json.RawMessage
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	eventRaw, ok := got["event"]
	if !ok {
		t.Fatal("envelope missing 'event' key")
	}
	if string(eventRaw) != "null" {
		t.Errorf("event = %s, want null", string(eventRaw))
	}
	paramsRaw, ok := got["parameters"]
	if !ok {
		t.Fatal("envelope missing 'parameters' key")
	}
	var gotParams map[string]any
	if err := json.Unmarshal(paramsRaw, &gotParams); err != nil {
		t.Fatalf("unmarshal parameters: %v", err)
	}
	if gotParams["widget"] != "MediaWidget" {
		t.Errorf("parameters.widget = %v, want MediaWidget", gotParams["widget"])
	}
}
