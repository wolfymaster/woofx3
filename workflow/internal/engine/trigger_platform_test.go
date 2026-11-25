package engine

import (
	"fmt"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/common/platformgateway"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func pinnedFollowWorkflow(platform string) *types.WorkflowDefinition {
	return &types.WorkflowDefinition{
		ID:      "wf-follow",
		Name:    "follow alert",
		Trigger: &types.TriggerConfig{Type: "event", Event: "channel.follow", Platform: platformgateway.PlatformID(platform)},
		Tasks:   []types.TaskDefinition{{ID: "say", Type: "action", Action: "echo", Parameters: map[string]any{}}},
	}
}

func TestTriggerPlatformPinDecidesWhetherAnEventFires(t *testing.T) {
	cases := []struct {
		pin, eventPlatform string
		fires              bool
	}{
		{pin: "", eventPlatform: "", fires: true},
		{pin: "", eventPlatform: "twitch", fires: true},
		{pin: "", eventPlatform: "kick", fires: true},
		{pin: "twitch", eventPlatform: "", fires: false},
		{pin: "twitch", eventPlatform: "twitch", fires: true},
		{pin: "twitch", eventPlatform: "kick", fires: false},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("pin %q, event from %q", tc.pin, tc.eventPlatform), func(t *testing.T) {
			eng := newExecEngine(t)
			wf := pinnedFollowWorkflow(tc.pin)
			event := &types.Event{ID: "e1", Type: "channel.follow", Time: time.Now(), Platform: tc.eventPlatform, Data: map[string]any{}}

			err := eng.evaluateTrigger(wf, event, nil)

			if tc.fires && err != nil {
				t.Fatalf("want the trigger to fire, got %v", err)
			}
			if !tc.fires && err == nil {
				t.Fatal("want the trigger refused")
			}
		})
	}
}

func TestManualRunReportsTheTriggerPlatformAsUnmet(t *testing.T) {
	h := newManualHarness(t, pinnedFollowWorkflow("twitch"))
	request := manualRequest()
	request.Data["workflowId"] = "wf-follow"

	result, err := h.engine.RunManual(ManualRun{WorkflowID: "wf-follow", Request: request, TriggerData: map[string]any{}, Platform: "kick"})
	if err != nil {
		t.Fatalf("RunManual: %v", err)
	}
	if result.Outcome != ManualRunConditionsNotMet {
		t.Fatalf("outcome = %q, want conditions_not_met", result.Outcome)
	}
	want := UnmetCondition{Field: TriggerPlatformField, Operator: "eq", Value: "twitch"}
	if len(result.Unmet) != 1 || result.Unmet[0] != want {
		t.Fatalf("unmet = %+v, want %+v", result.Unmet, want)
	}
}
