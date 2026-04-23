package triggers

import (
	"errors"
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type fakeSubscriber struct {
	subscribed   map[string]int // subject -> #Subscribe calls
	unsubscribed map[string]int // subject -> #Unsubscribe calls
	subscribeErr error          // if set, Subscribe returns this instead of a handle
}

func newFakeSubscriber() *fakeSubscriber {
	return &fakeSubscriber{
		subscribed:   map[string]int{},
		unsubscribed: map[string]int{},
	}
}

func (f *fakeSubscriber) Subscribe(subject string, _ func([]byte, string)) (Subscription, error) {
	if f.subscribeErr != nil {
		return nil, f.subscribeErr
	}
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
	r := NewEventTriggerRegistrar(fs, nil, nil)

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
	r := NewEventTriggerRegistrar(fs, nil, nil)

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
	r := NewEventTriggerRegistrar(fs, nil, nil)

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
	r := NewEventTriggerRegistrar(fs, nil, nil)

	trig := &types.TriggerConfig{Type: "schedule", EventType: ""}

	if err := r.Register("wf-1", trig); err != nil {
		t.Fatalf("register schedule: %v", err)
	}

	if len(fs.subscribed) != 0 {
		t.Errorf("Subscribe should not have been called for schedule trigger; got %v", fs.subscribed)
	}
}

func TestEventRegistrar_SubscribeErrorLeavesStateUnchanged(t *testing.T) {
	fs := newFakeSubscriber()
	fs.subscribeErr = errors.New("nats down")
	r := NewEventTriggerRegistrar(fs, nil, nil)

	trig := &types.TriggerConfig{Type: "event", EventType: "message.user.twitch"}

	err := r.Register("wf-1", trig)
	if err == nil {
		t.Fatalf("expected Register to return Subscribe error, got nil")
	}
	if !errors.Is(err, fs.subscribeErr) {
		t.Errorf("Register error = %v; want wrapped %v", err, fs.subscribeErr)
	}

	if len(r.subjects) != 0 {
		t.Errorf("subjects map non-empty after failed Subscribe: %v", r.subjects)
	}
	if len(r.workflows) != 0 {
		t.Errorf("workflows map non-empty after failed Subscribe: %v", r.workflows)
	}
}

func TestEventRegistrar_UpdateReleasesOldSubjectAndSubscribesNew(t *testing.T) {
	fs := newFakeSubscriber()
	r := NewEventTriggerRegistrar(fs, nil, nil)

	subjectA := "message.user.twitch"
	subjectB := "cheer.user.twitch"

	if err := r.Register("wf-1", &types.TriggerConfig{Type: "event", EventType: subjectA}); err != nil {
		t.Fatalf("register wf-1 to %s: %v", subjectA, err)
	}
	if err := r.Register("wf-1", &types.TriggerConfig{Type: "event", EventType: subjectB}); err != nil {
		t.Fatalf("re-register wf-1 to %s: %v", subjectB, err)
	}

	if got := fs.subscribed[subjectA]; got != 1 {
		t.Errorf("Subscribe calls for %s = %d, want 1", subjectA, got)
	}
	if got := fs.subscribed[subjectB]; got != 1 {
		t.Errorf("Subscribe calls for %s = %d, want 1", subjectB, got)
	}
	if got := fs.unsubscribed[subjectA]; got != 1 {
		t.Errorf("Unsubscribe calls for %s = %d, want 1", subjectA, got)
	}
	if got := fs.unsubscribed[subjectB]; got != 0 {
		t.Errorf("Unsubscribe calls for %s = %d, want 0", subjectB, got)
	}
}
