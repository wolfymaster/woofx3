package main

import (
	"encoding/json"
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/engine"
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

		// Deterministic despite FireByWorkflowID running workflows in a
		// goroutine: the registry lookup fails first, so no run is ever spawned
		// and there is nothing to race with.
		if len(logger.errors) != 1 {
			t.Fatalf("expected one error, got %v", logger.errors)
		}
	})
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
