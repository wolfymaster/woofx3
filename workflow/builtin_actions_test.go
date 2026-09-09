package main

import (
	"slices"
	"testing"
)

// The UI resolves the alert-rendering action by querying the catalog for
// the `alert.renderer` axis. If no action carries it the alert screen has
// nothing to bind to; if more than one does, the choice is ambiguous.
func TestBuiltinActionsDeclareExactlyOneAlertRenderer(t *testing.T) {
	var renderers []string
	for _, a := range builtinActionInputs() {
		if slices.Contains(a.Taxonomy, "alert.renderer") {
			renderers = append(renderers, a.ManifestId)
		}
	}
	if len(renderers) != 1 {
		t.Fatalf("want exactly one action tagged alert.renderer, got %v", renderers)
	}
	if renderers[0] != "alert" {
		t.Errorf("alert.renderer on %q, want it on the alert action", renderers[0])
	}
}

func TestBuiltinActionsCarrySystemWorkflowAxis(t *testing.T) {
	for _, a := range builtinActionInputs() {
		if !slices.Contains(a.Taxonomy, "system.workflow") {
			t.Errorf("action %q taxonomy %v is missing the system.workflow axis", a.ManifestId, a.Taxonomy)
		}
	}
}

// Type is the engine dispatch for a built-in; Call stays empty because
// the handler itself resolves the target.
func TestBuiltinActionsDispatchByTypeWithEmptyCall(t *testing.T) {
	want := map[string]string{"function": "function", "alert": "alert", "print": "print"}
	got := make(map[string]string)
	for _, a := range builtinActionInputs() {
		if a.Call != "" {
			t.Errorf("action %q has Call %q, want empty", a.ManifestId, a.Call)
		}
		got[a.ManifestId] = a.Type
	}
	for id, typ := range want {
		if got[id] != typ {
			t.Errorf("action %q dispatches to type %q, want %q", id, got[id], typ)
		}
	}
	if len(got) != len(want) {
		t.Errorf("built-in action set is %v, want exactly %v", got, want)
	}
}
