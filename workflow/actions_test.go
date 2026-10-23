package main

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/common/platformgateway"
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

// fakeGateway answers every send with one reply or error and keeps the
// requests it got.
type fakeGateway struct {
	mu       sync.Mutex
	reply    platformgateway.GatewayReply
	err      error
	requests []platformgateway.GatewayRequest
}

func (g *fakeGateway) Send(_ context.Context, request platformgateway.GatewayRequest) (platformgateway.GatewayReply, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.requests = append(g.requests, request)
	return g.reply, g.err
}

func deliveredOn(ids ...platformgateway.PlatformID) platformgateway.GatewayReply {
	results := map[platformgateway.PlatformID]platformgateway.PlatformOutcome{}
	for _, id := range ids {
		results[id] = platformgateway.PlatformOutcome{Status: platformgateway.OutcomeDelivered, MessageID: "m-" + string(id)}
	}
	return platformgateway.GatewayReply{OK: true, Results: results}
}

func chatStepContext(gateway PlatformGateway, trigger *types.Event) tasks.ActionContext[AppServices] {
	return tasks.ActionContext[AppServices]{
		Services:     AppServices{gateway: gateway},
		WorkflowID:   "wf-b",
		ExecutionID:  "exec-1",
		TaskID:       "say",
		TriggerEvent: trigger,
	}
}

func chatLine() *types.Event {
	return &types.Event{
		ID:       "e1",
		Type:     "user.message",
		Source:   "connectors/twitch",
		Platform: "twitch",
		Data:     map[string]any{"messageId": "line-1", "channelId": "chan-1", "message": "!hi"},
	}
}

func TestResolveChatTarget(t *testing.T) {
	twitchOrigin := platformgateway.Target{
		Kind:   platformgateway.TargetOrigin,
		Origin: &platformgateway.OriginRef{Platform: platformgateway.PlatformTwitch, MessageID: "line-1", ChannelID: "chan-1"},
	}
	all := platformgateway.Target{Kind: platformgateway.TargetAll}
	tests := []struct {
		name     string
		platform string
		trigger  *types.Event
		want     platformgateway.Target
		wantErr  string
	}{
		{"origin answers the chat line", "origin", chatLine(), twitchOrigin, ""},
		{"empty means origin", "", chatLine(), twitchOrigin, ""},
		{"origin with no trigger falls back to all", "origin", nil, all, ""},
		{"origin of a platformless trigger falls back to all", "origin", &types.Event{Type: "workflow.schedule.fire"}, all, ""},
		{
			"origin without a message id still names the platform", "origin",
			&types.Event{Platform: "twitch", Data: map[string]any{"chatter": "wolfy"}},
			platformgateway.Target{Kind: platformgateway.TargetOrigin, Origin: &platformgateway.OriginRef{Platform: platformgateway.PlatformTwitch}},
			"",
		},
		{"origin from a platform with no adapter is refused", "origin", &types.Event{Platform: "kick"}, platformgateway.Target{}, `the trigger came from "kick"`},
		{"all", "all", chatLine(), all, ""},
		{
			"a stored twitch step targets twitch alone", "twitch", nil,
			platformgateway.Target{Kind: platformgateway.TargetPlatforms, IDs: []platformgateway.PlatformID{platformgateway.PlatformTwitch}},
			"",
		},
		{"a platform with no adapter is refused", "kick", chatLine(), platformgateway.Target{}, `platform "kick" is not one this engine can send to; choose origin, all, twitch`},
		{"an unresolved expression is refused", "${trigger.data.nope}", chatLine(), platformgateway.Target{}, "is not one this engine can send to"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveChatTarget(tt.platform, tt.trigger)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error = %v, want one containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("resolveChatTarget: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("target = %+v, want %+v", got, tt.want)
			}
			if err := got.Validate(); err != nil {
				t.Errorf("target breaks the contract: %v", err)
			}
		})
	}
}

// Registration never refuses a stored workflow for naming a platform this
// engine has no adapter for; only a value that cannot be a platform at all.
func TestValidateChatPlatformParam(t *testing.T) {
	tests := []struct {
		name    string
		params  map[string]any
		wantErr bool
	}{
		{"absent", map[string]any{"message": "hi"}, false},
		{"null", map[string]any{"platform": nil}, false},
		{"empty", map[string]any{"platform": ""}, false},
		{"origin", map[string]any{"platform": "origin"}, false},
		{"all", map[string]any{"platform": "all"}, false},
		{"twitch", map[string]any{"platform": "twitch"}, false},
		{"a platform this engine has no adapter for", map[string]any{"platform": "kick"}, false},
		{"an id with digits and underscores", map[string]any{"platform": "you_tube2"}, false},
		{"an expression", map[string]any{"platform": "${trigger.platform}"}, false},
		{"upper case", map[string]any{"platform": "Twitch"}, true},
		{"a leading digit", map[string]any{"platform": "2twitch"}, true},
		{"too long", map[string]any{"platform": "a" + strings.Repeat("b", 32)}, true},
		{"not text", map[string]any{"platform": 3.0}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateChatPlatformParam(tt.params)
			if (err != nil) != tt.wantErr {
				t.Errorf("error = %v, want error %v", err, tt.wantErr)
			}
		})
	}
}

func TestChatReplyActionSendsThroughTheGateway(t *testing.T) {
	tests := []struct {
		name       string
		trigger    *types.Event
		params     map[string]any
		wantTarget platformgateway.TargetKind
		wantChain  string
	}{
		{"a chat line is answered where it was said", chatLine(), map[string]any{"message": "hi"}, platformgateway.TargetOrigin, "wf-b"},
		{"a timer run goes everywhere", nil, map[string]any{"message": "hi"}, platformgateway.TargetAll, "wf-b"},
		{"a named platform", &types.Event{WorkflowChain: "wf-a"}, map[string]any{"message": "hi", "platform": "twitch"}, platformgateway.TargetPlatforms, "wf-a,wf-b"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gateway := &fakeGateway{reply: deliveredOn(platformgateway.PlatformTwitch)}

			output, err := NewChatReplyAction()(chatStepContext(gateway, tt.trigger), tt.params)
			if err != nil {
				t.Fatalf("chat.reply: %v", err)
			}

			if len(gateway.requests) != 1 {
				t.Fatalf("sent %d requests, want 1", len(gateway.requests))
			}
			request := gateway.requests[0]
			if request.Action != platformgateway.ActionChatSend || request.Target.Kind != tt.wantTarget {
				t.Errorf("request = %+v", request)
			}
			if request.IdempotencyKey != "exec-1:say" {
				t.Errorf("idempotencyKey = %q, want the run and the step", request.IdempotencyKey)
			}
			if request.RequestedBy != (platformgateway.RequestedBy{Kind: platformgateway.RequesterWorkflow, Ref: "wf-b"}) {
				t.Errorf("requestedBy = %+v", request.RequestedBy)
			}
			if request.WorkflowChain != tt.wantChain {
				t.Errorf("workflowChain = %q, want %q", request.WorkflowChain, tt.wantChain)
			}
			if string(request.Payload) != `{"message":"hi"}` {
				t.Errorf("payload = %s", request.Payload)
			}
			if err := request.Validate(); err != nil {
				t.Errorf("request breaks the contract: %v", err)
			}
			want := map[string]any{
				"message": "hi",
				"ok":      true,
				"results": map[string]any{"twitch": map[string]any{"status": "delivered", "messageId": "m-twitch"}},
			}
			if !reflect.DeepEqual(output, want) {
				t.Errorf("output = %v, want %v", output, want)
			}
		})
	}
}

func TestChatReplyActionFailsUnlessTheReplyIsOK(t *testing.T) {
	tests := []struct {
		name    string
		reply   platformgateway.GatewayReply
		err     error
		params  map[string]any
		wantErr string
		wantIs  error
	}{
		{
			name: "a disabled platform fails the step",
			reply: platformgateway.GatewayReply{Results: map[platformgateway.PlatformID]platformgateway.PlatformOutcome{
				platformgateway.PlatformTwitch: {Status: platformgateway.OutcomeUnavailable, Reason: "disabled"},
			}},
			wantErr: "chat.send did not go through: twitch: unavailable (disabled)",
		},
		{
			name: "a held line says why",
			reply: platformgateway.GatewayReply{Results: map[platformgateway.PlatformID]platformgateway.PlatformOutcome{
				platformgateway.PlatformTwitch: {Status: platformgateway.OutcomeDropped, Reason: "automod"},
			}},
			wantErr: "twitch: held by the platform (automod)",
		},
		{
			name: "an unconfirmed line says it may have posted",
			reply: platformgateway.GatewayReply{Results: map[platformgateway.PlatformID]platformgateway.PlatformOutcome{
				platformgateway.PlatformTwitch: {Status: platformgateway.OutcomeUnconfirmed, Message: "twitch did not answer before the deadline; it may have acted"},
			}},
			wantErr: "twitch: twitch did not answer before the deadline; it may have acted",
		},
		{
			name: "a refused line names the code",
			reply: platformgateway.GatewayReply{Results: map[platformgateway.PlatformID]platformgateway.PlatformOutcome{
				platformgateway.PlatformTwitch: {Status: platformgateway.OutcomeFailed, Code: "rate_limited", Message: "slow down"},
			}},
			wantErr: "twitch: failed (rate_limited): slow down",
		},
		{
			name:    "no platform to send to",
			reply:   platformgateway.GatewayReply{Results: map[platformgateway.PlatformID]platformgateway.PlatformOutcome{}},
			wantErr: "no platform is linked and enabled to send to",
		},
		{
			name: "a whole-request refusal",
			reply: platformgateway.GatewayReply{
				Results: map[platformgateway.PlatformID]platformgateway.PlatformOutcome{},
				Error:   &platformgateway.GatewayError{Code: "invalid", Message: "idempotency key reused"},
			},
			wantErr: "the platform gateway refused chat.send (invalid): idempotency key reused",
		},
		{name: "the gateway is down", err: ErrGatewayUnavailable, wantIs: ErrGatewayUnavailable},
		{name: "the gateway went quiet", err: ErrGatewayTimeout, wantIs: ErrGatewayTimeout},
		{name: "no message", params: map[string]any{"platform": "all"}, wantErr: "message parameter is required"},
		{name: "a platform with no adapter", params: map[string]any{"message": "hi", "platform": "kick"}, wantErr: `platform "kick"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gateway := &fakeGateway{reply: tt.reply, err: tt.err}
			params := tt.params
			if params == nil {
				params = map[string]any{"message": "hi"}
			}

			_, err := NewChatReplyAction()(chatStepContext(gateway, chatLine()), params)

			if tt.wantIs != nil {
				if !errors.Is(err, tt.wantIs) {
					t.Fatalf("error = %v, want %v", err, tt.wantIs)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want one containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestChatReplyDryRun(t *testing.T) {
	tests := []struct {
		params  map[string]any
		want    string
		wantErr bool
	}{
		{map[string]any{"message": "hi"}, `would send "hi" to the chat the trigger came from`, false},
		{map[string]any{"message": "hi", "platform": "origin"}, `would send "hi" to the chat the trigger came from`, false},
		{map[string]any{"message": "hi", "platform": "all"}, `would send "hi" to every linked platform's chat`, false},
		{map[string]any{"message": "hi", "platform": "twitch"}, `would send "hi" to twitch chat`, false},
		{map[string]any{"message": "hi", "platform": "kick"}, "", true},
		{map[string]any{"platform": "twitch"}, "", true},
	}
	for _, tt := range tests {
		got, err := chatReplyActionSpec.DryRun(tt.params)
		if (err != nil) != tt.wantErr || got != tt.want {
			t.Errorf("DryRun(%v) = %q, %v; want %q", tt.params, got, err, tt.want)
		}
	}
}
