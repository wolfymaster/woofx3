package triggers

import (
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type fakeSubscriber struct {
	subscribed   map[string]int // subject -> #Subscribe calls
	unsubscribed map[string]int // subject -> #Unsubscribe calls
}

func newFakeSubscriber() *fakeSubscriber {
	return &fakeSubscriber{
		subscribed:   map[string]int{},
		unsubscribed: map[string]int{},
	}
}

func (f *fakeSubscriber) Subscribe(subject string, _ func([]byte, string)) (Subscription, error) {
	f.subscribed[subject]++
	return &fakeSub{subject: subject, parent: f}, nil
}

type fakeSub struct {
	subject string
	parent  *fakeSubscriber
}

func (s *fakeSub) Unsubscribe() error {
	s.parent.unsubscribed[s.subject]++
	return nil
}

func TestEventRegistrar_SubscribesOncePerSubject(t *testing.T) {
	fs := newFakeSubscriber()
	r := NewEventTriggerRegistrar(fs, nil)

	trig := &types.TriggerConfig{Type: "event", EventType: "message.user.twitch"}

	if err := r.Register("wf-1", trig); err != nil {
		t.Fatalf("register wf-1: %v", err)
	}
	if err := r.Register("wf-2", trig); err != nil {
		t.Fatalf("register wf-2: %v", err)
	}

	if got := fs.subscribed["message.user.twitch"]; got != 1 {
		t.Errorf("Subscribe call count = %d, want 1", got)
	}
}

func TestEventRegistrar_UnsubscribesOnlyWhenRefCountHitsZero(t *testing.T) {
	fs := newFakeSubscriber()
	r := NewEventTriggerRegistrar(fs, nil)

	trig := &types.TriggerConfig{Type: "event", EventType: "cheer.user.twitch"}

	_ = r.Register("wf-1", trig)
	_ = r.Register("wf-2", trig)

	if err := r.Unregister("wf-1", trig); err != nil {
		t.Fatalf("unregister wf-1: %v", err)
	}
	if got := fs.unsubscribed["cheer.user.twitch"]; got != 0 {
		t.Errorf("premature unsubscribe; got %d calls, want 0", got)
	}

	if err := r.Unregister("wf-2", trig); err != nil {
		t.Fatalf("unregister wf-2: %v", err)
	}
	if got := fs.unsubscribed["cheer.user.twitch"]; got != 1 {
		t.Errorf("Unsubscribe call count after last unregister = %d, want 1", got)
	}
}

func TestEventRegistrar_IdempotentRegisterSameWorkflow(t *testing.T) {
	fs := newFakeSubscriber()
	r := NewEventTriggerRegistrar(fs, nil)

	trig := &types.TriggerConfig{Type: "event", EventType: "follow.user.twitch"}

	_ = r.Register("wf-1", trig)
	_ = r.Register("wf-1", trig) // duplicate register for same workflow must not double the ref count
	_ = r.Unregister("wf-1", trig)

	if got := fs.unsubscribed["follow.user.twitch"]; got != 1 {
		t.Errorf("Unsubscribe = %d after single unregister; ref count was double-counted (want 1)", got)
	}
}

func TestEventRegistrar_IgnoresNonEventTriggers(t *testing.T) {
	fs := newFakeSubscriber()
	r := NewEventTriggerRegistrar(fs, nil)

	trig := &types.TriggerConfig{Type: "schedule", EventType: ""}

	if err := r.Register("wf-1", trig); err != nil {
		t.Fatalf("register schedule: %v", err)
	}

	if len(fs.subscribed) != 0 {
		t.Errorf("Subscribe should not have been called for schedule trigger; got %v", fs.subscribed)
	}
}
