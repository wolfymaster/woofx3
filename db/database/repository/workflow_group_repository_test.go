package repository

import (
	"testing"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

func seedWorkflow(t *testing.T, db *gorm.DB, name string) *models.WorkflowDefinition {
	t.Helper()
	wf := &models.WorkflowDefinition{Name: name, Steps: "[]", Trigger: "{}", Taxonomy: "[]"}
	if err := db.Create(wf).Error; err != nil {
		t.Fatalf("create workflow %s: %v", name, err)
	}
	return wf
}

func seedWorkflowGroup(t *testing.T, r *WorkflowGroupRepository, name string, enabled bool) *models.WorkflowGroup {
	t.Helper()
	group := &models.WorkflowGroup{Name: name, Enabled: enabled}
	if err := r.Create(group); err != nil {
		t.Fatalf("create group %s: %v", name, err)
	}
	return group
}

func TestWorkflowGroupHeldLookupsOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		r := NewWorkflowGroupRepository(db)
		x := seedWorkflow(t, db, "x")
		y := seedWorkflow(t, db, "y")
		onGroup := seedWorkflowGroup(t, r, "on", true)
		offGroup := seedWorkflowGroup(t, r, "off", false)
		if err := r.AddMembers(onGroup.ID, []uuid.UUID{x.ID}); err != nil {
			t.Fatalf("add to on: %v", err)
		}
		if err := r.AddMembers(offGroup.ID, []uuid.UUID{x.ID, y.ID}); err != nil {
			t.Fatalf("add to off: %v", err)
		}
		if err := r.AddMembers(offGroup.ID, []uuid.UUID{x.ID}); err != nil {
			t.Fatalf("adding an existing member again: %v", err)
		}

		held, err := r.HeldElsewhere([]uuid.UUID{x.ID, y.ID}, uuid.Nil)
		if err != nil {
			t.Fatalf("HeldElsewhere: %v", err)
		}
		if !held[x.ID] || held[y.ID] {
			t.Errorf("held = %v, want only x", held)
		}
		held, err = r.HeldElsewhere([]uuid.UUID{x.ID}, onGroup.ID)
		if err != nil {
			t.Fatalf("HeldElsewhere except on: %v", err)
		}
		if held[x.ID] {
			t.Error("x is held by a group other than the only on group")
		}
		all, err := r.HeldWorkflowIDs()
		if err != nil {
			t.Fatalf("HeldWorkflowIDs: %v", err)
		}
		if len(all) != 1 || !all[x.ID] {
			t.Errorf("held workflows = %v, want only x", all)
		}

		byWorkflow, err := r.GroupIDsByWorkflow(nil)
		if err != nil {
			t.Fatalf("GroupIDsByWorkflow: %v", err)
		}
		if len(byWorkflow[x.ID]) != 2 || len(byWorkflow[y.ID]) != 1 {
			t.Errorf("groups by workflow = %v, want x in 2 and y in 1", byWorkflow)
		}

		if err := r.RemoveMembers(offGroup.ID, []uuid.UUID{y.ID}); err != nil {
			t.Fatalf("RemoveMembers: %v", err)
		}
		members, err := r.MemberIDs(offGroup.ID)
		if err != nil {
			t.Fatalf("MemberIDs: %v", err)
		}
		if len(members) != 1 || members[0] != x.ID {
			t.Errorf("members of off = %v, want only x", members)
		}

		if err := r.Delete(onGroup.ID); err != nil {
			t.Fatalf("Delete: %v", err)
		}
		byGroup, err := r.MemberIDsByGroup()
		if err != nil {
			t.Fatalf("MemberIDsByGroup: %v", err)
		}
		if _, ok := byGroup[onGroup.ID]; ok {
			t.Error("a deleted group kept its memberships")
		}
	})
}

func TestWorkflowGroupSaveHeldStateWritesOnlyTheSwitchOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		r := NewWorkflowGroupRepository(db)
		x := seedWorkflow(t, db, "x")
		saved := false
		locked, err := r.LockWorkflows([]uuid.UUID{x.ID})
		if err != nil || len(locked) != 1 {
			t.Fatalf("LockWorkflows = %v, %v", locked, err)
		}
		locked[0].Enabled = true
		locked[0].PreGroupEnabled = &saved
		locked[0].Steps = `[{"id":"lost"}]`
		if err := r.SaveHeldState(locked[0]); err != nil {
			t.Fatalf("SaveHeldState: %v", err)
		}

		var got models.WorkflowDefinition
		if err := db.First(&got, "id = ?", x.ID).Error; err != nil {
			t.Fatalf("read back: %v", err)
		}
		if !got.Enabled || got.PreGroupEnabled == nil || *got.PreGroupEnabled || got.Steps != "[]" {
			t.Errorf("stored = enabled %v, saved %v, steps %s; want on, saved off, steps untouched",
				got.Enabled, got.PreGroupEnabled, got.Steps)
		}

		got.PreGroupEnabled = nil
		if err := r.SaveHeldState(&got); err != nil {
			t.Fatalf("clear: %v", err)
		}
		var cleared models.WorkflowDefinition
		if err := db.First(&cleared, "id = ?", x.ID).Error; err != nil {
			t.Fatalf("read back: %v", err)
		}
		if cleared.PreGroupEnabled != nil {
			t.Error("saved state was not cleared")
		}
	})
}
