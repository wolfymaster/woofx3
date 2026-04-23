package engine

import (
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/triggers"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type recordingRegistrar struct {
	registers   []string
	unregisters []string
}

func (r *recordingRegistrar) Register(id string, _ *types.TriggerConfig) error {
	r.registers = append(r.registers, id)
	return nil
}
func (r *recordingRegistrar) Unregister(id string, _ *types.TriggerConfig) error {
	r.unregisters = append(r.unregisters, id)
	return nil
}

func TestRegistry_RegisterCallsRegistrar(t *testing.T) {
	reg := NewWorkflowRegistry()
	rr := &recordingRegistrar{}
	reg.SetRegistrar(rr)

	def := &types.WorkflowDefinition{
		ID:      "wf-1",
		Name:    "x",
		Tasks:   []types.TaskDefinition{{ID: "t1", Type: "print"}},
		Trigger: &types.TriggerConfig{Type: "event", EventType: "a"},
	}
	if err := reg.Register(def); err != nil {
		t.Fatalf("register: %v", err)
	}
	if len(rr.registers) != 1 || rr.registers[0] != "wf-1" {
		t.Errorf("registers = %v, want [wf-1]", rr.registers)
	}

	if err := reg.Remove("wf-1"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if len(rr.unregisters) != 1 || rr.unregisters[0] != "wf-1" {
		t.Errorf("unregisters = %v, want [wf-1]", rr.unregisters)
	}
}

func TestRegistry_RegisterUpdate_ReplacesTrigger(t *testing.T) {
	reg := NewWorkflowRegistry()
	rr := &recordingRegistrar{}
	reg.SetRegistrar(rr)

	defV1 := &types.WorkflowDefinition{
		ID: "wf-1", Name: "x", Tasks: []types.TaskDefinition{{ID: "t1", Type: "print"}},
		Trigger: &types.TriggerConfig{Type: "event", EventType: "a"},
	}
	defV2 := &types.WorkflowDefinition{
		ID: "wf-1", Name: "x", Tasks: []types.TaskDefinition{{ID: "t1", Type: "print"}},
		Trigger: &types.TriggerConfig{Type: "event", EventType: "b"},
	}
	_ = reg.Register(defV1)
	_ = reg.Register(defV2)

	// Expect: register wf-1, unregister wf-1 (for old), register wf-1 (for new).
	if got := len(rr.registers); got != 2 {
		t.Errorf("registers count = %d, want 2", got)
	}
	if got := len(rr.unregisters); got != 1 {
		t.Errorf("unregisters count = %d, want 1", got)
	}
}

func TestRegistry_NilTrigger_SkipsRegistrar(t *testing.T) {
	reg := NewWorkflowRegistry()
	rr := &recordingRegistrar{}
	reg.SetRegistrar(rr)

	def := &types.WorkflowDefinition{
		ID: "wf-1", Name: "x", Tasks: []types.TaskDefinition{{ID: "t1", Type: "print"}},
	}
	_ = reg.Register(def)
	_ = reg.Remove("wf-1")

	if len(rr.registers)+len(rr.unregisters) != 0 {
		t.Errorf("expected zero registrar calls for nil-trigger workflow; got %d registers %d unregisters",
			len(rr.registers), len(rr.unregisters))
	}
}

func TestRegistry_Remove_IdempotentWhenAbsent(t *testing.T) {
	reg := NewWorkflowRegistry()
	rr := &recordingRegistrar{}
	reg.SetRegistrar(rr)

	// Removing a workflow that was never registered must succeed silently,
	// so the lifecycle path can unregister on disable without knowing whether
	// the workflow was previously enabled.
	if err := reg.Remove("missing"); err != nil {
		t.Fatalf("Remove(missing) returned error: %v", err)
	}
	if len(rr.unregisters) != 0 {
		t.Errorf("expected no registrar calls; got %d unregisters", len(rr.unregisters))
	}
}

// Silences unused import complaint if the file ends up not using triggers.*.
var _ triggers.Registrar = (*recordingRegistrar)(nil)
