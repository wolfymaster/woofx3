package scenewidgets

import (
	"encoding/json"
	"testing"
)

func opacities(t *testing.T, placements []any) []any {
	t.Helper()
	out := make([]any, 0, len(placements))
	for _, entry := range placements {
		out = append(out, entry.(map[string]any)["opacity"])
	}
	return out
}

func TestFractionPlacementsOpacityRewritesPercents(t *testing.T) {
	in := `[
		{"id": "a", "opacity": 100},
		{"id": "b", "opacity": 50},
		{"id": "c", "opacity": 250},
		{"id": "d", "opacity": 0.4},
		{"id": "e", "opacity": 1},
		{"id": "f", "opacity": 0},
		{"id": "g"}
	]`
	out, changed, err := FractionPlacementsOpacity(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !changed {
		t.Fatal("expected a change")
	}
	var got []any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("output is not JSON: %v", err)
	}
	want := []any{float64(1), 0.5, float64(1), 0.4, float64(1), float64(0), nil}
	for i, opacity := range opacities(t, got) {
		if opacity != want[i] {
			t.Errorf("placement %d: opacity %v, want %v", i, opacity, want[i])
		}
	}
	if _, ok := got[6].(map[string]any)["opacity"]; ok {
		t.Error("an absent opacity was added")
	}
}

func TestFractionPlacementsOpacityLeavesFractionsAlone(t *testing.T) {
	in := `[{"id": "a", "opacity": 1}, {"id": "b", "opacity": 0.25}, {"id": "c"}]`
	out, changed, err := FractionPlacementsOpacity(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if changed || out != in {
		t.Fatalf("expected no change, got %v %q", changed, out)
	}
}

func TestFractionPlacementsOpacityIsIdempotent(t *testing.T) {
	once, _, err := FractionPlacementsOpacity(`[{"id": "a", "opacity": 100}, {"id": "b", "opacity": 30}]`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	twice, changed, err := FractionPlacementsOpacity(once)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if changed || twice != once {
		t.Fatalf("a second pass changed %q into %q", once, twice)
	}
}

func TestFractionPlacementsOpacityKeepsOtherNumbersAsWritten(t *testing.T) {
	out, _, err := FractionPlacementsOpacity(`[{"id": "a", "opacity": 100, "seed": 9007199254740993}]`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := `[{"id":"a","opacity":1,"seed":9007199254740993}]`; out != want {
		t.Fatalf("got %s, want %s", out, want)
	}
}

func TestFractionPlacementsOpacityRejectsMalformedJSON(t *testing.T) {
	if _, _, err := FractionPlacementsOpacity(`{"not": "a list"}`); err == nil {
		t.Fatal("expected an error")
	}
}

func TestFractionStepsOpacityRewritesAlertLayouts(t *testing.T) {
	in := `[
		{"id": "s1", "type": "action", "action": "chat.reply", "parameters": {"message": "hi", "opacity": 100}},
		{"id": "s2", "type": "action", "action": "alert", "parameters": {
			"target": "default",
			"layout": {"width": 800, "height": 600, "widgets": [
				{"id": "w1", "opacity": 100},
				{"id": "w2", "opacity": 0.5},
				{"id": "w3"}
			]}
		}}
	]`
	out, changed, err := FractionStepsOpacity(in)
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
	if opacity := got[0]["parameters"].(map[string]any)["opacity"]; opacity != float64(100) {
		t.Errorf("a parameter outside a layout was rewritten: %v", opacity)
	}
	layout := got[1]["parameters"].(map[string]any)["layout"].(map[string]any)
	want := []any{float64(1), 0.5, nil}
	for i, opacity := range opacities(t, layout["widgets"].([]any)) {
		if opacity != want[i] {
			t.Errorf("layout widget %d: opacity %v, want %v", i, opacity, want[i])
		}
	}
	if layout["width"] != float64(800) {
		t.Errorf("layout width not kept: %v", layout["width"])
	}
}

func TestFractionStepsOpacityLeavesStepsWithoutLayoutsAlone(t *testing.T) {
	in := `[{"id": "s1", "action": "alert", "parameters": {"layout": {"widgets": [{"opacity": 1}]}}}]`
	out, changed, err := FractionStepsOpacity(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if changed || out != in {
		t.Fatalf("expected no change, got %v %q", changed, out)
	}
}

func TestFractionAlertPayloadOpacityRewritesTheEnvelopeLayout(t *testing.T) {
	in := `{"id": "e1", "parameters": {"layout": {"width": 1, "height": 1, "widgets": [{"id": "w", "opacity": 75}]}},
		"event": {"data": {"opacity": 100}}}`
	out, changed, err := FractionAlertPayloadOpacity(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !changed {
		t.Fatal("expected a change")
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("output is not JSON: %v", err)
	}
	widget := got["parameters"].(map[string]any)["layout"].(map[string]any)["widgets"].([]any)[0].(map[string]any)
	if widget["opacity"] != 0.75 {
		t.Errorf("layout widget opacity %v, want 0.75", widget["opacity"])
	}
	if data := got["event"].(map[string]any)["data"].(map[string]any); data["opacity"] != float64(100) {
		t.Errorf("the triggering event was rewritten: %v", data)
	}
}
