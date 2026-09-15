package scenewidgets

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestReplaceMediaAlertPlacementsRewritesEveryMediaAlert(t *testing.T) {
	in := `[
		{"id": "a", "widgetCanonicalId": "woofx3:widget:media_alert", "name": "Media Alert", "position": {"x": 1, "y": 2}, "size": {"width": 3, "height": 4}, "settings": {"textTemplate": "hi"}},
		{"id": "b", "widgetCanonicalId": "builtin:widget:media_alert"},
		{"id": "c", "widgetDefinitionRef": "woofx3:0.4.1:abc1234:widget:media_alert"},
		{"id": "d", "widgetCanonicalId": "counter:widget:counter", "settings": {"x": 1}}
	]`
	out, changed, err := ReplaceMediaAlertPlacements(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !changed {
		t.Fatal("expected a change")
	}
	var got []map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("output is not JSON: %v", err)
	}

	alert := map[string]any{"name": "default"}
	for _, placement := range got[:3] {
		if placement["widgetCanonicalId"] != alertWidgetCanonicalID {
			t.Errorf("%v: not rewritten to the alert widget", placement["id"])
		}
		if !reflect.DeepEqual(placement["settings"], alert) {
			t.Errorf("%v: settings %v", placement["id"], placement["settings"])
		}
		if _, ok := placement["widgetDefinitionRef"]; ok {
			t.Errorf("%v: kept the legacy widgetDefinitionRef", placement["id"])
		}
	}
	if !reflect.DeepEqual(got[0]["position"], map[string]any{"x": float64(1), "y": float64(2)}) {
		t.Errorf("position not kept: %v", got[0]["position"])
	}
	if got[3]["widgetCanonicalId"] != "counter:widget:counter" {
		t.Errorf("an unrelated widget was rewritten: %v", got[3])
	}
}

func TestReplaceMediaAlertPlacementsLeavesOtherScenesAlone(t *testing.T) {
	in := `[{"id": "d", "widgetCanonicalId": "other:widget:media_alert"}]`
	out, changed, err := ReplaceMediaAlertPlacements(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if changed || out != in {
		t.Fatalf("expected no change, got %v %q", changed, out)
	}
}

func TestReplaceMediaAlertPlacementsRejectsMalformedJSON(t *testing.T) {
	if _, _, err := ReplaceMediaAlertPlacements(`{"not": "a list"}`); err == nil {
		t.Fatal("expected an error")
	}
}
