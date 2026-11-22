package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type fakeCommands struct {
	commands []*dbv1.Command
	err      error
}

var errFakeCommandsUnused = errors.New("fakeCommands: method not used by command.run")

func (f fakeCommands) GetCommand(context.Context, *dbv1.GetCommandRequest) (*dbv1.CommandResponse, error) {
	return nil, errFakeCommandsUnused
}

func (f fakeCommands) CreateCommand(context.Context, *dbv1.CreateCommandRequest) (*dbv1.CommandResponse, error) {
	return nil, errFakeCommandsUnused
}

func (f fakeCommands) UpdateCommand(context.Context, *dbv1.UpdateCommandRequest) (*dbv1.CommandResponse, error) {
	return nil, errFakeCommandsUnused
}

func (f fakeCommands) DeleteCommand(context.Context, *dbv1.DeleteCommandRequest) (*dbv1.ResponseStatus, error) {
	return nil, errFakeCommandsUnused
}

func (f fakeCommands) ListCommands(context.Context, *dbv1.ListCommandsRequest) (*dbv1.ListCommandsResponse, error) {
	return &dbv1.ListCommandsResponse{Commands: f.commands}, f.err
}

type fakeRunner struct {
	runs    []engine.CommandRun
	outcome engine.CommandRunOutcome
	err     error
}

func (f *fakeRunner) RunCommand(run engine.CommandRun) (engine.CommandRunOutcome, string, error) {
	f.runs = append(f.runs, run)
	return f.outcome, "exec-1", f.err
}

type fakeAnnouncer struct {
	events []*types.Event
	err    error
}

func (f *fakeAnnouncer) Publish(event *types.Event) error {
	f.events = append(f.events, event)
	return f.err
}

func commandRunContext(commands fakeCommands) tasks.ActionContext[AppServices] {
	return tasks.ActionContext[AppServices]{
		Services:   AppServices{commands: commands},
		WorkflowID: "wf-schedule",
		Context:    context.Background(),
	}
}

func TestCommandRunActionRunsTheCommandsWorkflowAndAnnouncesIt(t *testing.T) {
	runner := &fakeRunner{outcome: engine.CommandRunStarted}
	announcer := &fakeAnnouncer{}
	commands := fakeCommands{commands: []*dbv1.Command{
		{Command: "other", Enabled: true, WorkflowId: "wf-other"},
		{Command: "hug", Enabled: true, WorkflowId: "wf-hug"},
	}}

	out, err := newTestCommandRunAction(runner, announcer)(commandRunContext(commands), map[string]any{"command": "!Hug"})
	if err != nil {
		t.Fatalf("command.run: %v", err)
	}
	if out["started"] != true || out["executionId"] != "exec-1" {
		t.Errorf("output = %v, want started with exec-1", out)
	}
	if len(runner.runs) != 1 || runner.runs[0].WorkflowID != "wf-hug" {
		t.Fatalf("runs = %+v, want one run of wf-hug", runner.runs)
	}
	if got := runner.runs[0].Event.Type; got != "chat.command.hug" {
		t.Errorf("event type = %q, want chat.command.hug", got)
	}
	if got := runner.runs[0].Event.ID; got != "evt-1" {
		t.Errorf("event id = %q, want the injected id", got)
	}
	data := runner.runs[0].Event.Data
	if data["command"] != "hug" || data["chatter"] != "" || data["rawMessage"] != "!hug" {
		t.Errorf("event data = %v, want the command with no chatter", data)
	}
	if platform, present := data["platform"]; !present || platform != nil {
		t.Errorf("event data platform = %v (present %v), want an explicit null for a run no chat caused", platform, present)
	}
	if len(announcer.events) != 1 || announcer.events[0] != runner.runs[0].Event {
		t.Errorf("announced %v, want the event the run read", announcer.events)
	}
}

func TestCommandRunActionRefusals(t *testing.T) {
	tests := []struct {
		name     string
		params   map[string]any
		commands fakeCommands
		want     string
	}{
		{"no command", map[string]any{}, fakeCommands{}, "command parameter is required"},
		{"bad name", map[string]any{"command": "a.b"}, fakeCommands{}, "invalid command name"},
		{"unknown command", map[string]any{"command": "hug"}, fakeCommands{}, "does not exist"},
		{
			"disabled", map[string]any{"command": "hug"},
			fakeCommands{commands: []*dbv1.Command{{Command: "hug", WorkflowId: "wf-hug"}}}, "is disabled",
		},
		{
			"no steps", map[string]any{"command": "hug"},
			fakeCommands{commands: []*dbv1.Command{{Command: "hug", Enabled: true}}}, "has no steps",
		},
		{
			"db failure", map[string]any{"command": "hug"},
			fakeCommands{err: errors.New("db down")}, "listing commands: db down",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runner := &fakeRunner{outcome: engine.CommandRunStarted}
			_, err := newTestCommandRunAction(runner, &fakeAnnouncer{})(commandRunContext(tt.commands), tt.params)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want one containing %q", err, tt.want)
			}
			if len(runner.runs) != 0 {
				t.Errorf("ran %d workflows, want none", len(runner.runs))
			}
		})
	}
}

func TestCommandRunActionDoesNotAnnounceARunConditionsStopped(t *testing.T) {
	runner := &fakeRunner{outcome: engine.CommandRunConditionsNotMet}
	announcer := &fakeAnnouncer{}
	commands := fakeCommands{commands: []*dbv1.Command{{Command: "hug", Enabled: true, WorkflowId: "wf-hug"}}}

	out, err := newTestCommandRunAction(runner, announcer)(commandRunContext(commands), map[string]any{"command": "hug"})
	if err != nil {
		t.Fatalf("command.run: %v", err)
	}
	if out["started"] != false || len(announcer.events) != 0 {
		t.Errorf("started = %v, announced %d, want not started and nothing announced", out["started"], len(announcer.events))
	}
}

func TestCommandRunActionSaysWhenOnlyTheAnnouncementFailed(t *testing.T) {
	runner := &fakeRunner{outcome: engine.CommandRunStarted}
	announcer := &fakeAnnouncer{err: errors.New("bus down")}
	commands := fakeCommands{commands: []*dbv1.Command{{Command: "hug", Enabled: true, WorkflowId: "wf-hug"}}}

	_, err := newTestCommandRunAction(runner, announcer)(commandRunContext(commands), map[string]any{"command": "hug"})
	if err == nil || !strings.Contains(err.Error(), "ran its steps, but announcing it failed") {
		t.Fatalf("error = %v, want the already-ran announcement failure", err)
	}
}

func newTestCommandRunAction(runner commandRunner, announcer commandAnnouncer) tasks.ActionFunc[AppServices] {
	at := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	return NewCommandRunAction(runner, announcer, func() time.Time { return at }, func() string { return "evt-1" })
}

func TestNewChatCommandEventKeepsTheTriggersPlatformAndChain(t *testing.T) {
	trigger := &types.Event{Platform: "twitch", WorkflowChain: "wf-a"}

	event, err := newChatCommandEvent("hug", trigger, "wf-b", time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC), "evt-1")
	if err != nil {
		t.Fatalf("newChatCommandEvent: %v", err)
	}
	if event.Platform != "twitch" || event.Data["platform"] != "twitch" {
		t.Errorf("platform = %q / %v, want twitch on both", event.Platform, event.Data["platform"])
	}
	if event.WorkflowChain != "wf-a,wf-b" {
		t.Errorf("chain = %q, want wf-a,wf-b", event.WorkflowChain)
	}
}

func TestCheckPublishedHoldsChatCommandEventsToTheStreamContract(t *testing.T) {
	valid := `{"id":"e","type":"chat.command.hug","source":"workflow","time":"2026-11-22T12:00:00Z",` +
		`"data":{"command":"hug","args":[],"rawMessage":"!hug","text":"","variables":{},"chatter":"","platform":null}}`
	tests := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{"a complete event", valid, false},
		{"a field the contract does not list", strings.Replace(valid, `"chatter":""`, `"chatter":"","extra":1`, 1), true},
		{"a missing required field", strings.Replace(valid, `"text":"",`, "", 1), true},
		{"a platform the contract does not know", strings.Replace(valid, `"platform":null`, `"platform":"nowhere"`, 1), true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := checkPublished("chat.command.hug", []byte(tt.raw))
			if (err != nil) != tt.wantErr {
				t.Fatalf("checkPublished error = %v, want error: %v", err, tt.wantErr)
			}
		})
	}
}
