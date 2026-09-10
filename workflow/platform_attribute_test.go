package main

import (
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// Event types are platform-agnostic, so `platform` is the only thing that
// tells a workflow where a `channel.follow` came from. If it did not survive
// decoding, every platform filter would silently match nothing.
func TestValidateCloudEventCarriesPlatform(t *testing.T) {
	app := &WorkflowApp{}
	event, err := app.validateCloudEvent([]byte(
		`{"id":"1","type":"channel.follow","source":"twitch","platform":"twitch","data":{"userName":"alice"}}`,
	))
	if err != nil {
		t.Fatalf("validateCloudEvent: %v", err)
	}
	if event.Platform != "twitch" {
		t.Errorf("Platform = %q, want %q", event.Platform, "twitch")
	}
}

// Events with no originating platform (module lifecycle, db outbox,
// scheduler) are valid and simply carry no platform.
func TestValidateCloudEventAllowsAbsentPlatform(t *testing.T) {
	app := &WorkflowApp{}
	event, err := app.validateCloudEvent([]byte(
		`{"id":"1","type":"db.workflow.created","source":"db","data":{}}`,
	))
	if err != nil {
		t.Fatalf("validateCloudEvent: %v", err)
	}
	if event.Platform != "" {
		t.Errorf("Platform = %q, want empty", event.Platform)
	}
}

// Trigger conditions and step expressions must see the same `${trigger.*}`
// fields; they are built from one helper so a field cannot reach one and not
// the other.
func TestTriggerFieldsExposesPlatform(t *testing.T) {
	event := &types.Event{ID: "1", Type: "channel.follow", Source: "twitch", Platform: "twitch"}
	fields := event.TriggerFields()

	got, ok := fields["platform"]
	if !ok {
		t.Fatal("trigger fields have no platform key")
	}
	if got != "twitch" {
		t.Errorf("platform = %v, want twitch", got)
	}
	for _, key := range []string{"id", "type", "source", "time", "data"} {
		if _, ok := fields[key]; !ok {
			t.Errorf("trigger fields missing %q", key)
		}
	}
}
