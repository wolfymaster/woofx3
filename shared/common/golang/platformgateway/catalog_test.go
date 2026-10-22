package platformgateway

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// fixtureDir holds the cases the TypeScript parsers are tested against too
// (api/tests/platform-gateway-contract.test.ts), so both languages accept and
// refuse the same requests and replies, at the same field.
const fixtureDir = "../../contracts/testdata/platform-gateway"

type requestFixture struct {
	Name         string          `json:"name"`
	InvalidField *string         `json:"invalidField"`
	Request      json.RawMessage `json:"request"`
}

type replyFixture struct {
	Name         string          `json:"name"`
	InvalidField *string         `json:"invalidField"`
	Reply        json.RawMessage `json:"reply"`
}

func readFixtures[T any](t *testing.T, name string) []T {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(fixtureDir, name))
	if err != nil {
		t.Fatalf("reading fixtures: %v", err)
	}
	var file struct {
		Cases []T `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("decoding %s: %v", name, err)
	}
	if len(file.Cases) == 0 {
		t.Fatalf("%s has no cases", name)
	}
	return file.Cases
}

// assertInvalidAt checks err against a fixture's expectation: nil when
// invalidField is null, otherwise a ValidationError at that field.
func assertInvalidAt(t *testing.T, err error, invalidField *string) {
	t.Helper()
	if invalidField == nil {
		if err != nil {
			t.Fatalf("want valid, got %v", err)
		}
		return
	}
	var validation *ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("want a ValidationError at %q, got %v", *invalidField, err)
	}
	if validation.Field != *invalidField {
		t.Fatalf("want invalid at %q, got %v", *invalidField, err)
	}
}

func TestRequestFixtures(t *testing.T) {
	for _, tc := range readFixtures[requestFixture](t, "requests.json") {
		t.Run(tc.Name, func(t *testing.T) {
			var request GatewayRequest
			if err := json.Unmarshal(tc.Request, &request); err != nil {
				t.Fatalf("decoding request: %v", err)
			}
			assertInvalidAt(t, request.Validate(), tc.InvalidField)
		})
	}
}

func TestReplyFixtures(t *testing.T) {
	for _, tc := range readFixtures[replyFixture](t, "replies.json") {
		t.Run(tc.Name, func(t *testing.T) {
			var reply GatewayReply
			err := json.Unmarshal(tc.Reply, &reply)
			if err == nil {
				err = reply.Validate()
			}
			assertInvalidAt(t, err, tc.InvalidField)
		})
	}
}

func mustPayload(t *testing.T, payload any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshalling payload: %v", err)
	}
	return raw
}

func validRequest(t *testing.T) GatewayRequest {
	return GatewayRequest{
		Action:         ActionChatSend,
		Target:         Target{Kind: TargetAll},
		Payload:        mustPayload(t, ChatSendPayload{Message: "hello chat"}),
		IdempotencyKey: "exec-1:task-1",
		RequestedBy:    RequestedBy{Kind: RequesterWorkflow, Ref: "workflow-1"},
	}
}

func field(name string) *string {
	return &name
}

func TestGatewayRequestValidate(t *testing.T) {
	duration := 600
	tooShort := 29
	cases := []struct {
		name         string
		edit         func(t *testing.T, r *GatewayRequest)
		invalidField *string
	}{
		{"all", func(t *testing.T, r *GatewayRequest) {}, nil},
		{"platforms", func(t *testing.T, r *GatewayRequest) {
			r.Target = Target{Kind: TargetPlatforms, IDs: []PlatformID{PlatformTwitch}}
		}, nil},
		{"origin", func(t *testing.T, r *GatewayRequest) {
			r.Target = Target{Kind: TargetOrigin, Origin: &OriginRef{Platform: PlatformTwitch, MessageID: "msg-1"}}
		}, nil},
		{"empty platforms", func(t *testing.T, r *GatewayRequest) {
			r.Target = Target{Kind: TargetPlatforms}
		}, field("target.ids")},
		{"duplicate platforms", func(t *testing.T, r *GatewayRequest) {
			r.Target = Target{Kind: TargetPlatforms, IDs: []PlatformID{PlatformTwitch, PlatformTwitch}}
		}, field("target.ids[1]")},
		{"origin without its ref", func(t *testing.T, r *GatewayRequest) {
			r.Target = Target{Kind: TargetOrigin}
		}, field("target.origin")},
		{"origin with ids", func(t *testing.T, r *GatewayRequest) {
			r.Target = Target{Kind: TargetOrigin, IDs: []PlatformID{PlatformTwitch}, Origin: &OriginRef{Platform: PlatformTwitch}}
		}, field("target.ids")},
		{"unknown target kind", func(t *testing.T, r *GatewayRequest) {
			r.Target = Target{Kind: "everywhere"}
		}, field("target.kind")},
		{"unknown action", func(t *testing.T, r *GatewayRequest) {
			r.Action = "chat.delete"
		}, field("action")},
		{"500 characters", func(t *testing.T, r *GatewayRequest) {
			r.Payload = mustPayload(t, ChatSendPayload{Message: strings.Repeat("a", 500)})
		}, nil},
		{"501 characters", func(t *testing.T, r *GatewayRequest) {
			r.Payload = mustPayload(t, ChatSendPayload{Message: strings.Repeat("a", 501)})
		}, field("payload.message")},
		{"pin an existing message", func(t *testing.T, r *GatewayRequest) {
			r.Action = ActionChatPin
			r.Payload = mustPayload(t, ChatPinExistingPayload{MessageID: "msg-1"})
		}, nil},
		{"pin a new message", func(t *testing.T, r *GatewayRequest) {
			r.Action = ActionChatPin
			r.Payload = mustPayload(t, ChatPinNewPayload{Message: "pinned", DurationSeconds: &duration})
		}, nil},
		{"pin a new message too briefly", func(t *testing.T, r *GatewayRequest) {
			r.Action = ActionChatPin
			r.Payload = mustPayload(t, ChatPinNewPayload{Message: "pinned", DurationSeconds: &tooShort})
		}, field("payload.durationSeconds")},
		{"pin mixing both forms", func(t *testing.T, r *GatewayRequest) {
			r.Action = ActionChatPin
			r.Payload = json.RawMessage(`{"messageId":"msg-1","message":"pinned"}`)
		}, field("payload")},
		{"pin payload sent to chat.send", func(t *testing.T, r *GatewayRequest) {
			r.Payload = mustPayload(t, ChatPinExistingPayload{MessageID: "msg-1"})
		}, field("payload.messageId")},
		{"missing idempotency key", func(t *testing.T, r *GatewayRequest) {
			r.IdempotencyKey = ""
		}, field("idempotencyKey")},
		{"201 character idempotency key", func(t *testing.T, r *GatewayRequest) {
			r.IdempotencyKey = strings.Repeat("k", 201)
		}, field("idempotencyKey")},
		{"unknown requester", func(t *testing.T, r *GatewayRequest) {
			r.RequestedBy.Kind = "module"
		}, field("requestedBy.kind")},
		{"options for an unknown platform", func(t *testing.T, r *GatewayRequest) {
			r.Options = map[PlatformID]json.RawMessage{"kick": json.RawMessage(`{}`)}
		}, field("options.kick")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := validRequest(t)
			tc.edit(t, &request)
			assertInvalidAt(t, request.Validate(), tc.invalidField)
		})
	}
}

// The workflow service stamps its run's chain on events as a comma-joined
// string under "workflowChain"; a request must carry it in exactly that form
// so the echo of the line it posts can be restamped with it.
func TestWorkflowChainRoundTrip(t *testing.T) {
	request := validRequest(t)
	request.WorkflowChain = "workflow-a,workflow-b"
	raw, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshalling: %v", err)
	}
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatalf("decoding wire form: %v", err)
	}
	if wire["workflowChain"] != "workflow-a,workflow-b" {
		t.Fatalf("wire workflowChain = %v", wire["workflowChain"])
	}
	var decoded GatewayRequest
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if !reflect.DeepEqual(decoded, request) {
		t.Fatalf("round trip changed the request:\n got %+v\nwant %+v", decoded, request)
	}
	if err := decoded.Validate(); err != nil {
		t.Fatalf("round-tripped request is invalid: %v", err)
	}

	request.WorkflowChain = ""
	raw, err = json.Marshal(request)
	if err != nil {
		t.Fatalf("marshalling: %v", err)
	}
	if strings.Contains(string(raw), "workflowChain") {
		t.Fatalf("an empty chain should be omitted: %s", raw)
	}
}

func TestPlatformDisplayNames(t *testing.T) {
	for _, id := range PlatformIDs() {
		if !id.Valid() || id.DisplayName() == "" {
			t.Errorf("platform %q: valid %v, display name %q", id, id.Valid(), id.DisplayName())
		}
	}
	if PlatformID("kick").Valid() || PlatformID("kick").DisplayName() != "" {
		t.Errorf("an unknown platform should be invalid with no display name")
	}
}

func TestPlatformOutcomeValidate(t *testing.T) {
	cases := []struct {
		name    string
		outcome PlatformOutcome
		valid   bool
	}{
		{"delivered", PlatformOutcome{Status: OutcomeDelivered, MessageID: "msg-1"}, true},
		{"unavailable while starting", PlatformOutcome{Status: OutcomeUnavailable, Reason: string(UnavailableStarting)}, true},
		{"unavailable for no reason", PlatformOutcome{Status: OutcomeUnavailable}, false},
		{"failed without a code", PlatformOutcome{Status: OutcomeFailed, Message: "boom"}, false},
		{"no status", PlatformOutcome{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.outcome.Validate(); (err == nil) != tc.valid {
				t.Fatalf("Validate() = %v, want valid %v", err, tc.valid)
			}
		})
	}
}

func TestGatewayReplyMarshalRefusalHasEmptyResults(t *testing.T) {
	reply := GatewayReply{Error: &GatewayError{Code: FailureInvalid, Message: "bad payload"}}
	raw, err := json.Marshal(reply)
	if err != nil {
		t.Fatalf("Marshal() = %v", err)
	}
	var decoded GatewayReply
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("Unmarshal(%s) = %v", raw, err)
	}
	if !strings.Contains(string(raw), `"results":{}`) {
		t.Fatalf("want empty results object, got %s", raw)
	}
	if err := decoded.Validate(); err != nil {
		t.Fatalf("a refusal built without results should validate: %v", err)
	}
}
