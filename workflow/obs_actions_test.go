package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

type fakeObsBus struct {
	subject string
	payload []byte
	timeout time.Duration
	calls   int
	reply   []byte
	err     error
}

func (f *fakeObsBus) Request(subject string, data []byte, timeout time.Duration) ([]byte, error) {
	f.calls++
	f.subject = subject
	f.payload = data
	f.timeout = timeout
	return f.reply, f.err
}

func runObsAction(
	t *testing.T,
	parse func(map[string]any) (obsCommand, error),
	bus *fakeObsBus,
	params map[string]any,
) (map[string]any, error) {
	t.Helper()
	action := newObsAction(parse, func(AppServices) obsRequester { return bus })
	return action(tasks.ActionContext[AppServices]{TaskID: "t1"}, params)
}

// sentCommand decodes the `data` of the CloudEvent the action sent.
func sentCommand(t *testing.T, bus *fakeObsBus) (map[string]any, map[string]any) {
	t.Helper()
	var envelope map[string]any
	if err := json.Unmarshal(bus.payload, &envelope); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	data, ok := envelope["data"].(map[string]any)
	if !ok {
		t.Fatalf("envelope data = %v, want an object", envelope["data"])
	}
	return envelope, data
}

func TestObsSwitchScene_RequestsTheSceneAndExportsOK(t *testing.T) {
	bus := &fakeObsBus{reply: []byte(`{"ok":true}`)}

	result, err := runObsAction(t, parseSwitchSceneParams, bus, map[string]any{"sceneName": "Raid"})
	if err != nil {
		t.Fatalf("action: %v", err)
	}
	if result["ok"] != true {
		t.Errorf("result = %v, want ok true", result)
	}
	if bus.subject != "engine.obs.command" {
		t.Errorf("subject = %q, want engine.obs.command", bus.subject)
	}
	if bus.timeout != obsCommandTimeout {
		t.Errorf("timeout = %v, want %v", bus.timeout, obsCommandTimeout)
	}
	envelope, data := sentCommand(t, bus)
	if envelope["type"] != "engine.obs.command" || envelope["specversion"] != "1.0" || envelope["id"] == "" {
		t.Errorf("envelope = %v, want a CloudEvent of type engine.obs.command", envelope)
	}
	if data["command"] != "switch_scene" || data["sceneName"] != "Raid" {
		t.Errorf("data = %v", data)
	}
}

func TestObsSwitchScene_RefusesAMissingSceneWithoutRequesting(t *testing.T) {
	bus := &fakeObsBus{reply: []byte(`{"ok":true}`)}

	_, err := runObsAction(t, parseSwitchSceneParams, bus, map[string]any{"sceneName": ""})
	if err == nil || !strings.Contains(err.Error(), "sceneName") {
		t.Fatalf("err = %v, want a sceneName error", err)
	}
	if bus.calls != 0 {
		t.Errorf("requested %d times, want 0", bus.calls)
	}
}

func TestObsSetSourceVisibility_SendsFalseRatherThanOmittingIt(t *testing.T) {
	bus := &fakeObsBus{reply: []byte(`{"ok":true}`)}

	_, err := runObsAction(t, parseSetSourceVisibilityParams, bus, map[string]any{
		"sourceName": "Confetti",
		"visible":    false,
	})
	if err != nil {
		t.Fatalf("action: %v", err)
	}
	_, data := sentCommand(t, bus)
	if data["command"] != "set_source_visibility" || data["sourceName"] != "Confetti" {
		t.Errorf("data = %v", data)
	}
	visible, present := data["visible"]
	if !present || visible != false {
		t.Errorf("visible = %v (present %v), want false", visible, present)
	}
	if _, present := data["sceneName"]; present {
		t.Errorf("sceneName sent although blank: %v", data)
	}
}

func TestObsSetSourceVisibility_AcceptsAToggleStoredAsAString(t *testing.T) {
	bus := &fakeObsBus{reply: []byte(`{"ok":true}`)}

	_, err := runObsAction(t, parseSetSourceVisibilityParams, bus, map[string]any{
		"sceneName":  "Main",
		"sourceName": "Confetti",
		"visible":    "true",
	})
	if err != nil {
		t.Fatalf("action: %v", err)
	}
	_, data := sentCommand(t, bus)
	if data["visible"] != true || data["sceneName"] != "Main" {
		t.Errorf("data = %v", data)
	}
}

func TestObsSetSourceVisibility_RefusesAnUnreadableVisible(t *testing.T) {
	for _, visible := range []any{"yes", 1.0} {
		bus := &fakeObsBus{reply: []byte(`{"ok":true}`)}
		_, err := runObsAction(t, parseSetSourceVisibilityParams, bus, map[string]any{
			"sourceName": "Confetti",
			"visible":    visible,
		})
		if err == nil || !strings.Contains(err.Error(), "visible must be true or false") {
			t.Errorf("visible %v: err = %v, want a visible error", visible, err)
		}
		if bus.calls != 0 {
			t.Errorf("visible %v: requested although invalid", visible)
		}
	}
}

func TestObsSetInputMute_SendsTheInputAndState(t *testing.T) {
	bus := &fakeObsBus{reply: []byte(`{"ok":true}`)}

	_, err := runObsAction(t, parseSetInputMuteParams, bus, map[string]any{"inputName": "Mic/Aux", "muted": true})
	if err != nil {
		t.Fatalf("action: %v", err)
	}
	_, data := sentCommand(t, bus)
	if data["command"] != "set_input_mute" || data["inputName"] != "Mic/Aux" || data["muted"] != true {
		t.Errorf("data = %v", data)
	}
}

func TestObsAction_FailsWithTheSceneManagersReason(t *testing.T) {
	bus := &fakeObsBus{reply: []byte(`{"ok":false,"error":"scene \"Raid\" does not exist in OBS"}`)}

	_, err := runObsAction(t, parseSwitchSceneParams, bus, map[string]any{"sceneName": "Raid"})
	if err == nil || !strings.Contains(err.Error(), `scene "Raid" does not exist in OBS`) {
		t.Fatalf("err = %v, want the reply's reason", err)
	}
}

func TestObsAction_NamesAMissingSceneManager(t *testing.T) {
	bus := &fakeObsBus{err: fmt.Errorf("failed to send request: %w", nats.ErrNoResponders)}

	_, err := runObsAction(t, parseSwitchSceneParams, bus, map[string]any{"sceneName": "Raid"})
	if err == nil || !strings.Contains(err.Error(), "no scene manager is running") {
		t.Fatalf("err = %v, want a no-responders explanation", err)
	}
	if !errors.Is(err, nats.ErrNoResponders) {
		t.Errorf("err does not wrap ErrNoResponders: %v", err)
	}
}

func TestObsAction_NamesATimeout(t *testing.T) {
	bus := &fakeObsBus{err: fmt.Errorf("failed to send request: %w", nats.ErrTimeout)}

	_, err := runObsAction(t, parseSwitchSceneParams, bus, map[string]any{"sceneName": "Raid"})
	if err == nil || !strings.Contains(err.Error(), "did not answer within") {
		t.Fatalf("err = %v, want a timeout explanation", err)
	}
}

func TestObsAction_FailsWithoutAMessageBus(t *testing.T) {
	action := newObsAction(parseSwitchSceneParams, func(AppServices) obsRequester { return nil })

	_, err := action(tasks.ActionContext[AppServices]{}, map[string]any{"sceneName": "Raid"})
	if err == nil || !strings.Contains(err.Error(), "message bus not available") {
		t.Fatalf("err = %v, want a missing bus error", err)
	}
}

func TestObsAction_RefusesAnUnreadableReply(t *testing.T) {
	bus := &fakeObsBus{reply: []byte(`not json`)}

	_, err := runObsAction(t, parseSwitchSceneParams, bus, map[string]any{"sceneName": "Raid"})
	if err == nil || !strings.Contains(err.Error(), "unreadable reply") {
		t.Fatalf("err = %v, want an unreadable reply error", err)
	}
}

func TestMessageBusRequester_IsNilWithoutABus(t *testing.T) {
	if messageBusRequester(AppServices{}) != nil {
		t.Fatal("want a nil requester for a nil message bus")
	}
}

func TestObsSetSourceVisibility_DefaultsToShowingWhenVisibleIsAbsent(t *testing.T) {
	bus := &fakeObsBus{reply: []byte(`{"ok":true}`)}

	_, err := runObsAction(t, parseSetSourceVisibilityParams, bus, map[string]any{"sourceName": "Confetti"})
	if err != nil {
		t.Fatalf("action: %v", err)
	}
	_, data := sentCommand(t, bus)
	if data["visible"] != true {
		t.Errorf("visible = %v, want the default true", data["visible"])
	}
}

func TestObsSetInputMute_DefaultsToMutingWhenMutedIsAbsent(t *testing.T) {
	bus := &fakeObsBus{reply: []byte(`{"ok":true}`)}

	_, err := runObsAction(t, parseSetInputMuteParams, bus, map[string]any{"inputName": "Mic/Aux"})
	if err != nil {
		t.Fatalf("action: %v", err)
	}
	_, data := sentCommand(t, bus)
	if data["muted"] != true {
		t.Errorf("muted = %v, want the default true", data["muted"])
	}
}

func obsValidator(t *testing.T, name string) func(map[string]any) error {
	t.Helper()
	for _, action := range obsActions() {
		if action.name == name {
			return action.validate
		}
	}
	t.Fatalf("no obs action %q", name)
	return nil
}

func TestObsActions_AreTheThreeDeclaredInTheManifest(t *testing.T) {
	var names []string
	for _, action := range obsActions() {
		names = append(names, action.name)
	}
	want := "obs.switch_scene,obs.set_source_visibility,obs.set_input_mute"
	if strings.Join(names, ",") != want {
		t.Errorf("actions = %v, want %s", names, want)
	}
}

func TestObsValidators_AcceptStoredStepsIncludingExpressions(t *testing.T) {
	cases := []struct {
		action string
		params map[string]any
	}{
		{"obs.switch_scene", map[string]any{"sceneName": "${trigger.data.scene}"}},
		{"obs.set_source_visibility", map[string]any{"sourceName": "Confetti"}},
		{"obs.set_source_visibility", map[string]any{"sourceName": "Confetti", "visible": "${trigger.data.show}"}},
		{"obs.set_source_visibility", map[string]any{"sourceName": "Confetti", "sceneName": "Main", "visible": false}},
		{"obs.set_input_mute", map[string]any{"inputName": "Mic/Aux", "muted": "false"}},
	}
	for _, c := range cases {
		if err := obsValidator(t, c.action)(c.params); err != nil {
			t.Errorf("%s %v: %v", c.action, c.params, err)
		}
	}
}

func TestObsValidators_RefuseMissingOrMistypedParameters(t *testing.T) {
	cases := []struct {
		action string
		params map[string]any
		want   string
	}{
		{"obs.switch_scene", map[string]any{}, "sceneName"},
		{"obs.set_source_visibility", map[string]any{"visible": true}, "sourceName"},
		{"obs.set_source_visibility", map[string]any{"sourceName": "Confetti", "visible": "yes"}, "visible"},
		{"obs.set_source_visibility", map[string]any{"sourceName": "Confetti", "sceneName": 3.0}, "sceneName"},
		{"obs.set_input_mute", map[string]any{"muted": true}, "inputName"},
	}
	for _, c := range cases {
		err := obsValidator(t, c.action)(c.params)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s %v: err = %v, want one naming %s", c.action, c.params, err, c.want)
		}
	}
}
