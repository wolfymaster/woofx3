package main

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/common/messages/workflow"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func TestCheckPublished(t *testing.T) {
	now := time.Date(2026, 11, 20, 10, 15, 30, 123456789, time.UTC)
	run := func(eventType string, data map[string]any) *types.Event {
		return &types.Event{
			ID: "e1", Type: eventType, Source: "workflow", Time: now,
			TriggerID: "trigger-1", TriggeredBy: "dashboard", SessionID: "sess-1",
			WorkflowChain: "wf-0,wf-1", DryRun: true,
			Data: data,
		}
	}
	tests := []struct {
		name  string
		event *types.Event
		ok    bool
	}{
		{"a started run", run("workflow.run.started", map[string]any{"workflowId": "wf-1", "executionId": "r1"}), true},
		{"a failed run with its reason", run("workflow.run.failed", map[string]any{"workflowId": "wf-1", "executionId": "r1", "error": "boom"}), true},
		{"a cancelled run", run("workflow.run.cancelled", map[string]any{"workflowId": "wf-1", "executionId": "r1"}), true},
		{"a run with no execution id", run("workflow.run.completed", map[string]any{"workflowId": "wf-1"}), false},
		{"a run announcing an unlisted field", run("workflow.run.completed", map[string]any{"workflowId": "wf-1", "executionId": "r1", "steps": 3}), false},
		{"a health change", &types.Event{ID: "e2", Type: "workflow.health.changed", Source: "workflow", Time: now,
			Data: map[string]any{"workflowId": "wf-1", "status": "error", "reason": "x", "since": now.Format(time.RFC3339Nano)}}, true},
		{"a health change with an unknown status", &types.Event{ID: "e2", Type: "workflow.health.changed", Source: "workflow", Time: now,
			Data: map[string]any{"workflowId": "wf-1", "status": "degraded", "since": now.Format(time.RFC3339Nano)}}, false},
		{"an event a workflow's own action emits", &types.Event{ID: "e3", Type: "custom.thing", Source: "workflow", Time: now, Data: map[string]any{"anything": 1}}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := json.Marshal(tt.event)
			if err != nil {
				t.Fatal(err)
			}
			if err := checkPublished(tt.event.Type, raw); (err == nil) != tt.ok {
				t.Fatalf("checkPublished = %v, want ok=%v", err, tt.ok)
			}
		})
	}
}

// What the health tracker really publishes and answers must satisfy the contract.
func TestHealthTrackerOutputMeetsItsContract(t *testing.T) {
	tracker, publisher, _ := newBootingTracker()
	tracker.Record("wf-1", errors.New("unknown action"))
	tracker.AnnounceSnapshot()
	tracker.Record("wf-1", nil)
	if len(publisher.events) < 2 {
		t.Fatalf("expected a snapshot and a change, got %d events", len(publisher.events))
	}
	for _, event := range publisher.events {
		raw, err := json.Marshal(event)
		if err != nil {
			t.Fatal(err)
		}
		if err := checkPublished(event.Type, raw); err != nil {
			t.Errorf("%s: %v", event.Type, err)
		}
	}
	if err := checkWire[workflow.WorkflowHealthReply](tracker.HandleHealthRequest()); err != nil {
		t.Errorf("health reply: %v", err)
	}
}

func TestRepliesMeetTheirContracts(t *testing.T) {
	t.Run("execute replies", func(t *testing.T) {
		for _, reply := range []executeReply{
			{Outcome: "started", ExecutionID: "r1", EventType: "channel.follow"},
			{Outcome: "conditions_not_met", Unmet: []engine.UnmetCondition{{Field: "data.amount", Operator: "gte", Value: 5}}},
			{Outcome: "refused", Error: "no workflowId"},
		} {
			if err := checkWire[workflow.WorkflowExecuteReply](encodeExecuteReply(reply)); err != nil {
				t.Errorf("%+v: %v", reply, err)
			}
		}
	})
	t.Run("cancel replies", func(t *testing.T) {
		for _, reply := range []cancelReply{
			{Outcome: "cancelled", Status: "cancelled"},
			{Outcome: "not_found"},
			{Outcome: "refused", Error: "executionId is required"},
		} {
			if err := checkWire[workflow.WorkflowCancelReply](encodeCancelReply(reply)); err != nil {
				t.Errorf("%+v: %v", reply, err)
			}
		}
	})
}

func TestHandleWorkflowCancelRequestRefusesWhatBreaksTheContract(t *testing.T) {
	app := &WorkflowApp{logger: &executeEventLogger{}}
	for name, body := range map[string]string{
		"no execution":     `{"reason":"x"}`,
		"an empty reason":  `{"executionId":"r1","reason":""}`,
		"an unknown field": `{"executionId":"r1","force":true}`,
	} {
		t.Run(name, func(t *testing.T) {
			var reply cancelReply
			if err := json.Unmarshal(app.handleWorkflowCancelRequest(fakeMsg{subject: "workflow.cancel", data: []byte(body)}), &reply); err != nil {
				t.Fatal(err)
			}
			if reply.Outcome != "refused" {
				t.Fatalf("outcome = %q, want refused", reply.Outcome)
			}
		})
	}
}
