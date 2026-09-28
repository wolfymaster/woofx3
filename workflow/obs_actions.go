package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	cloudevents "github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

// obsCommandTimeout bounds how long an `obs.*` step waits for the scene
// manager. OBS answers a local WebSocket request in milliseconds; a reply
// that has not come back in this long is not coming, and the run should say
// so rather than hang on a step the streamer is waiting to see happen.
const obsCommandTimeout = 5 * time.Second

// obsRequester is the slice of the message bus an OBS action needs. The
// production value is the engine's NATS client; tests substitute a fake.
type obsRequester interface {
	Request(subject string, data []byte, timeout time.Duration) ([]byte, error)
}

// obsCommand is the `data` of an `engine.obs.command` CloudEvent. Must match
// ObsControlCommand in shared/common/typescript/cloudevents/Obs/commands.ts,
// which the scene manager validates against.
//
// The booleans are pointers so that `false` is sent rather than omitted: the
// scene manager refuses a visibility or mute command that does not say which
// way to set it.
type obsCommand struct {
	Command    string `json:"command"`
	SceneName  string `json:"sceneName,omitempty"`
	SourceName string `json:"sourceName,omitempty"`
	Visible    *bool  `json:"visible,omitempty"`
	InputName  string `json:"inputName,omitempty"`
	Muted      *bool  `json:"muted,omitempty"`
}

// obsCommandReply is what the scene manager answers with.
type obsCommandReply struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

// NewObsSwitchSceneAction is the engine handler registered as
// `obs.switch_scene`: make `sceneName` the program scene.
//
// Canonical id of the corresponding action declaration row:
// `woofx3:action:obs.switch_scene`.
func NewObsSwitchSceneAction() tasks.ActionFunc[AppServices] {
	return newObsAction(parseSwitchSceneParams, messageBusRequester)
}

// NewObsSetSourceVisibilityAction is the engine handler registered as
// `obs.set_source_visibility`: show or hide `sourceName` in `sceneName`, or in
// the current program scene when `sceneName` is blank.
//
// Canonical id of the corresponding action declaration row:
// `woofx3:action:obs.set_source_visibility`.
func NewObsSetSourceVisibilityAction() tasks.ActionFunc[AppServices] {
	return newObsAction(parseSetSourceVisibilityParams, messageBusRequester)
}

// NewObsSetInputMuteAction is the engine handler registered as
// `obs.set_input_mute`: mute or unmute the audio input `inputName`.
//
// Canonical id of the corresponding action declaration row:
// `woofx3:action:obs.set_input_mute`.
func NewObsSetInputMuteAction() tasks.ActionFunc[AppServices] {
	return newObsAction(parseSetInputMuteParams, messageBusRequester)
}

// messageBusRequester returns nil rather than a nil *natsclient.Client
// wrapped in the interface, which would compare non-nil and panic on use.
func messageBusRequester(services AppServices) obsRequester {
	bus := services.MessageBus()
	if bus == nil {
		return nil
	}
	return bus
}

// newObsAction builds an OBS action from its parameter parser.
//
// Request/reply rather than fire-and-forget, because the interesting failures
// all happen on the far side: OBS not running, a scene renamed since the
// workflow was saved, a source that is not in that scene. A published command
// would report success for every one of them. Waiting for the answer turns
// each into a failed step with the reason on it, which is what the run log
// and `onError` exist for.
//
// The subject is the engine's, never the step's: a workflow chooses what to
// ask OBS for, not where the request goes.
func newObsAction(
	parse func(map[string]any) (obsCommand, error),
	requester func(AppServices) obsRequester,
) tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		command, err := parse(params)
		if err != nil {
			return nil, err
		}

		bus := requester(ctx.Services)
		if bus == nil {
			return nil, fmt.Errorf("message bus not available")
		}

		payload, err := json.Marshal(map[string]any{
			"specversion":     "1.0",
			"id":              uuid.NewString(),
			"type":            string(cloudevents.SubjectObsCommand),
			"source":          "workflow",
			"time":            time.Now().UTC().Format(time.RFC3339),
			"datacontenttype": "application/json",
			"data":            command,
		})
		if err != nil {
			return nil, fmt.Errorf("marshal %s: %w", cloudevents.SubjectObsCommand, err)
		}

		raw, err := bus.Request(string(cloudevents.SubjectObsCommand), payload, obsCommandTimeout)
		if err != nil {
			return nil, describeObsRequestError(err)
		}

		var reply obsCommandReply
		if err := json.Unmarshal(raw, &reply); err != nil {
			return nil, fmt.Errorf("unreadable reply from the scene manager: %w", err)
		}
		if !reply.OK {
			if reply.Error == "" {
				return nil, fmt.Errorf("OBS %s failed without a reason", command.Command)
			}
			return nil, fmt.Errorf("OBS %s failed: %s", command.Command, reply.Error)
		}
		if ctx.Logger != nil {
			ctx.Logger.Info("OBS command applied", "task", ctx.TaskID, "command", command.Command)
		}
		return map[string]any{"ok": true}, nil
	}
}

// describeObsRequestError names the two failures a streamer can act on.
// Nobody answering means the scene manager is not running; a timeout means it
// is, but OBS did not answer it in time.
func describeObsRequestError(err error) error {
	if errors.Is(err, nats.ErrNoResponders) {
		return fmt.Errorf("no scene manager is running to reach OBS: %w", err)
	}
	if errors.Is(err, nats.ErrTimeout) {
		return fmt.Errorf("OBS did not answer within %s: %w", obsCommandTimeout, err)
	}
	return fmt.Errorf("request %s: %w", cloudevents.SubjectObsCommand, err)
}

func parseSwitchSceneParams(params map[string]any) (obsCommand, error) {
	sceneName, err := requiredStringParam(params, "sceneName")
	if err != nil {
		return obsCommand{}, err
	}
	return obsCommand{Command: "switch_scene", SceneName: sceneName}, nil
}

func parseSetSourceVisibilityParams(params map[string]any) (obsCommand, error) {
	sourceName, err := requiredStringParam(params, "sourceName")
	if err != nil {
		return obsCommand{}, err
	}
	sceneName, err := optionalStringParam(params, "sceneName")
	if err != nil {
		return obsCommand{}, err
	}
	visible, err := requiredBoolParam(params, "visible")
	if err != nil {
		return obsCommand{}, err
	}
	return obsCommand{
		Command:    "set_source_visibility",
		SceneName:  sceneName,
		SourceName: sourceName,
		Visible:    &visible,
	}, nil
}

func parseSetInputMuteParams(params map[string]any) (obsCommand, error) {
	inputName, err := requiredStringParam(params, "inputName")
	if err != nil {
		return obsCommand{}, err
	}
	muted, err := requiredBoolParam(params, "muted")
	if err != nil {
		return obsCommand{}, err
	}
	return obsCommand{Command: "set_input_mute", InputName: inputName, Muted: &muted}, nil
}

func requiredStringParam(params map[string]any, key string) (string, error) {
	value, ok := params[key].(string)
	if !ok || value == "" {
		return "", fmt.Errorf("%s must be a non-empty string, got %s", key, describeParam(params[key]))
	}
	return value, nil
}

func optionalStringParam(params map[string]any, key string) (string, error) {
	raw, present := params[key]
	if !present || raw == nil {
		return "", nil
	}
	value, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("%s must be a string, got %s", key, describeParam(raw))
	}
	return value, nil
}

// requiredBoolParam accepts the strings "true" and "false" as well as JSON
// booleans. A toggle can be stored either way, and a step that reads the value
// from an expression embedded in text resolves to a string.
func requiredBoolParam(params map[string]any, key string) (bool, error) {
	switch v := params[key].(type) {
	case bool:
		return v, nil
	case string:
		if v == "true" {
			return true, nil
		}
		if v == "false" {
			return false, nil
		}
	}
	return false, fmt.Errorf("%s must be true or false, got %s", key, describeParam(params[key]))
}
