package engine

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// countingViewer is a ViewerFacts that counts its reads.
type countingViewer struct {
	mu       sync.Mutex
	reads    int
	triggers []string
	viewer   map[string]any
	err      error
}

func (v *countingViewer) Viewer(_ context.Context, trigger string, _ *types.Event) (map[string]any, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.reads++
	v.triggers = append(v.triggers, trigger)
	return v.viewer, v.err
}

func (v *countingViewer) set(viewer map[string]any, err error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.viewer = viewer
	v.err = err
}

func (v *countingViewer) readCount() int {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.reads
}

// viewerHarness is an engine whose `capture` action sends each call's
// parameters on calls.
type viewerHarness struct {
	engine *Engine[execSvcs]
	facts  *countingViewer
	calls  chan map[string]any
}

func newViewerHarness(t *testing.T, viewer map[string]any) *viewerHarness {
	t.Helper()
	h := &viewerHarness{
		engine: newExecEngine(t),
		facts:  &countingViewer{viewer: viewer},
		calls:  make(chan map[string]any, 16),
	}
	h.engine.SetViewerFacts(h.facts)
	if err := h.engine.RegisterAction("capture", func(_ tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		h.calls <- params
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	t.Cleanup(func() { _ = h.engine.Stop() })
	return h
}

func (h *viewerHarness) register(t *testing.T, id string, conditions []types.ConditionConfig, steps ...types.TaskDefinition) {
	t.Helper()
	if err := h.engine.RegisterWorkflow(&types.WorkflowDefinition{
		ID:      id,
		Name:    id,
		Trigger: &types.TriggerConfig{Type: "event", Event: "message.user.twitch", Conditions: conditions},
		Tasks:   steps,
	}); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
}

func (h *viewerHarness) fire(t *testing.T) {
	t.Helper()
	event := &types.Event{ID: "e1", Type: "message.user.twitch", Source: "twitch", Platform: "twitch", Time: time.Now(), Data: map[string]any{"chatterId": "u1"}}
	if err := h.engine.HandleEvent(event); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
}

// awaitCalls returns the parameters of exactly want capture calls.
func (h *viewerHarness) awaitCalls(t *testing.T, want int) []map[string]any {
	t.Helper()
	var got []map[string]any
	for len(got) < want {
		select {
		case params := <-h.calls:
			got = append(got, params)
		case <-time.After(2 * time.Second):
			t.Fatalf("saw %d capture calls, want %d", len(got), want)
		}
	}
	select {
	case params := <-h.calls:
		t.Fatalf("saw a capture call beyond the %d expected: %v", want, params)
	case <-time.After(50 * time.Millisecond):
	}
	return got
}

func captureStep(id string, params map[string]any, dependsOn ...string) types.TaskDefinition {
	return types.TaskDefinition{ID: id, Type: "action", Action: "capture", Parameters: params, DependsOn: dependsOn}
}

func apples(count float64) map[string]any {
	return map[string]any{"id": "u1", "platform": "twitch", "user": map[string]any{"apple_mentions": count}}
}

func TestViewerFactsAreNotReadWhenNothingReferencesThem(t *testing.T) {
	h := newViewerHarness(t, apples(3))
	h.register(t, "wf",
		[]types.ConditionConfig{{Field: "${trigger.data.chatterId}", Operator: "eq", Value: "u1"}},
		captureStep("a", map[string]any{"who": "${trigger.data.chatterId}"}))

	h.fire(t)
	h.awaitCalls(t, 1)
	if n := h.facts.readCount(); n != 0 {
		t.Fatalf("read the viewer's facts %d times, want 0", n)
	}
}

func TestViewerFactsAreReadOnceForConditionsAndSteps(t *testing.T) {
	h := newViewerHarness(t, apples(10))
	h.register(t, "wf",
		[]types.ConditionConfig{{Field: "${viewer.user.apple_mentions}", Operator: "gte", Value: 10}},
		captureStep("a", map[string]any{"apples": "${viewer.user.apple_mentions}", "who": "${viewer.id}"}),
		types.TaskDefinition{
			ID: "b", Type: "action", Action: "capture", DependsOn: []string{"a"},
			Condition:  &types.ConditionConfig{Field: "${viewer.platform}", Operator: "eq", Value: "twitch"},
			Parameters: map[string]any{"line": "${viewer.id} has ${viewer.user.apple_mentions} apples"},
		})
	h.register(t, "wf-other", nil, captureStep("c", map[string]any{"apples": "${viewer.user.apple_mentions}"}))

	h.fire(t)
	calls := h.awaitCalls(t, 3)
	if n := h.facts.readCount(); n != 1 {
		t.Fatalf("read the viewer's facts %d times for one event, want 1", n)
	}
	seen := map[any]bool{}
	for _, params := range calls {
		if apples, ok := params["apples"]; ok {
			if apples != float64(10) {
				t.Fatalf("apples = %v, want 10", apples)
			}
		}
		if line, ok := params["line"]; ok {
			seen[line] = true
		}
		if who, ok := params["who"]; ok && who != "u1" {
			t.Fatalf("who = %v, want u1", who)
		}
	}
	if !seen["u1 has 10 apples"] {
		t.Fatalf("no step templated the viewer into its text: %v", calls)
	}
}

func TestViewerConditionRejectsWhenTheFactIsBelow(t *testing.T) {
	h := newViewerHarness(t, apples(2))
	h.register(t, "wf",
		[]types.ConditionConfig{{Field: "${viewer.user.apple_mentions}", Operator: "gte", Value: 10}},
		captureStep("a", nil))

	h.fire(t)
	h.awaitCalls(t, 0)
}

func TestMissingViewerFactsReadAsAbsentWithoutFailingTheRun(t *testing.T) {
	h := newViewerHarness(t, nil)
	h.register(t, "wf",
		[]types.ConditionConfig{{Field: "${viewer.user.apple_mentions}", Operator: "not_exists"}},
		types.TaskDefinition{
			ID: "guarded", Type: "action", Action: "capture",
			Condition: &types.ConditionConfig{Field: "${viewer.user.apple_mentions}", Operator: "gt", Value: 5},
		},
		captureStep("a", map[string]any{"apples": "${viewer.user.apple_mentions}", "line": "has ${viewer.user.apple_mentions} apples"}))

	h.fire(t)
	calls := h.awaitCalls(t, 1)
	if calls[0]["apples"] != nil || calls[0]["line"] != "has  apples" {
		t.Fatalf("a missing fact templated as %v", calls[0])
	}
}

func TestAStepNamedViewerKeepsItsName(t *testing.T) {
	h := newViewerHarness(t, apples(1))
	h.register(t, "wf", nil,
		types.TaskDefinition{ID: "viewer", Type: "action", Action: "capture"},
		captureStep("a", map[string]any{"ok": "${viewer.ok}"}, "viewer"))

	h.fire(t)
	calls := h.awaitCalls(t, 2)
	if calls[1]["ok"] != true {
		t.Fatalf("${viewer.ok} = %v, want the step's export", calls[1]["ok"])
	}
	if n := h.facts.readCount(); n != 0 {
		t.Fatalf("read the viewer's facts %d times, want 0", n)
	}
}

func TestEngineWithoutViewerFactsResolvesViewerAsMissing(t *testing.T) {
	e := newExecEngine(t)
	calls := make(chan map[string]any, 1)
	if err := e.RegisterAction("capture", func(_ tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		calls <- params
		return nil, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	t.Cleanup(func() { _ = e.Stop() })
	if err := e.RegisterWorkflow(&types.WorkflowDefinition{
		ID:      "wf",
		Name:    "wf",
		Trigger: &types.TriggerConfig{Type: "event", Event: "message.user.twitch"},
		Tasks:   []types.TaskDefinition{captureStep("a", map[string]any{"id": "${viewer.id}"})},
	}); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	if err := e.HandleEvent(&types.Event{ID: "e1", Type: "message.user.twitch", Time: time.Now()}); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	select {
	case params := <-calls:
		if params["id"] != nil {
			t.Fatalf("${viewer.id} = %v, want nil", params["id"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the run did not reach its step")
	}
}

func TestViewerIsReadThroughTheWorkflowsTrigger(t *testing.T) {
	h := newViewerHarness(t, apples(1))
	h.register(t, "wf", nil, captureStep("a", map[string]any{"apples": "${viewer.user.apple_mentions}"}))
	h.fire(t)
	h.awaitCalls(t, 1)
	h.facts.mu.Lock()
	defer h.facts.mu.Unlock()
	if len(h.facts.triggers) != 1 || h.facts.triggers[0] != "message.user.twitch" {
		t.Fatalf("read through %v, want the workflow's trigger event", h.facts.triggers)
	}
}

func TestUnavailableViewerFailsTriggerConditionsClosed(t *testing.T) {
	h := newViewerHarness(t, nil)
	h.facts.set(nil, errors.New("triggers not listed yet"))
	h.register(t, "wf-first-chat",
		[]types.ConditionConfig{{Field: "${viewer.user.messages}", Operator: "not_exists"}},
		captureStep("a", nil))

	h.fire(t)
	h.awaitCalls(t, 0)

	wf, err := h.engine.GetWorkflow("wf-first-chat")
	if err != nil {
		t.Fatalf("GetWorkflow: %v", err)
	}
	event := chatTriggerEvent()
	unmet := h.engine.unmetTriggerConditions(wf, event, h.engine.newViewerLoader(viewerTrigger(wf), event))
	if len(unmet) != 1 || !strings.Contains(unmet[0].Error, "viewer facts unavailable") {
		t.Fatalf("unmet = %+v, want the condition failed with the load error", unmet)
	}
}

func TestUnavailableViewerReadsAsMissingInSteps(t *testing.T) {
	h := newViewerHarness(t, nil)
	h.facts.set(map[string]any{"id": "u1", "platform": "twitch"}, errors.New("db proxy unreachable"))
	h.register(t, "wf", nil,
		captureStep("a", map[string]any{"apples": "${viewer.user.apple_mentions}", "who": "${viewer.id}"}),
		captureStep("b", map[string]any{"apples": "${viewer.user.apple_mentions}"}, "a"))

	h.fire(t)
	calls := h.awaitCalls(t, 2)
	if calls[0]["apples"] != nil || calls[0]["who"] != "u1" || calls[1]["apples"] != nil {
		t.Fatalf("steps read %v, want missing facts and the event's own id", calls)
	}
	if n := h.facts.readCount(); n != 1 {
		t.Fatalf("read %d times, want 1", n)
	}
}

func TestResumeAfterAWaitReadsFreshFacts(t *testing.T) {
	h := newViewerHarness(t, apples(1))
	h.register(t, "wf", nil,
		captureStep("before", map[string]any{"apples": "${viewer.user.apple_mentions}"}),
		types.TaskDefinition{ID: "pause", Type: "wait", DependsOn: []string{"before"}, Wait: &types.WaitConfig{Type: "event", Event: "test.resume"}},
		captureStep("after", map[string]any{"apples": "${viewer.user.apple_mentions}"}, "pause"))

	h.fire(t)
	if before := h.awaitCalls(t, 1); before[0]["apples"] != 1.0 {
		t.Fatalf("before the wait: apples = %v, want 1", before[0]["apples"])
	}
	h.facts.set(apples(5), nil)
	deadline := time.Now().Add(2 * time.Second)
	for {
		h.engine.waitingMu.RLock()
		armed := len(h.engine.armedWaits)
		h.engine.waitingMu.RUnlock()
		if armed == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the wait was never armed")
		}
		time.Sleep(time.Millisecond)
	}
	if err := h.engine.HandleEvent(&types.Event{ID: "r1", Type: "test.resume", Source: "test", Time: time.Now()}); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	if after := h.awaitCalls(t, 1); after[0]["apples"] != 5.0 {
		t.Fatalf("after the wait: apples = %v, want 5", after[0]["apples"])
	}
	if n := h.facts.readCount(); n != 2 {
		t.Fatalf("read %d times, want once before and once after the wait", n)
	}
}

func chatTriggerEvent() *types.Event {
	return &types.Event{ID: "e1", Type: "message.user.twitch", Source: "twitch", Platform: "twitch", Time: time.Now(), Data: map[string]any{"chatterId": "u1"}}
}
