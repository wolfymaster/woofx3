package resource_reference

import (
	"testing"

	"github.com/google/uuid"
)

// newSrc returns a WorkflowSource with stable identity for tests.
func newSrc() WorkflowSource {
	return WorkflowSource{
		ID:                  uuid.New(),
		Name:                "wf",
		ApplicationID:       nil,
		SourceCreatedByType: "USER",
		SourceCreatedByRef:  "",
	}
}

func TestExtractWorkflowEdges_TriggerRefProducesTriggerEdge(t *testing.T) {
	steps := `[]`
	trigger := `{"$ref": "twitch_platform:trigger:channel_cheer", "type": "event", "eventType": "cheer.user.twitch"}`

	edges := ExtractWorkflowEdges(newSrc(), steps, trigger)

	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d: %+v", len(edges), edges)
	}
	if edges[0].TargetType != TargetTypeTrigger {
		t.Errorf("TargetType = %q, want %q", edges[0].TargetType, TargetTypeTrigger)
	}
	if edges[0].TargetName != "twitch_platform:trigger:channel_cheer" {
		t.Errorf("TargetName = %q, want canonical id", edges[0].TargetName)
	}
	if edges[0].Context != "trigger" {
		t.Errorf("Context = %q, want %q", edges[0].Context, "trigger")
	}
}

func TestExtractWorkflowEdges_TriggerWithoutRefProducesNoEdge(t *testing.T) {
	cases := []struct {
		name    string
		trigger string
	}{
		{"empty string", ""},
		{"empty object", "{}"},
		{"object without $ref", `{"type": "event", "eventType": "cheer.user.twitch"}`},
		{"empty $ref", `{"$ref": ""}`},
		{"malformed JSON", `{"this is not json`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			edges := ExtractWorkflowEdges(newSrc(), "[]", tc.trigger)
			if len(edges) != 0 {
				t.Errorf("expected 0 edges, got %d: %+v", len(edges), edges)
			}
		})
	}
}

func TestExtractWorkflowEdges_StepRefProducesEdgeWithKindFromCanonicalID(t *testing.T) {
	steps := `[
		{"id": "s1", "$ref": "twitch_platform:action:play_alert", "parameters": {}}
	]`

	edges := ExtractWorkflowEdges(newSrc(), steps, "{}")

	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d: %+v", len(edges), edges)
	}
	if edges[0].TargetType != TargetTypeAction {
		t.Errorf("TargetType = %q, want %q", edges[0].TargetType, TargetTypeAction)
	}
	if edges[0].TargetName != "twitch_platform:action:play_alert" {
		t.Errorf("TargetName = %q, want canonical id", edges[0].TargetName)
	}
	if edges[0].Context != "step[0]" {
		t.Errorf("Context = %q, want %q", edges[0].Context, "step[0]")
	}
}

func TestExtractWorkflowEdges_StepCallProducesFunctionEdge(t *testing.T) {
	steps := `[
		{"id": "s1", "$ref": "mod:action:a1", "function": "mod:function:f1", "parameters": {}}
	]`

	edges := ExtractWorkflowEdges(newSrc(), steps, "{}")

	if len(edges) != 2 {
		t.Fatalf("expected 2 edges (action + function), got %d: %+v", len(edges), edges)
	}
	// Order: $ref edge first, then function edge.
	if edges[0].TargetType != TargetTypeAction || edges[0].TargetName != "mod:action:a1" {
		t.Errorf("edges[0] = %+v, want action edge", edges[0])
	}
	if edges[1].TargetType != TargetTypeFunction || edges[1].TargetName != "mod:function:f1" {
		t.Errorf("edges[1] = %+v, want function edge", edges[1])
	}
	if edges[1].Context != "step[0].function" {
		t.Errorf("edges[1].Context = %q, want %q", edges[1].Context, "step[0].function")
	}
}

func TestExtractWorkflowEdges_MultipleSteps(t *testing.T) {
	steps := `[
		{"id": "s1", "$ref": "mod:action:a1", "function": "mod:function:f1"},
		{"id": "s2", "$ref": "mod:action:a2", "function": "mod:function:f2"}
	]`
	trigger := `{"$ref": "mod:trigger:t1"}`

	edges := ExtractWorkflowEdges(newSrc(), steps, trigger)

	// trigger + (action + function) * 2 = 5 edges
	if len(edges) != 5 {
		t.Fatalf("expected 5 edges, got %d: %+v", len(edges), edges)
	}
}

func TestExtractWorkflowEdges_MalformedRefSilentlySkipped(t *testing.T) {
	cases := []struct {
		name string
		ref  string
	}{
		{"missing module segment", ":action:foo"},
		{"missing kind segment", "mod::foo"},
		{"missing resource segment", "mod:action:"},
		{"only one segment", "just_a_name"},
		{"only two segments", "mod:action"},
		{"unrecognized kind", "mod:bogus_kind:foo"},
		{"too many segments", "mod:action:foo:extra"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			steps := `[{"id": "s1", "$ref": "` + tc.ref + `"}]`
			edges := ExtractWorkflowEdges(newSrc(), steps, "{}")
			if len(edges) != 0 {
				t.Errorf("expected 0 edges for malformed $ref %q, got %d: %+v", tc.ref, len(edges), edges)
			}
		})
	}
}

func TestExtractWorkflowEdges_CallWithoutRefStillProducesFunctionEdge(t *testing.T) {
	// A step that has a `call` but no `$ref` (for whatever reason — e.g.
	// a built-in function call that doesn't go through an action) should
	// still record the function dependency.
	steps := `[{"id": "s1", "function": "mod:function:f1"}]`

	edges := ExtractWorkflowEdges(newSrc(), steps, "{}")

	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d: %+v", len(edges), edges)
	}
	if edges[0].TargetType != TargetTypeFunction || edges[0].TargetName != "mod:function:f1" {
		t.Errorf("got %+v, want function edge for mod:function:f1", edges[0])
	}
}

func TestExtractWorkflowEdges_KindFromCanonicalIDAcceptsAllKinds(t *testing.T) {
	kinds := []string{
		TargetTypeAction,
		TargetTypeTrigger,
		TargetTypeFunction,
		TargetTypeCommand,
		TargetTypeWorkflow,
		TargetTypeWidget,
		TargetTypeOverlay,
	}
	for _, k := range kinds {
		t.Run(k, func(t *testing.T) {
			parsed, ok := kindFromCanonicalID("mod:" + k + ":foo")
			if !ok || parsed != k {
				t.Errorf("kindFromCanonicalID(mod:%s:foo) = (%q, %v), want (%q, true)", k, parsed, ok, k)
			}
		})
	}
}
