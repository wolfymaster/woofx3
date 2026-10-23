package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/common/platformgateway"
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

func TestWorkflowExecuteCarriesDryRun(t *testing.T) {
	app := conditionalWorkflowApp(t)
	reply := decodeExecuteReply(t, app.handleWorkflowExecuteEvent(fakeMsg{
		subject: "workflow.execute",
		data: []byte(`{"id":"e1","type":"workflow.execute","source":"api",` +
			`"data":{"workflowId":"wf-raid","triggerData":{"viewers":25},"dryRun":true}}`),
	}))
	if reply.Outcome != "started" {
		t.Fatalf("reply = %+v", reply)
	}
	execution, err := app.engine.GetExecution(reply.ExecutionID)
	if err != nil {
		t.Fatalf("GetExecution: %v", err)
	}
	if !execution.DryRun {
		t.Error("the run was not a dry run")
	}
}

func TestNativeActionDryRunSentences(t *testing.T) {
	if got, err := functionActionSpec.DryRun(map[string]any{"function": "shoutout:function:greet"}); err != nil || got != "would call module function shoutout:function:greet" {
		t.Errorf("function: %q, %v", got, err)
	}
	if _, err := functionActionSpec.DryRun(map[string]any{}); err == nil {
		t.Error("function: accepted a step naming no function")
	}
	if got, err := chatReplyActionSpec.DryRun(map[string]any{"message": "welcome raiders"}); err != nil || got != `would send "welcome raiders" to the chat the trigger came from` {
		t.Errorf("chat.reply: %q, %v", got, err)
	}
	if _, err := alertActionSpec.DryRun(map[string]any{}); err == nil {
		t.Error("alert: accepted parameters the real action refuses")
	}
	for name, spec := range map[string]bool{
		"function":      functionActionSpec.SideEffect,
		"alert":         alertActionSpec.SideEffect,
		"chat.reply":    chatReplyActionSpec.SideEffect,
		"chat.announce": chatAnnounceActionSpec.SideEffect,
		"chat.pin":      chatPinActionSpec.SideEffect,
	} {
		if !spec {
			t.Errorf("%s is not marked side-effecting", name)
		}
	}
}

func TestHandleCommandExecuteEvent(t *testing.T) {
	t.Run("refuses a payload that is not JSON", func(t *testing.T) {
		logger := &executeEventLogger{}
		app := &WorkflowApp{logger: logger}

		app.handleCommandExecuteEvent(fakeMsg{subject: "workflow.command.execute", data: []byte("not json")})

		if len(logger.errors) != 1 {
			t.Fatalf("expected one error, got %v", logger.errors)
		}
	})

	// An event-triggered workflow named by a command run is refused, so a stale
	// or forged link cannot make an event's workflow run outside its trigger.
	t.Run("refuses a workflow that is not a command's", func(t *testing.T) {
		app := conditionalWorkflowApp(t)
		logger := app.logger.(*executeEventLogger)

		app.handleCommandExecuteEvent(fakeMsg{
			subject: "workflow.command.execute",
			data: []byte(`{"id":"r1","data":{"workflowId":"wf-raid","event":` +
				`{"id":"e1","type":"chat.command.hug","source":"woofwoofwoof","data":{"chatter":"wolfy"}}}}`),
		})

		if len(logger.errors) != 1 {
			t.Fatalf("expected one error, got %v", logger.errors)
		}
	})
}

// echoingChat stands in for the platform gateway and the chat feed together:
// every line it is asked to send comes back as the user.message the twitch
// adapter publishes for an engine line, carrying the sending run's chain.
type echoingChat struct {
	t      *testing.T
	engine *engine.Engine[AppServices]
	mu     sync.Mutex
	sent   int
}

func (c *echoingChat) Send(_ context.Context, request platformgateway.GatewayRequest) (platformgateway.GatewayReply, error) {
	c.mu.Lock()
	c.sent++
	line := c.sent
	c.mu.Unlock()
	messageID := fmt.Sprintf("line-%d", line)
	echo := &types.Event{
		ID:            fmt.Sprintf("echo-%d", line),
		Type:          "user.message",
		Source:        "connectors/twitch",
		Platform:      "twitch",
		WorkflowChain: request.WorkflowChain,
		Data:          map[string]any{"messageId": messageID, "message": "hi again", "fromEngine": true},
	}
	go func() {
		if err := c.engine.HandleEvent(echo); err != nil {
			c.t.Errorf("deliver echo: %v", err)
		}
	}()
	return platformgateway.GatewayReply{OK: true, Results: map[platformgateway.PlatformID]platformgateway.PlatformOutcome{
		platformgateway.PlatformTwitch: {Status: platformgateway.OutcomeDelivered, MessageID: messageID},
	}}, nil
}

// settledChatRuns records every run that finishes and closes failed on the
// first one that failed.
type settledChatRuns struct {
	mu     sync.Mutex
	runs   []types.WorkflowExecution
	failed chan struct{}
}

func (r *settledChatRuns) RunStarted(*types.WorkflowExecution)                  {}
func (r *settledChatRuns) StepSettled(*types.WorkflowExecution, engine.RunStep) {}
func (r *settledChatRuns) RunSettled(execution *types.WorkflowExecution) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runs = append(r.runs, *execution)
	if execution.Status == types.ExecutionStatusFailed && r.failed != nil {
		close(r.failed)
		r.failed = nil
	}
}

func (r *settledChatRuns) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.runs)
}

// A workflow that answers every chat line answers its own lines too, since
// the engine speaks as the broadcaster. The chain the chat step hands the
// gateway comes back on the echo, so the loop guard stops it after
// MaxWorkflowChain lines instead of letting it talk to itself forever.
func TestAWorkflowAnsweringItsOwnChatLinesIsStopped(t *testing.T) {
	quiet := quietLogger{}
	runs := engine.New[AppServices](quiet)
	chat := &echoingChat{t: t, engine: runs}
	recorder := &settledChatRuns{failed: make(chan struct{})}
	runs.SetRunRecorder(recorder)
	if err := runs.RegisterActionWithSpec("chat.reply", WithServices(AppServices{gateway: chat}, NewChatReplyAction()), chatReplyActionSpec); err != nil {
		t.Fatalf("register chat.reply: %v", err)
	}
	if err := runs.RegisterWorkflow(&types.WorkflowDefinition{
		ID:      "wf-chatty",
		Name:    "Chatty",
		Trigger: &types.TriggerConfig{Type: "event", Event: "user.message"},
		Tasks: []types.TaskDefinition{{
			ID:         "answer",
			Type:       "action",
			Action:     "chat.reply",
			Parameters: map[string]any{"message": "hi again"},
		}},
	}); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}

	failed := recorder.failed
	if err := runs.HandleEvent(&types.Event{
		ID: "viewer-line", Type: "user.message", Source: "connectors/twitch", Platform: "twitch",
		Data: map[string]any{"messageId": "viewer-1", "message": "hello", "fromEngine": false},
	}); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	select {
	case <-failed:
	case <-time.After(5 * time.Second):
		t.Fatalf("the loop was not stopped; %d runs settled", recorder.count())
	}
	deadline := time.Now().Add(5 * time.Second)
	for recorder.count() < engine.MaxWorkflowChain+1 {
		if time.Now().After(deadline) {
			t.Fatalf("%d runs settled, want %d", recorder.count(), engine.MaxWorkflowChain+1)
		}
		time.Sleep(time.Millisecond)
	}

	chat.mu.Lock()
	sent := chat.sent
	chat.mu.Unlock()
	if sent != engine.MaxWorkflowChain {
		t.Errorf("sent %d lines, want %d", sent, engine.MaxWorkflowChain)
	}
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	var refusals []string
	for _, run := range recorder.runs {
		if run.Status == types.ExecutionStatusFailed {
			refusals = append(refusals, run.Error)
		}
	}
	if len(refusals) != 1 || !strings.Contains(refusals[0], "Chatty keeps triggering itself") {
		t.Errorf("refusals = %q", refusals)
	}
}

// A chat step's platform may be an expression; the engine resolves it against
// the trigger before the action sees it, and the gateway gets the result.
func TestChatReplyPlatformExpressionsResolveAgainstTheTrigger(t *testing.T) {
	tests := []struct {
		name         string
		platform     string
		trigger      *types.Event
		wantKind     platformgateway.TargetKind
		wantPlatform platformgateway.PlatformID
	}{
		{
			name:     "the trigger's platform answers where the line was said",
			platform: "${trigger.platform}",
			trigger:  &types.Event{ID: "e1", Type: "user.message", Platform: "twitch", Data: map[string]any{"messageId": "m1"}},
			wantKind: platformgateway.TargetPlatforms, wantPlatform: platformgateway.PlatformTwitch,
		},
		{
			name:     "a field of the trigger's data names the platform",
			platform: "${trigger.data.where}",
			trigger:  &types.Event{ID: "e2", Type: "user.message", Data: map[string]any{"where": "twitch"}},
			wantKind: platformgateway.TargetPlatforms, wantPlatform: platformgateway.PlatformTwitch,
		},
		{
			name:     "a data field naming all goes everywhere",
			platform: "${trigger.data.where}",
			trigger:  &types.Event{ID: "e3", Type: "user.message", Data: map[string]any{"where": "all"}},
			wantKind: platformgateway.TargetAll,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gateway := &fakeGateway{reply: deliveredOn(platformgateway.PlatformTwitch)}
			runs := engine.New[AppServices](quietLogger{})
			recorder := &settledChatRuns{}
			runs.SetRunRecorder(recorder)
			if err := runs.RegisterActionWithSpec("chat.reply", WithServices(AppServices{gateway: gateway}, NewChatReplyAction()), chatReplyActionSpec); err != nil {
				t.Fatalf("register chat.reply: %v", err)
			}
			if err := runs.RegisterWorkflow(&types.WorkflowDefinition{
				ID:      "wf-templated",
				Name:    "Templated",
				Trigger: &types.TriggerConfig{Type: "event", Event: "user.message"},
				Tasks: []types.TaskDefinition{{
					ID: "answer", Type: "action", Action: "chat.reply",
					Parameters: map[string]any{"message": "hi", "platform": tt.platform},
				}},
			}); err != nil {
				t.Fatalf("RegisterWorkflow: %v", err)
			}

			if err := runs.HandleEvent(tt.trigger); err != nil {
				t.Fatalf("HandleEvent: %v", err)
			}
			deadline := time.Now().Add(5 * time.Second)
			for recorder.count() < 1 {
				if time.Now().After(deadline) {
					t.Fatal("the run never settled")
				}
				time.Sleep(time.Millisecond)
			}

			gateway.mu.Lock()
			defer gateway.mu.Unlock()
			if len(gateway.requests) != 1 {
				t.Fatalf("gateway got %d requests, want 1", len(gateway.requests))
			}
			target := gateway.requests[0].Target
			if target.Kind != tt.wantKind {
				t.Fatalf("target kind = %q, want %q", target.Kind, tt.wantKind)
			}
			if tt.wantPlatform != "" && (len(target.IDs) != 1 || target.IDs[0] != tt.wantPlatform) {
				t.Errorf("target platforms = %v, want [%s]", target.IDs, tt.wantPlatform)
			}
		})
	}
}
