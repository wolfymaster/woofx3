package triggers

import (
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func TestScheduleRegistrar_FiresOnSchedule(t *testing.T) {
	var mu sync.Mutex
	fired := []string{}
	onFire := func(workflowID string) {
		mu.Lock()
		defer mu.Unlock()
		fired = append(fired, workflowID)
	}

	r := NewScheduleTriggerRegistrar(onFire)
	r.Start()
	defer r.Stop()

	// Cron supports seconds when the scheduler is constructed with WithSeconds.
	// We use the default (5-field) parser and trigger via the test-only Trigger method.
	trig := &types.TriggerConfig{Type: "schedule", Schedule: "0 * * * *"}
	if err := r.Register("wf-1", trig); err != nil {
		t.Fatalf("register: %v", err)
	}

	// Manually advance via the test-only Trigger path rather than waiting for
	// cron to fire naturally — avoids test flake.
	r.triggerForTest("wf-1")

	// Give the callback a moment to run (cron runs jobs in goroutines).
	time.Sleep(20 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if len(fired) != 1 || fired[0] != "wf-1" {
		t.Errorf("fired = %v, want [wf-1]", fired)
	}
}

func TestScheduleRegistrar_UnregisterStopsFiring(t *testing.T) {
	var mu sync.Mutex
	fired := 0
	onFire := func(string) {
		mu.Lock()
		fired++
		mu.Unlock()
	}

	r := NewScheduleTriggerRegistrar(onFire)
	r.Start()
	defer r.Stop()

	trig := &types.TriggerConfig{Type: "schedule", Schedule: "0 * * * *"}
	_ = r.Register("wf-1", trig)
	_ = r.Unregister("wf-1", trig)

	r.triggerForTest("wf-1") // should be a no-op
	time.Sleep(20 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if fired != 0 {
		t.Errorf("fired = %d after unregister, want 0", fired)
	}
}
