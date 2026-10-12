package main

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// quietLogger discards everything; safe for the goroutines the engine logs from.
type quietLogger struct{}

func (quietLogger) Info(string, ...any)  {}
func (quietLogger) Warn(string, ...any)  {}
func (quietLogger) Error(string, ...any) {}
func (quietLogger) Debug(string, ...any) {}

// overlappingWorkflowsApp has two workflows whose patterns both match
// message.user.twitch, each reporting its runs on the returned channel.
func overlappingWorkflowsApp(t *testing.T) (*WorkflowApp, <-chan string) {
	t.Helper()
	app := NewWorkflowApp(quietLogger{})
	ran := make(chan string, 8)
	if err := app.engine.RegisterAction("record", func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		ran <- fmt.Sprint(params["workflow"])
		return nil, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	for id, pattern := range map[string]string{"wf-exact": "message.user.twitch", "wf-wildcard": "message.user.*"} {
		if err := app.engine.RegisterWorkflow(&types.WorkflowDefinition{
			ID:      id,
			Name:    id,
			Trigger: &types.TriggerConfig{Type: "event", Event: pattern},
			Tasks: []types.TaskDefinition{{
				ID: "record", Type: "action", Action: "record",
				Parameters: map[string]any{"workflow": id},
			}},
		}); err != nil {
			t.Fatalf("RegisterWorkflow %s: %v", id, err)
		}
	}
	t.Cleanup(func() { _ = app.engine.Stop() })
	return app, ran
}

func collectRuns(ran <-chan string) map[string]int {
	runs := map[string]int{}
	for {
		select {
		case id := <-ran:
			runs[id]++
		case <-time.After(200 * time.Millisecond):
			return runs
		}
	}
}

// The bus hands an event to every subscription it matches, one copy per
// subscription on its own goroutine. Each workflow must still run once.
func TestHandleTriggerEventRunsOverlappingWorkflowsOnce(t *testing.T) {
	app, ran := overlappingWorkflowsApp(t)
	payload := []byte(`{"id":"e1","type":"message.user.twitch","source":"twitch","data":{}}`)

	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			app.handleTriggerEvent(payload, "message.user.twitch")
		}()
	}
	wg.Wait()

	if runs := collectRuns(ran); runs["wf-exact"] != 1 || runs["wf-wildcard"] != 1 {
		t.Fatalf("runs = %v, want each workflow once", runs)
	}

	app.handleTriggerEvent([]byte(`{"id":"e2","type":"message.user.twitch","source":"twitch","data":{}}`), "message.user.twitch")
	if runs := collectRuns(ran); runs["wf-exact"] != 1 || runs["wf-wildcard"] != 1 {
		t.Fatalf("a new event was taken for a copy; runs = %v", runs)
	}
}

func TestRecentDeliveriesForgetsTheOldest(t *testing.T) {
	r := newRecentDeliveries(2)
	if !r.first("s", "a") || !r.first("s", "b") {
		t.Fatal("new events reported as seen")
	}
	if r.first("s", "a") {
		t.Fatal("a repeat reported as new")
	}
	if !r.first("other", "a") {
		t.Fatal("the same id from another source reported as seen")
	}
	if !r.first("s", "a") {
		t.Fatal("the oldest event was not forgotten at capacity")
	}
}
