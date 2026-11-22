package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/common/messages"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

// sceneCommandSubject is answered by the scene manager, which holds every open
// overlay. It is the `type` the scene contract fixes for the request.
const sceneCommandSubject = string(messages.SceneCommandRequestTypeEngineSceneCommand)

// sceneCommandSource is the `source` of the requests this engine publishes.
const sceneCommandSource = "workflow"

// sceneCommandTimeout bounds the wait for the scene manager's answer. The
// change is one op on a scene it holds in memory (saved a moment later), so a
// slow answer means the scene manager is not there, not that it is busy.
const sceneCommandTimeout = 5 * time.Second

// NewWidgetVisibilityAction is the engine handler registered as
// `scene.widget.visibility`. It shows or hides one widget placement on a
// scene's published version, by asking the scene manager and waiting for its
// answer; every open overlay and editor of the scene follows.
//
// Request/reply rather than fire-and-forget like `alert`: a step naming a
// placement that has since been deleted from its scene fails with that
// reason in the run log, instead of reporting success for a change nobody
// could see.
//
// The change is saved with the scene and copied into its draft, so it
// lasts until a step or the editor changes it again.
//
// Canonical id of the corresponding action declaration row:
// `woofx3:action:scene.widget.visibility`.
func NewWidgetVisibilityAction() tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		command, err := parseWidgetVisibilityParams(params)
		if err != nil {
			return nil, err
		}
		bus := ctx.Services.MessageBus()
		if bus == nil {
			return nil, fmt.Errorf("message bus not available")
		}
		request, err := buildSceneCommandRequest(command)
		if err != nil {
			return nil, err
		}
		raw, err := bus.Request(sceneCommandSubject, request, sceneCommandTimeout)
		if err != nil {
			return nil, fmt.Errorf("scene manager did not answer: %w", err)
		}
		if err := decodeSceneCommandReply(raw); err != nil {
			return nil, err
		}
		return map[string]any{
			"sceneId":     command.SceneId,
			"placementId": command.PlacementId,
			"visible":     command.Visible,
		}, nil
	}
}

// widgetVisibilityActionSpec checks the step as the real action would, so a
// dry run fails on the same missing parameter a real run would. Whether the
// placement still exists is only known to the scene manager, which a dry run
// does not ask.
var widgetVisibilityActionSpec = tasks.ActionSpec{
	SideEffect: true,
	DryRun: func(params map[string]any) (string, error) {
		command, err := parseWidgetVisibilityParams(params)
		if err != nil {
			return "", err
		}
		verb := "hide"
		if command.Visible {
			verb = "show"
		}
		return fmt.Sprintf("would %s widget placement %s on scene %s", verb, command.PlacementId, command.SceneId), nil
	},
}

// parseWidgetVisibilityParams reads the step's parameters. `visible` defaults
// to true and accepts "true" and "false", since a value filled in from an
// expression reaches the action as text.
func parseWidgetVisibilityParams(params map[string]any) (messages.SceneCommand, error) {
	sceneID, _ := params["sceneId"].(string)
	if sceneID == "" {
		return messages.SceneCommand{}, fmt.Errorf("sceneId must be a scene id, got %s", describeParam(params["sceneId"]))
	}
	placementID, _ := params["placementId"].(string)
	if placementID == "" {
		return messages.SceneCommand{}, fmt.Errorf("placementId must be a widget placement id, got %s", describeParam(params["placementId"]))
	}
	visible, err := parseVisibleParam(params["visible"])
	if err != nil {
		return messages.SceneCommand{}, err
	}
	return messages.SceneCommand{
		Command:     messages.SceneCommandCommandSetPlacementVisibility,
		SceneId:     messages.EntityId(sceneID),
		PlacementId: messages.EntityId(placementID),
		Visible:     visible,
	}, nil
}

func parseVisibleParam(value any) (bool, error) {
	switch v := value.(type) {
	case nil:
		return true, nil
	case bool:
		return v, nil
	case string:
		switch v {
		case "", "true":
			return true, nil
		case "false":
			return false, nil
		}
	}
	return false, fmt.Errorf("visible must be true or false, got %s", describeParam(value))
}

// buildSceneCommandRequest serializes the command as the CloudEvent the scene
// contract describes, refusing to produce one the scene manager would reject.
func buildSceneCommandRequest(command messages.SceneCommand) ([]byte, error) {
	request := messages.SceneCommandRequest{
		Specversion: messages.EventSpecVersion100,
		ID:          messages.EventId(uuid.NewString()),
		Type:        messages.SceneCommandRequestTypeEngineSceneCommand,
		Source:      sceneCommandSource,
		Time:        messages.EventTime(time.Now().UTC().Format(time.RFC3339)),
		Data:        command,
	}
	if err := request.Validate(); err != nil {
		return nil, fmt.Errorf("invalid %s request: %w", sceneCommandSubject, err)
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("marshal %s: %w", sceneCommandSubject, err)
	}
	return payload, nil
}

// decodeSceneCommandReply turns the scene manager's answer into the step's
// outcome. Its error text is written for the streamer and becomes the step's
// error as it is.
func decodeSceneCommandReply(raw []byte) error {
	var reply messages.SceneCommandReply
	if err := json.Unmarshal(raw, &reply); err != nil {
		return fmt.Errorf("scene manager answered with something that is not a reply: %w", err)
	}
	if err := reply.Validate(); err != nil {
		return fmt.Errorf("scene manager answered with something that is not a reply: %w", err)
	}
	if reply.Type == messages.SceneCommandFailedSceneCommandReply {
		return fmt.Errorf("%s", reply.SceneCommandFailed.Error)
	}
	return nil
}
