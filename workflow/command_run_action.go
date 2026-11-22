package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/messages/stream"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// commandRunner starts the workflow a command is linked to. The engine is its
// only production implementation; the seam is there because a unit test cannot
// run the engine's workflows.
//
// stylegate:ignore ANY-ABS-003 reason="a test seam over the engine, which needs a message bus and a db proxy to run"
type commandRunner interface {
	RunCommand(run engine.CommandRun) (engine.CommandRunOutcome, string, error)
}

// commandAnnouncer announces an invocation on its `chat.command.<slug>` subject.
//
// stylegate:ignore ANY-ABS-003 reason="a test seam over the NATS publisher, which needs a running message bus"
type commandAnnouncer interface {
	Publish(event *types.Event) error
}

// NewCommandRunAction is the engine handler registered as `command.run`, the
// "Run command" action: it runs a chat command's steps as though someone had
// typed it, with no arguments, so a schedule or another workflow can use a
// command as a reusable set of steps.
//
// The run is not checked against who may use the command. Chat and the
// dashboard check that, because someone is asking; here the streamer who wrote
// the step is. The command must still exist and be enabled. Like a run from the
// dashboard it ignores the cooldown, and it announces `chat.command.<slug>` after
// the steps have started so workflows listening for the command run too.
//
// Canonical id of the corresponding action declaration row:
// `woofx3:action:command.run`.
func NewCommandRunAction(runner commandRunner, announcer commandAnnouncer, clock func() time.Time, newID func() string) tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		name, err := commandNameParam(params)
		if err != nil {
			return nil, err
		}
		slug, err := commandSubjectSegment(name)
		if err != nil {
			return nil, err
		}
		commandCtx := ctx.Context
		if commandCtx == nil {
			commandCtx = context.Background()
		}
		workflowID, err := findRunnableCommand(commandCtx, ctx.Services.Commands(), name)
		if err != nil {
			return nil, err
		}

		event, err := newChatCommandEvent(slug, ctx.TriggerEvent, ctx.WorkflowID, clock(), newID())
		if err != nil {
			return nil, fmt.Errorf("building the event of command %q: %w", name, err)
		}

		outcome, executionID, err := runner.RunCommand(engine.CommandRun{WorkflowID: workflowID, Event: event})
		if err != nil {
			return nil, fmt.Errorf("running command %q: %w", name, err)
		}
		if outcome == engine.CommandRunStarted {
			if err := announcer.Publish(event); err != nil {
				return nil, fmt.Errorf("command %q ran its steps, but announcing it failed, so workflows listening for it did not run: %w", name, err)
			}
		}
		// stylegate:ignore GO-ABS-002 reason="tasks.ActionFunc returns a map: its keys are what later steps read as exports"
		return map[string]any{
			"started":     outcome == engine.CommandRunStarted,
			"executionId": executionID,
		}, nil
	}
}

func commandNameParam(params map[string]any) (string, error) {
	name, ok := params["command"].(string)
	name = strings.TrimSpace(name)
	if !ok || name == "" {
		return "", fmt.Errorf("command parameter is required")
	}
	return name, nil
}

// findRunnableCommand returns the workflow of the enabled command called name.
// It lists commands rather than getting one by name because getting one asks
// for the user running it, which this action has none of.
func findRunnableCommand(ctx context.Context, commands dbv1.CommandService, name string) (string, error) {
	if commands == nil {
		return "", fmt.Errorf("command.run needs the db proxy, which this engine is running without")
	}
	list, err := commands.ListCommands(ctx, &dbv1.ListCommandsRequest{IncludeDisabled: true})
	if err != nil {
		return "", fmt.Errorf("listing commands: %w", err)
	}
	bare := strings.TrimPrefix(name, "!")
	for _, command := range list.GetCommands() {
		if !strings.EqualFold(command.GetCommand(), bare) {
			continue
		}
		if !command.GetEnabled() {
			return "", fmt.Errorf("command %q is disabled", name)
		}
		if command.GetWorkflowId() == "" {
			return "", fmt.Errorf("command %q has no steps to run", name)
		}
		return command.GetWorkflowId(), nil
	}
	return "", fmt.Errorf("command %q does not exist", name)
}

func triggerPlatform(trigger *types.Event) string {
	if trigger == nil {
		return ""
	}
	return trigger.Platform
}

// commandEventSubjectPrefix is what a command's subject segment follows; the
// contract's `type` pattern in shared/contracts/stream/openapi.yaml spells it too.
const commandEventSubjectPrefix = "chat.command."

// newChatCommandEvent is one invocation of command `slug` with no chatter,
// text or arguments, as the stream contract's ChatCommandEvent describes it.
// The payload is built from the contract's generated type, so a field it
// renames stops this compiling, and the whole event is checked against the
// contract before anything runs.
func newChatCommandEvent(slug string, trigger *types.Event, workflowID string, at time.Time, id string) (*types.Event, error) {
	data := stream.ChatCommand{
		Command:    slug,
		Args:       []string{},
		RawMessage: "!" + slug,
		Variables:  stream.ChatCommandVariables{},
	}
	platform := triggerPlatform(trigger)
	if platform == "" {
		data.Platform.SetToNull()
	} else {
		data.Platform.SetTo(stream.ChatCommandPlatform(platform))
	}
	raw, err := json.Marshal(&data)
	if err != nil {
		return nil, fmt.Errorf("encoding the payload: %w", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("reading the payload back: %w", err)
	}

	event := &types.Event{
		ID:          id,
		Type:        commandEventSubjectPrefix + slug,
		Source:      "workflow",
		Time:        at,
		Platform:    platform,
		TriggeredBy: "workflow",
		Data:        payload,
	}
	if trigger != nil {
		event.WorkflowChain = trigger.ChainThrough(workflowID)
	}
	wire, err := json.Marshal(event)
	if err != nil {
		return nil, fmt.Errorf("encoding the event: %w", err)
	}
	if err := checkPublished(event.Type, wire); err != nil {
		return nil, err
	}
	return event, nil
}

// commandSubjectSegment is a command name as the segment of its
// chat.command.<slug> subject: no leading "!", lowercased. Must match
// commandSubjectSegment in db/app/services/command_workflow.go.
func commandSubjectSegment(name string) (string, error) {
	stripped := strings.TrimPrefix(name, "!")
	if stripped == "" {
		return "", fmt.Errorf("invalid command name: empty after stripping \"!\"")
	}
	if strings.ContainsAny(stripped, ".*>") || strings.ContainsAny(stripped, " \t\n\r\f\v") {
		return "", fmt.Errorf("invalid command name %q: a subject segment may not contain \".\" \"*\" \">\" or whitespace", name)
	}
	return strings.ToLower(stripped), nil
}

// commandRunActionSpec checks the step as the real action would. A dry run
// does not run the command: its steps have side effects of their own. A name
// that is an expression is only known when the step runs.
var commandRunActionSpec = tasks.ActionSpec{
	SideEffect: true,
	Validate: func(params map[string]any) error {
		name, err := commandNameParam(params)
		if err != nil {
			return err
		}
		if strings.Contains(name, "${") {
			return nil
		}
		_, err = commandSubjectSegment(name)
		return err
	},
	DryRun: func(params map[string]any) (string, error) {
		name, err := commandNameParam(params)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("would run command %s", name), nil
	},
}
