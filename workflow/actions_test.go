package main

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
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

	payload, _, err := buildAlertEnvelope(params, event)
	if err != nil {
		t.Fatalf("buildAlertEnvelope: %v", err)
	}

	var got struct {
		ID         string         `json:"id"`
		Parameters map[string]any `json:"parameters"`
		Event      *types.Event   `json:"event"`
	}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if got.ID == "" {
		t.Errorf("envelope id is empty; expected an auto-generated UUID")
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

func TestBuildAlertEnvelope_NilTriggerEvent(t *testing.T) {
	params := map[string]any{
		"widget": "MediaWidget",
		"text":   "manual fire",
	}

	payload, _, err := buildAlertEnvelope(params, nil)
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

func TestValidateAlertParams_AcceptsACompositionLayout(t *testing.T) {
	params := map[string]any{
		"layout": map[string]any{
			"layout":    map[string]any{"width": 1920.0, "height": 1080.0},
			"widgets":   map[string]any{"t1": map[string]any{"widget": "woofx3:widget:text"}},
			"behaviors": map[string]any{},
		},
	}
	if err := validateAlertParams(params); err != nil {
		t.Fatalf("validateAlertParams: %v", err)
	}
}

func TestValidateAlertParams_NamesTheCompositionFieldAtFault(t *testing.T) {
	cases := []struct {
		layout map[string]any
		want   string
	}{
		{map[string]any{"layout": "x", "widgets": map[string]any{}}, `layout.layout must be an object, got the string "x"`},
		{map[string]any{"layout": map[string]any{"height": 1.0}, "widgets": map[string]any{}}, "layout.layout.width must be a positive number, got nothing"},
		{map[string]any{"layout": map[string]any{"width": 1.0, "height": 0.0}, "widgets": map[string]any{}}, "layout.layout.height must be a positive number, got number 0"},
		{map[string]any{"layout": map[string]any{"width": 1.0, "height": 1.0}, "widgets": []any{}}, "layout.widgets must be an object keyed by id, got an array"},
		{map[string]any{"layout": map[string]any{"width": 1.0, "height": 1.0}, "widgets": map[string]any{}, "behaviors": []any{}}, "layout.behaviors must be an object keyed by id, got an array"},
	}
	for _, tc := range cases {
		err := validateAlertParams(map[string]any{"layout": tc.layout})
		if err == nil || err.Error() != tc.want {
			t.Errorf("validateAlertParams(%v) = %v, want %q", tc.layout, err, tc.want)
		}
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

func TestNewChainedEvent_CarriesTriggerChainAndWorkflow(t *testing.T) {
	tests := []struct {
		name    string
		trigger *types.Event
		want    string
	}{
		{"no trigger event starts the chain", nil, "wf-b"},
		{"trigger without a chain starts the chain", &types.Event{}, "wf-b"},
		{"trigger chain is extended", &types.Event{WorkflowChain: "wf-a"}, "wf-a,wf-b"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tasks.ActionContext[AppServices]{WorkflowID: "wf-b", TriggerEvent: tt.trigger}
			event := newChainedEvent(ctx, "message.send", map[string]any{"message": "hi"})

			raw, err := json.Marshal(event)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var wire map[string]any
			if err := json.Unmarshal(raw, &wire); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if wire["workflowChain"] != tt.want {
				t.Errorf("workflowChain = %v, want %q", wire["workflowChain"], tt.want)
			}
			if wire["type"] != "message.send" || wire["source"] != "workflow" || wire["id"] == "" {
				t.Errorf("unexpected envelope: %v", wire)
			}
		})
	}
}

func TestChatReplyMessage(t *testing.T) {
	tests := []struct {
		name         string
		trigger      *types.Event
		params       map[string]any
		wantChain    string
		wantPlatform string
		wantErr      bool
	}{
		{"no trigger starts the chain", nil, map[string]any{"message": "hi"}, "wf-b", "twitch", false},
		{"unchained trigger starts the chain", &types.Event{}, map[string]any{"message": "hi"}, "wf-b", "twitch", false},
		{"chained trigger is extended", &types.Event{WorkflowChain: "wf-a"}, map[string]any{"message": "hi", "platform": "kick"}, "wf-a,wf-b", "kick", false},
		{"missing message is refused", &types.Event{}, map[string]any{"platform": "twitch"}, "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := tasks.ActionContext[AppServices]{WorkflowID: "wf-b", TriggerEvent: tt.trigger}
			raw, err := chatReplyMessage(ctx, tt.params)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("chatReplyMessage: %v", err)
			}
			var wire struct {
				Type          string         `json:"type"`
				Source        string         `json:"source"`
				WorkflowChain string         `json:"workflowChain"`
				Data          map[string]any `json:"data"`
			}
			if err := json.Unmarshal(raw, &wire); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if wire.WorkflowChain != tt.wantChain {
				t.Errorf("workflowChain = %q, want %q", wire.WorkflowChain, tt.wantChain)
			}
			if wire.Type != "message.send" || wire.Source != "workflow" {
				t.Errorf("unexpected envelope: %+v", wire)
			}
			if wire.Data["message"] != "hi" || wire.Data["platform"] != tt.wantPlatform {
				t.Errorf("unexpected data: %v", wire.Data)
			}
		})
	}
}
