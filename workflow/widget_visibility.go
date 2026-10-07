package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

// sceneCommandSubject is answered by the scene manager, which holds every open
// overlay. Must match SCENE_COMMAND_SUBJECT in
// shared/common/typescript/cloudevents/Scene/commands.ts.
const sceneCommandSubject = "engine.scene.command"

// sceneCommandTimeout bounds the wait for the scene manager's answer. The
// change is one op on a scene it holds in memory (saved a moment later), so a
// slow answer means the scene manager is not there, not that it is busy.
const sceneCommandTimeout = 5 * time.Second

// placementVisibilityCommand is the `data` of an `engine.scene.command`
// request. Mirrors SceneControlCommand in
// shared/common/typescript/cloudevents/Scene/commands.ts.
type placementVisibilityCommand struct {
	Command     string `json:"command"`
	SceneID     string `json:"sceneId"`
	PlacementID string `json:"placementId"`
	Visible     bool   `json:"visible"`
}

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
			"sceneId":     command.SceneID,
			"placementId": command.PlacementID,
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
		return fmt.Sprintf("would %s widget placement %s on scene %s", verb, command.PlacementID, command.SceneID), nil
	},
}

// parseWidgetVisibilityParams reads the step's parameters. `visible` defaults
// to true and accepts "true" and "false", since a value filled in from an
// expression reaches the action as text.
func parseWidgetVisibilityParams(params map[string]any) (placementVisibilityCommand, error) {
	sceneID, _ := params["sceneId"].(string)
	if sceneID == "" {
		return placementVisibilityCommand{}, fmt.Errorf("sceneId must be a scene id, got %s", describeParam(params["sceneId"]))
	}
	placementID, _ := params["placementId"].(string)
	if placementID == "" {
		return placementVisibilityCommand{}, fmt.Errorf("placementId must be a widget placement id, got %s", describeParam(params["placementId"]))
	}
	visible, err := parseVisibleParam(params["visible"])
	if err != nil {
		return placementVisibilityCommand{}, err
	}
	return placementVisibilityCommand{
		Command:     "set_placement_visibility",
		SceneID:     sceneID,
		PlacementID: placementID,
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

func buildSceneCommandRequest(command placementVisibilityCommand) ([]byte, error) {
	payload, err := json.Marshal(map[string]any{
		"specversion": "1.0",
		"id":          uuid.NewString(),
		"type":        sceneCommandSubject,
		"source":      "workflow",
		"time":        time.Now().UTC().Format(time.RFC3339),
		"data":        command,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal %s: %w", sceneCommandSubject, err)
	}
	return payload, nil
}

// decodeSceneCommandReply turns the scene manager's answer into the step's
// outcome. Its error text is written for the streamer and becomes the step's
// error as it is.
func decodeSceneCommandReply(raw []byte) error {
	var reply struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(raw, &reply); err != nil {
		return fmt.Errorf("scene manager answered with something that is not a reply: %w", err)
	}
	if !reply.OK {
		if reply.Error == "" {
			return fmt.Errorf("scene manager refused the change without saying why")
		}
		return fmt.Errorf("%s", reply.Error)
	}
	return nil
}
