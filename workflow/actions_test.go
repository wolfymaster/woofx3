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
		Type:   "channel.cheer",
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
	if got.Event.Type != "channel.cheer" {
		t.Errorf("event.type = %v, want channel.cheer", got.Event.Type)
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

func TestBuildModuleInvokeEvent_ParametersAndTrigger(t *testing.T) {
	trigger := &types.Event{
		ID:   "evt-1",
		Type: "channel.follow",
		Data: map[string]any{"user_name": "alice"},
	}
	params := map[string]any{"message": "hello"}

	got := buildModuleInvokeEvent(trigger, params)

	if got["parameters"].(map[string]any)["message"] != "hello" {
		t.Errorf("parameters.message = %v, want hello", got["parameters"])
	}
	if got["type"] != "channel.follow" {
		t.Errorf("type = %v, want channel.follow", got["type"])
	}
	if got["data"].(map[string]any)["user_name"] != "alice" {
		t.Errorf("data.user_name = %v, want alice", got["data"])
	}
}

func TestValidateAlertParams_AcceptsAUsableLayout(t *testing.T) {
	// Dimensions arrive as float64: steps are persisted as JSON.
	params := map[string]any{
		"layout": map[string]any{
			"width":   1920.0,
			"height":  1080.0,
			"widgets": []any{map[string]any{"id": "t1"}},
		},
	}
	if err := validateAlertParams(params); err != nil {
		t.Fatalf("validateAlertParams: %v", err)
	}
}

func TestValidateAlertParams_AcceptsIntegerDimensions(t *testing.T) {
	// A definition built in Go rather than unmarshalled from a stored step.
	params := map[string]any{
		"layout": map[string]any{"width": 100, "height": 100, "widgets": []any{}},
	}
	if err := validateAlertParams(params); err != nil {
		t.Fatalf("validateAlertParams: %v", err)
	}
}

// An empty widget list is a usable envelope. Whether there is anything worth
// playing is the scene manager's call — it holds the catalog and reports that
// case separately — so refusing here would take a decision that is not ours.
func TestValidateAlertParams_AcceptsAnEmptyWidgetList(t *testing.T) {
	params := map[string]any{
		"layout": map[string]any{"width": 10.0, "height": 10.0, "widgets": []any{}},
	}
	if err := validateAlertParams(params); err != nil {
		t.Fatalf("validateAlertParams: %v", err)
	}
}

// The message is the whole point: an author sees it on a failed run and has to
// be able to act on it without reading engine source.
func TestValidateAlertParams_NamesTheFieldAtFault(t *testing.T) {
	cases := []struct {
		name   string
		params map[string]any
		want   string
	}{
		{
			name:   "no layout at all, which is what a stale module produces",
			params: map[string]any{"target": "default"},
			want:   "layout must be an object, got nothing",
		},
		{
			name:   "layout is not an object",
			params: map[string]any{"layout": "default"},
			want:   `layout must be an object, got the string "default"`,
		},
		{
			name:   "width is zero",
			params: map[string]any{"layout": map[string]any{"width": 0.0, "height": 100.0, "widgets": []any{}}},
			want:   "layout.width must be a positive number, got number 0",
		},
		{
			// Reads as correct in a payload, which is why the value is quoted.
			name:   "width arrived as a string",
			params: map[string]any{"layout": map[string]any{"width": "1920", "height": 1080.0, "widgets": []any{}}},
			want:   `layout.width must be a positive number, got the string "1920"`,
		},
		{
			name:   "height is missing",
			params: map[string]any{"layout": map[string]any{"width": 100.0, "widgets": []any{}}},
			want:   "layout.height must be a positive number, got nothing",
		},
		{
			name:   "widgets is missing",
			params: map[string]any{"layout": map[string]any{"width": 100.0, "height": 100.0}},
			want:   "layout.widgets must be an array, got nothing",
		},
		{
			name:   "widgets is an object",
			params: map[string]any{"layout": map[string]any{"width": 100.0, "height": 100.0, "widgets": map[string]any{}}},
			want:   "layout.widgets must be an array, got an object",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateAlertParams(tc.params)
			if err == nil {
				t.Fatalf("expected an error, got nil")
			}
			if err.Error() != tc.want {
				t.Errorf("error = %q, want %q", err.Error(), tc.want)
			}
		})
	}
}
