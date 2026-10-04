package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseWidgetVisibilityParams_ReadsTheStep(t *testing.T) {
	command, err := parseWidgetVisibilityParams(map[string]any{"sceneId": "scene-1", "placementId": "board-1", "visible": false})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := placementVisibilityCommand{Command: "set_placement_visibility", SceneID: "scene-1", PlacementID: "board-1", Visible: false}
	if command != want {
		t.Fatalf("got %+v, want %+v", command, want)
	}
}

func TestParseWidgetVisibilityParams_VisibleDefaultsToShowAndAcceptsText(t *testing.T) {
	cases := map[string]struct {
		value any
		want  bool
	}{
		"absent":        {nil, true},
		"empty text":    {"", true},
		"text true":     {"true", true},
		"text false":    {"false", false},
		"boolean true":  {true, true},
		"boolean false": {false, false},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			params := map[string]any{"sceneId": "scene-1", "placementId": "board-1"}
			if tc.value != nil {
				params["visible"] = tc.value
			}
			command, err := parseWidgetVisibilityParams(params)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if command.Visible != tc.want {
				t.Fatalf("visible = %v, want %v", command.Visible, tc.want)
			}
		})
	}
}

func TestParseWidgetVisibilityParams_RefusesAStepItCannotCarryOut(t *testing.T) {
	cases := map[string]map[string]any{
		"no scene":                {"placementId": "board-1"},
		"no placement":            {"sceneId": "scene-1"},
		"placement not text":      {"sceneId": "scene-1", "placementId": 7.0},
		"visible not a yes or no": {"sceneId": "scene-1", "placementId": "board-1", "visible": "maybe"},
	}
	for name, params := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := parseWidgetVisibilityParams(params); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestBuildSceneCommandRequest_CarriesTheCommandAsCloudEventData(t *testing.T) {
	command := placementVisibilityCommand{Command: "set_placement_visibility", SceneID: "scene-1", PlacementID: "board-1", Visible: true}
	raw, err := buildSceneCommandRequest(command)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var envelope struct {
		Type string         `json:"type"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatalf("not JSON: %v", err)
	}
	if envelope.Type != sceneCommandSubject {
		t.Fatalf("type = %q, want %q", envelope.Type, sceneCommandSubject)
	}
	want := map[string]any{"command": "set_placement_visibility", "sceneId": "scene-1", "placementId": "board-1", "visible": true}
	for key, value := range want {
		if envelope.Data[key] != value {
			t.Fatalf("data.%s = %v, want %v", key, envelope.Data[key], value)
		}
	}
}

func TestDecodeSceneCommandReply(t *testing.T) {
	if err := decodeSceneCommandReply([]byte(`{"ok":true}`)); err != nil {
		t.Fatalf("ok reply: unexpected error %v", err)
	}
	err := decodeSceneCommandReply([]byte(`{"ok":false,"error":"widget placement \"board-1\" is not on scene \"Main\""}`))
	if err == nil || err.Error() != `widget placement "board-1" is not on scene "Main"` {
		t.Fatalf("refusal: got %v, want the scene manager's reason as is", err)
	}
	if err := decodeSceneCommandReply([]byte(`{"ok":false}`)); err == nil {
		t.Fatal("refusal without a reason: expected an error")
	}
	if err := decodeSceneCommandReply([]byte(`not json`)); err == nil {
		t.Fatal("garbage: expected an error")
	}
}

func TestWidgetVisibilityDryRun_SaysWhatItWouldDo(t *testing.T) {
	summary, err := widgetVisibilityActionSpec.DryRun(map[string]any{"sceneId": "scene-1", "placementId": "board-1", "visible": "false"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(summary, "hide") || !strings.Contains(summary, "board-1") {
		t.Fatalf("summary %q does not say it would hide board-1", summary)
	}
	if _, err := widgetVisibilityActionSpec.DryRun(map[string]any{"sceneId": "scene-1"}); err == nil {
		t.Fatal("dry run of a step with no placement: expected an error")
	}
}
