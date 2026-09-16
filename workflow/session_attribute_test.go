package main

import (
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// The session id is stamped by the publisher and never recomputed here, so if
// it did not survive decoding the failure would be silent: every workflow would
// see an empty session rather than an error.
func TestValidateCloudEventCarriesSessionID(t *testing.T) {
	app := &WorkflowApp{}
	event, err := app.validateCloudEvent([]byte(
		`{"id":"1","type":"channel.follow","source":"twitch","sessionId":"sess-1","data":{"userName":"alice"}}`,
	))
	if err != nil {
		t.Fatalf("validateCloudEvent: %v", err)
	}
	if event.SessionID != "sess-1" {
		t.Errorf("SessionID = %q, want %q", event.SessionID, "sess-1")
	}
}

// A publisher that has not yet learned its session emits the event anyway, so
// decoding must accept an absent attribute rather than reject the event.
func TestValidateCloudEventAllowsAbsentSessionID(t *testing.T) {
	app := &WorkflowApp{}
	event, err := app.validateCloudEvent([]byte(
		`{"id":"1","type":"db.workflow.created","source":"db","data":{}}`,
	))
	if err != nil {
		t.Fatalf("validateCloudEvent: %v", err)
	}
	if event.SessionID != "" {
		t.Errorf("SessionID = %q, want empty", event.SessionID)
	}
}

// Trigger conditions and step expressions are built from one helper so a field
// cannot reach one and not the other.
func TestTriggerFieldsExposesSessionID(t *testing.T) {
	event := &types.Event{ID: "1", Type: "channel.follow", Source: "twitch", SessionID: "sess-1"}
	fields := event.TriggerFields()

	got, ok := fields["sessionId"]
	if !ok {
		t.Fatal("trigger fields have no sessionId key")
	}
	if got != "sess-1" {
		t.Errorf("sessionId = %v, want sess-1", got)
	}
}
