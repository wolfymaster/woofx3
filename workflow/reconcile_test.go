package main

import (
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func TestReconcileDiff_AddsMissing_RemovesExtra(t *testing.T) {
	inMem := map[string]*types.WorkflowDefinition{
		"a": {ID: "a"},
		"b": {ID: "b"},
	}
	desired := map[string]*types.WorkflowDefinition{
		"b": {ID: "b"},
		"c": {ID: "c"},
	}

	toAdd, toRemove := reconcileDiff(inMem, desired)

	if len(toAdd) != 1 || toAdd[0].ID != "c" {
		t.Errorf("toAdd = %+v, want [{ID:c}]", toAdd)
	}
	if len(toRemove) != 1 || toRemove[0] != "a" {
		t.Errorf("toRemove = %v, want [a]", toRemove)
	}
}

func TestReconcileDiff_Empty(t *testing.T) {
	inMem := map[string]*types.WorkflowDefinition{"a": {ID: "a"}}
	desired := map[string]*types.WorkflowDefinition{"a": {ID: "a"}}

	toAdd, toRemove := reconcileDiff(inMem, desired)

	if len(toAdd) != 0 || len(toRemove) != 0 {
		t.Errorf("expected no diff; got add=%v remove=%v", toAdd, toRemove)
	}
}
