package main

import (
	"encoding/json"
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// executeEventLogger captures what a handler reported, so a test can assert that a
// bad message was refused rather than silently dropped.
type executeEventLogger struct {
	errors []string
	infos  []string
}

func (l *executeEventLogger) Info(message string, _ ...any)  { l.infos = append(l.infos, message) }
func (l *executeEventLogger) Warn(_ string, _ ...any)        {}
func (l *executeEventLogger) Error(message string, _ ...any) { l.errors = append(l.errors, message) }
func (l *executeEventLogger) Debug(_ string, _ ...any)       {}

// fakeMsg is the smallest natsclient.Msg these handlers need.
type fakeMsg struct {
	subject string
	data    []byte
}

func (m fakeMsg) Subject() string          { return m.subject }
func (m fakeMsg) Data() []byte             { return m.data }
func (m fakeMsg) JSON(v interface{}) error { return json.Unmarshal(m.data, v) }
func (m fakeMsg) String() string           { return string(m.data) }

func TestHandleWorkflowExecuteEvent(t *testing.T) {
	// The engine is left nil in the two refusal cases on purpose: both must
	// return before reaching it. A panic here would take the whole subscription
	// down, so one malformed message would stop every later one being delivered.
	t.Run("refuses a payload that is not a CloudEvent", func(t *testing.T) {
		logger := &executeEventLogger{}
		app := &WorkflowApp{logger: logger}

		app.handleWorkflowExecuteEvent(fakeMsg{subject: "workflow.execute", data: []byte("not json")})

		if len(logger.errors) != 1 {
			t.Fatalf("expected one error, got %v", logger.errors)
		}
	})

	t.Run("refuses an event naming no workflow", func(t *testing.T) {
		logger := &executeEventLogger{}
		app := &WorkflowApp{logger: logger}

		app.handleWorkflowExecuteEvent(fakeMsg{
			subject: "workflow.execute",
			data:    []byte(`{"id":"e1","type":"workflow.execute","source":"api","data":{}}`),
		})

		if len(logger.errors) != 1 {
			t.Fatalf("expected one error, got %v", logger.errors)
		}
	})

	t.Run("reports a workflow the registry does not hold", func(t *testing.T) {
		logger := &executeEventLogger{}
		app := &WorkflowApp{logger: logger, engine: engine.New[AppServices](logger)}

		app.handleWorkflowExecuteEvent(fakeMsg{
			subject: "workflow.execute",
			data:    []byte(`{"id":"e1","type":"workflow.execute","source":"api","data":{"workflowId":"missing"}}`),
		})

		// Deterministic despite runs executing in a goroutine: the registry
		// lookup fails first, so no run is ever spawned and there is nothing
		// to race with.
		if len(logger.errors) != 1 {
			t.Fatalf("expected one error, got %v", logger.errors)
		}
	})
}

func decodeExecuteReply(t *testing.T, raw []byte) executeReply {
	t.Helper()
	var reply executeReply
	if err := json.Unmarshal(raw, &reply); err != nil {
		t.Fatalf("reply %q is not JSON: %v", raw, err)
	}
	return reply
}

func conditionalWorkflowApp(t *testing.T) *WorkflowApp {
	t.Helper()
	logger := &executeEventLogger{}
	app := &WorkflowApp{logger: logger, engine: engine.New[AppServices](logger)}
	if err := app.engine.RegisterWorkflow(&types.WorkflowDefinition{
		ID:   "wf-raid",
		Name: "raid",
		Trigger: &types.TriggerConfig{
			Type:       "event",
			Event:      "channel.raid",
			Conditions: []types.ConditionConfig{{Field: "${trigger.data.viewers}", Operator: "gte", Value: 10}},
		},
		Tasks: []types.TaskDefinition{{ID: "log", Type: "log", Parameters: map[string]any{"message": "raid"}}},
	}); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	return app
}

func TestWorkflowExecuteReplies(t *testing.T) {
	t.Run("a sample that satisfies the conditions starts a run", func(t *testing.T) {
		app := conditionalWorkflowApp(t)
		reply := decodeExecuteReply(t, app.handleWorkflowExecuteEvent(fakeMsg{
			subject: "workflow.execute",
			data: []byte(`{"id":"e1","type":"workflow.execute","source":"api","triggeredBy":"test",` +
				`"data":{"workflowId":"wf-raid","triggerData":{"viewers":25},"platform":"twitch"}}`),
		}))
		if reply.Outcome != "started" || reply.ExecutionID == "" || reply.EventType != "channel.raid" {
			t.Fatalf("reply = %+v", reply)
		}
	})

	t.Run("a sample that fails the conditions is refused with the reason", func(t *testing.T) {
		app := conditionalWorkflowApp(t)
		reply := decodeExecuteReply(t, app.handleWorkflowExecuteEvent(fakeMsg{
			subject: "workflow.execute",
			data:    []byte(`{"id":"e1","type":"workflow.execute","source":"api","data":{"workflowId":"wf-raid","triggerData":{"viewers":2}}}`),
		}))
		if reply.Outcome != "conditions_not_met" || len(reply.Unmet) != 1 || reply.Unmet[0].Field != "${trigger.data.viewers}" {
			t.Fatalf("reply = %+v", reply)
		}
	})

	t.Run("skipConditions runs it anyway", func(t *testing.T) {
		app := conditionalWorkflowApp(t)
		reply := decodeExecuteReply(t, app.handleWorkflowExecuteEvent(fakeMsg{
			subject: "workflow.execute",
			data: []byte(`{"id":"e1","type":"workflow.execute","source":"api",` +
				`"data":{"workflowId":"wf-raid","triggerData":{"viewers":2},"skipConditions":true}}`),
		}))
		if reply.Outcome != "started" {
			t.Fatalf("reply = %+v", reply)
		}
	})

	t.Run("an unknown workflow is refused", func(t *testing.T) {
		app := conditionalWorkflowApp(t)
		reply := decodeExecuteReply(t, app.handleWorkflowExecuteEvent(fakeMsg{
			subject: "workflow.execute",
			data:    []byte(`{"id":"e1","type":"workflow.execute","source":"api","data":{"workflowId":"missing"}}`),
		}))
		if reply.Outcome != "refused" || reply.Error == "" {
			t.Fatalf("reply = %+v", reply)
		}
	})
}

func TestWorkflowCancelReplies(t *testing.T) {
	app := conditionalWorkflowApp(t)

	notFound := app.handleWorkflowCancelRequest(fakeMsg{subject: "workflow.cancel", data: []byte(`{"executionId":"nope"}`)})
	if string(notFound) != `{"outcome":"not_found"}` {
		t.Errorf("unknown run reply = %s", notFound)
	}

	refused := app.handleWorkflowCancelRequest(fakeMsg{subject: "workflow.cancel", data: []byte(`{}`)})
	var reply cancelReply
	if err := json.Unmarshal(refused, &reply); err != nil || reply.Outcome != "refused" {
		t.Errorf("empty request reply = %s", refused)
	}
}

// The correlation attributes have to exist on types.Event or encoding/json
// drops them on the way in, and the run would then be reported against nothing
// -- a caller would wait forever for an outcome that had nowhere to go. That
// failure is invisible at the call site, so it is guarded here.
func TestCloudEventCarriesCorrelationAttributes(t *testing.T) {
	app := &WorkflowApp{}

	event, err := app.validateCloudEvent([]byte(
		`{"id":"e1","type":"workflow.execute","source":"api",` +
			`"triggerId":"corr-1","triggeredBy":"dashboard","data":{"workflowId":"wf-1"}}`,
	))
	if err != nil {
		t.Fatalf("validateCloudEvent() error = %v", err)
	}

	if event.TriggerID != "corr-1" {
		t.Errorf("TriggerID = %q, want corr-1", event.TriggerID)
	}
	if event.TriggeredBy != "dashboard" {
		t.Errorf("TriggeredBy = %q, want dashboard", event.TriggeredBy)
	}
}
