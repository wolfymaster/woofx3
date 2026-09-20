package engine

import (
	"strings"
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// replayPublisher captures what a replay announced.
type replayPublisher struct {
	events []*types.Event
}

func (p *replayPublisher) Publish(event *types.Event) error {
	p.events = append(p.events, event)
	return nil
}

func TestPlanResumeWholeRun(t *testing.T) {
	start, exports, skipped, err := planResume([]*types.TaskDefinition{typed("a", "action")}, nil, "")
	if err != nil || start != 0 || len(exports) != 0 || len(skipped) != 0 {
		t.Fatalf("whole run: start=%d exports=%v skipped=%v err=%v", start, exports, skipped, err)
	}
}

// The remaining steps' expressions resolve against earlier steps' outputs, so
// those outputs are what a resume has to put back.
func TestPlanResumeRestoresEarlierOutputs(t *testing.T) {
	order := []*types.TaskDefinition{typed("fetch", "action"), typed("alert", "action")}
	steps := []ReplayStep{
		{TaskID: "fetch", Status: "success", Attempt: 1, Outputs: map[string]any{"user": "x"}},
		{TaskID: "alert", Status: "failed", Attempt: 1},
	}

	start, exports, _, err := planResume(order, steps, "alert")
	if err != nil {
		t.Fatalf("planResume: %v", err)
	}
	if start != 1 {
		t.Errorf("start = %d, want 1", start)
	}
	if exports["fetch"]["user"] != "x" {
		t.Errorf("fetch outputs not restored: %v", exports)
	}
}

// The workflow may have been edited since the run. A step that no longer
// exists cannot be resumed from, and guessing a position would resume at
// whatever step now occupies it.
func TestPlanResumeRefusesRemovedStep(t *testing.T) {
	_, _, _, err := planResume([]*types.TaskDefinition{typed("a", "action")}, nil, "gone")
	if err == nil || !strings.Contains(err.Error(), "no longer exists") {
		t.Fatalf("err = %v, want a removed-step refusal", err)
	}
}

func TestPlanResumeRefusesUnrecordedEarlierStep(t *testing.T) {
	order := []*types.TaskDefinition{typed("a", "action"), typed("b", "action")}
	_, _, _, err := planResume(order, []ReplayStep{{TaskID: "b", Status: "failed", Attempt: 1}}, "b")
	if err == nil || !strings.Contains(err.Error(), "no recorded outcome") {
		t.Fatalf("err = %v, want an unrecorded-step refusal", err)
	}
}

func TestPlanResumeRefusesEarlierFailure(t *testing.T) {
	order := []*types.TaskDefinition{typed("a", "action"), typed("b", "action")}
	_, _, _, err := planResume(order, []ReplayStep{{TaskID: "a", Status: "failed", Attempt: 1}}, "b")
	if err == nil || !strings.Contains(err.Error(), "did not succeed") {
		t.Fatalf("err = %v, want an earlier-failure refusal", err)
	}
}

// Without re-deriving the excluded branch, a run resumed after a condition
// would execute the branch the original run skipped.
func TestPlanResumeRederivesSkippedBranch(t *testing.T) {
	cond := typed("cond", "condition")
	cond.OnTrue = []string{"yes"}
	cond.OnFalse = []string{"no"}
	order := []*types.TaskDefinition{cond, typed("yes", "action"), typed("no", "action"), typed("after", "action")}
	steps := []ReplayStep{
		{TaskID: "cond", Status: "success", Attempt: 1, Outputs: map[string]any{"result": true}},
		{TaskID: "yes", Status: "success", Attempt: 1},
		{TaskID: "after", Status: "failed", Attempt: 1},
	}

	start, _, skipped, err := planResume(order, steps, "after")
	if err != nil {
		t.Fatalf("planResume: %v", err)
	}
	if start != 3 {
		t.Errorf("start = %d, want 3", start)
	}
	if !skipped["no"] {
		t.Errorf("branch not taken was not re-derived: %v", skipped)
	}
	if skipped["yes"] {
		t.Errorf("branch taken was marked skipped: %v", skipped)
	}
}

func TestPlanResumeRefusesConditionWithoutResult(t *testing.T) {
	cond := typed("cond", "condition")
	order := []*types.TaskDefinition{cond, typed("after", "action")}
	steps := []ReplayStep{{TaskID: "cond", Status: "success", Attempt: 1}}

	_, _, _, err := planResume(order, steps, "after")
	if err == nil || !strings.Contains(err.Error(), "no recorded result") {
		t.Fatalf("err = %v, want a missing-result refusal", err)
	}
}

func TestPlanResumeUsesLatestAttempt(t *testing.T) {
	order := []*types.TaskDefinition{typed("a", "action"), typed("b", "action")}
	steps := []ReplayStep{
		{TaskID: "a", Status: "success", Attempt: 2, Outputs: map[string]any{"v": "second"}},
		{TaskID: "a", Status: "failed", Attempt: 1},
	}

	_, exports, _, err := planResume(order, steps, "b")
	if err != nil {
		t.Fatalf("planResume: %v", err)
	}
	if exports["a"]["v"] != "second" {
		t.Errorf("latest attempt not used: %v", exports)
	}
}

// The replay belongs to whoever asked for it, so correlation is replaced -- on
// a copy, never on the recorded event itself.
func TestReplayEventReplacesCorrelationOnACopy(t *testing.T) {
	original := &types.Event{ID: "ev-1", Type: "channel.follow", Source: "twitch", TriggerID: "old", TriggeredBy: "twitch"}

	event := replayEvent(ReplayRequest{TriggerEvent: original, TriggerID: "new", TriggeredBy: "dashboard"})

	if event.TriggerID != "new" || event.TriggeredBy != "dashboard" {
		t.Errorf("correlation not replaced: %+v", event)
	}
	if event.Type != "channel.follow" || event.ID != "ev-1" {
		t.Errorf("original event not carried: %+v", event)
	}
	if original.TriggerID != "old" || original.TriggeredBy != "twitch" {
		t.Errorf("recorded event was mutated: %+v", original)
	}
}

// A replay that cannot run must tell the caller why, correlated with their
// request, rather than leaving them to wait out a timeout.
func TestReplayRefusalAnnouncesAFailedRun(t *testing.T) {
	engine := newExecEngine(t)
	publisher := &replayPublisher{}
	engine.SetPublisher(publisher)

	err := engine.Replay(ReplayRequest{
		WorkflowID:   "missing",
		TriggerEvent: &types.Event{ID: "ev-1", Type: "channel.follow", Source: "twitch"},
		TriggerID:    "corr-1",
		TriggeredBy:  "dashboard",
	})
	if err == nil {
		t.Fatal("expected a refusal for a workflow that is not registered")
	}

	if len(publisher.events) != 1 {
		t.Fatalf("expected one announcement, got %d", len(publisher.events))
	}
	announced := publisher.events[0]
	if announced.Type != "workflow.run.failed" {
		t.Errorf("Type = %q, want workflow.run.failed", announced.Type)
	}
	if announced.TriggerID != "corr-1" {
		t.Errorf("TriggerID = %q, want corr-1", announced.TriggerID)
	}
	if reason, _ := announced.Data["error"].(string); !strings.Contains(reason, "no longer available") {
		t.Errorf("reason = %q, want the refusal reason", reason)
	}
}
