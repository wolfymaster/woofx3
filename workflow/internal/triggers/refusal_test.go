package triggers

import (
	"strings"
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// These errors become a workflow's health reason verbatim, so each test pins
// the wording a creator reads, not just that an error came back.

func TestScheduleRegistrar_InvalidCronIsARefusalWithTheSchedule(t *testing.T) {
	r := NewScheduleTriggerRegistrar(nil)

	err := r.Register("wf-1", &types.TriggerConfig{Type: "schedule", Schedule: "* * *"})

	if err == nil || !strings.HasPrefix(err.Error(), `schedule "* * *" is not a valid cron expression`) {
		t.Fatalf("err = %v", err)
	}
	if len(r.jobs) != 0 {
		t.Errorf("jobs = %v, want none", r.jobs)
	}
}

func TestScheduleRegistrar_EmptyScheduleIsARefusal(t *testing.T) {
	r := NewScheduleTriggerRegistrar(nil)

	err := r.Register("wf-1", &types.TriggerConfig{Type: "schedule"})

	if err == nil || err.Error() != "schedule trigger names no schedule" {
		t.Fatalf("err = %v", err)
	}
}

func TestEventRegistrar_EmptyEventIsARefusal(t *testing.T) {
	fs := newFakeSubscriber()
	r := NewEventTriggerRegistrar(fs, nil, nil)

	err := r.Register("wf-1", &types.TriggerConfig{Type: "event"})

	if err == nil || err.Error() != "event trigger names no event" {
		t.Fatalf("err = %v", err)
	}
	if len(fs.subscribed) != 0 {
		t.Errorf("subscribed = %v, want none", fs.subscribed)
	}
}

func TestCompositeRegistrar_UnknownTypeIsARefusal(t *testing.T) {
	c := NewCompositeRegistrar()
	c.Set("event", NoopRegistrar{})

	err := c.Register("wf-1", &types.TriggerConfig{Type: "webhook"})

	if err == nil || err.Error() != `trigger type "webhook" is not supported` {
		t.Fatalf("err = %v", err)
	}
}
