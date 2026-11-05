package services

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// heldFixture pairs the workflow service with the group service on one
// database, for the paths where a workflow's own writes meet its groups.
type heldFixture struct {
	*groupFixture
	workflows client.WorkflowService
	publisher *workers.EventPublisher
}

func newHeldFixture(t *testing.T, db *gorm.DB) *heldFixture {
	t.Helper()
	publisher := workers.NewEventPublisher(repo.NewDbEventRepository(db), slog.New(slog.DiscardHandler))
	workflows := NewWorkflowService(repo.NewWorkflowRepository(db, database.RandomIDs{}), repo.NewCommandRepository(db), db, publisher, nil)
	return &heldFixture{groupFixture: newGroupFixture(t, db), workflows: workflows, publisher: publisher}
}

func (f *heldFixture) manual(workflowID string, enabled bool) {
	f.t.Helper()
	if _, err := f.workflows.UpdateWorkflow(context.Background(), &client.UpdateWorkflowRequest{Id: workflowID, Enabled: &enabled}); err != nil {
		f.t.Fatalf("switch workflow %s to %v: %v", workflowID, enabled, err)
	}
}

func (f *heldFixture) mergeAll() int {
	f.t.Helper()
	merged, failed := MergeOwnWorkflows(repo.NewWorkflowRepository(f.db, database.RandomIDs{}), f.db, f.publisher, nil)
	if failed != 0 {
		f.t.Fatalf("MergeOwnWorkflows failed %d set(s)", failed)
	}
	return merged
}

func (f *heldFixture) cheerDuplicate(name string, enabled bool) string {
	f.t.Helper()
	return f.workflowWith(&models.WorkflowDefinition{
		Name: name, Enabled: enabled, Trigger: cheerTrigger(""), Steps: `[` + reply + `]`,
	})
}

func (f *heldFixture) exists(workflowID string) bool {
	f.t.Helper()
	var n int64
	if err := f.db.Model(&models.WorkflowDefinition{}).Where("id = ?", workflowID).Count(&n).Error; err != nil {
		f.t.Fatalf("count workflow: %v", err)
	}
	return n == 1
}

func TestManualTogglesOfHeldWorkflows(t *testing.T) {
	tests := []struct {
		row  string
		play func(f *heldFixture)
	}{
		{"7 manual on while held", func(f *heldFixture) {
			x := f.workflow("x", false)
			a := f.group("A", x)
			f.setEnabled(a, true)
			f.manual(x, true)
			f.expect("manual on", x, true, savedOn)
			f.setEnabled(a, false)
			f.expect("A off", x, true, nil)
		}},
		{"8 manual off while held", func(f *heldFixture) {
			x := f.workflow("x", true)
			a := f.group("A", x)
			f.setEnabled(a, true)
			f.manual(x, false)
			f.expect("manual off", x, false, savedOff)
			f.setEnabled(a, false)
			f.expect("A off", x, false, nil)
		}},
		{"9 manual toggle, not held", func(f *heldFixture) {
			x := f.workflow("x", false)
			f.group("A", x)
			f.manual(x, true)
			f.expect("manual on", x, true, nil)
			f.manual(x, false)
			f.expect("manual off", x, false, nil)
		}},
		{"10 manual off, then another group", func(f *heldFixture) {
			x := f.workflow("x", false)
			a, b := f.group("A", x), f.group("B", x)
			f.setEnabled(a, true)
			f.manual(x, false)
			f.expect("manual off", x, false, savedOff)
			f.setEnabled(b, true)
			f.expect("B on", x, true, savedOff)
			f.setEnabled(b, false)
			f.expect("B off", x, true, savedOff)
			f.setEnabled(a, false)
			f.expect("A off", x, false, nil)
		}},
		{"an editor save leaves the held state alone", func(f *heldFixture) {
			x := f.workflow("x", false)
			a := f.group("A", x)
			f.setEnabled(a, true)
			if _, err := f.workflows.UpdateWorkflow(context.Background(), &client.UpdateWorkflowRequest{Id: x, Name: "renamed"}); err != nil {
				f.t.Fatalf("rename: %v", err)
			}
			f.expect("renamed", x, true, savedOff)
		}},
	}
	for _, tc := range tests {
		t.Run(tc.row, func(t *testing.T) {
			dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
				tc.play(newHeldFixture(t, db))
			})
		})
	}
}

func TestWorkflowsReportTheirGroups(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newHeldFixture(t, db)
		ctx := context.Background()
		x := f.workflow("x", false)
		y := f.workflow("y", false)
		a, b := f.group("A", x), f.group("B", x)

		got, err := f.workflows.GetWorkflow(ctx, &client.GetWorkflowRequest{Id: x})
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if len(got.Workflow.GroupIds) != 2 {
			t.Errorf("group ids = %v, want %s and %s", got.Workflow.GroupIds, a, b)
		}
		listed, err := f.workflows.ListWorkflows(ctx, &client.ListWorkflowsRequest{IncludeDisabled: true})
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		for _, wf := range listed.Workflows {
			want := map[string]int{x: 2, y: 0}[wf.Id]
			if len(wf.GroupIds) != want || wf.GroupIds == nil {
				t.Errorf("listed %s with groups %v, want %d", wf.Name, wf.GroupIds, want)
			}
		}

		f.clearEvents()
		f.manual(x, true)
		events := f.events("workflow")
		if len(events) != 1 {
			t.Fatalf("events after a manual switch = %d, want 1", len(events))
		}
		if !jsonHas(t, events[0].Payload, "group_ids", 2) {
			t.Errorf("payload %s does not carry both groups", events[0].Payload)
		}
	})
}

func jsonHas(t *testing.T, payload, key string, length int) bool {
	t.Helper()
	var decoded map[string]any
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		t.Fatalf("payload: %v", err)
	}
	list, ok := decoded[key].([]any)
	return ok && len(list) == length
}

func TestDeletingAGroupedWorkflowAnnouncesItsGroups(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newHeldFixture(t, db)
		x := f.workflow("x", false)
		y := f.workflow("y", false)
		a := f.group("A", x, y)
		f.setEnabled(a, true)
		f.clearEvents()

		if _, err := f.workflows.DeleteWorkflow(context.Background(), &client.DeleteWorkflowRequest{Id: x}); err != nil {
			t.Fatalf("delete: %v", err)
		}

		members, err := repo.NewWorkflowGroupRepository(db).MemberIDs(uuid.MustParse(a))
		if err != nil {
			t.Fatalf("members: %v", err)
		}
		if len(members) != 1 || members[0].String() != y {
			t.Errorf("members = %v, want only y", members)
		}
		groupEvents := f.events("workflow_group")
		if len(groupEvents) != 1 || !jsonHas(t, groupEvents[0].Payload, "member_ids", 1) {
			t.Errorf("group events = %v, want one with the remaining member", groupEvents)
		}
		f.expect("y untouched", y, true, savedOff)
	})
}

func TestRepairHeldWorkflowsAtStart(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newHeldFixture(t, db)
		stale := f.workflow("stale", true)
		unsaved := f.workflow("unsaved", true)
		fine := f.workflow("fine", false)
		a := f.group("A", unsaved, fine)
		f.setEnabled(a, true)
		// What a crash or a hand edit could leave: a saved state with no group
		// on, and a held workflow without one.
		if err := db.Exec(`UPDATE workflow_definitions SET pre_group_enabled = ? WHERE id = ?`, false, stale).Error; err != nil {
			t.Fatalf("break stale: %v", err)
		}
		if err := db.Exec(`UPDATE workflow_definitions SET pre_group_enabled = NULL WHERE id = ?`, unsaved).Error; err != nil {
			t.Fatalf("break unsaved: %v", err)
		}
		f.clearEvents()

		repaired, err := RepairHeldWorkflows(db, f.publisher, slog.New(slog.DiscardHandler))
		if err != nil {
			t.Fatalf("repair: %v", err)
		}
		if repaired != 2 {
			t.Errorf("repaired = %d, want 2", repaired)
		}
		f.expect("stale", stale, false, nil)
		f.expect("unsaved", unsaved, true, savedOn)
		f.expect("fine", fine, true, savedOff)
		if events := f.events("workflow"); len(events) != 1 || events[0].EntityID != stale {
			t.Errorf("events = %v, want one for the workflow whose switch moved", events)
		}

		again, err := RepairHeldWorkflows(db, f.publisher, slog.New(slog.DiscardHandler))
		if err != nil || again != 0 {
			t.Errorf("second repair = %d, %v; want nothing to do", again, err)
		}
	})
}

// Two copies of a trigger put in different groups are how a streamer splits
// its steps between groups, so merging them would undo the split. The start-up
// pass (MergeOwnWorkflows) and a save (UpdateWorkflow) both merge.
func TestDuplicatesInDifferentGroupsNeverMerge(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newHeldFixture(t, db)
		holiday := f.cheerDuplicate("holiday", true)
		sponsor := f.cheerDuplicate("sponsor", true)
		f.group("Holiday", holiday)
		f.group("Sponsor", sponsor)
		loose := f.cheerDuplicate("loose", true)
		alsoLoose := f.cheerDuplicate("also loose", true)

		if merged := f.mergeAll(); merged != 1 {
			t.Errorf("start-up merged %d, want only the ungrouped pair", merged)
		}
		if !f.exists(holiday) || !f.exists(sponsor) {
			t.Fatal("the start-up pass merged duplicates in different groups")
		}
		if f.exists(loose) == f.exists(alsoLoose) {
			t.Error("the ungrouped duplicates did not merge")
		}

		f.manual(holiday, true)
		if !f.exists(holiday) || !f.exists(sponsor) {
			t.Fatal("a save merged duplicates in different groups")
		}
	})
}

func TestHeldDuplicatesMergeOnlyOnceReleased(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newHeldFixture(t, db)
		first := f.cheerDuplicate("first", true)
		second := f.cheerDuplicate("second", true)
		a := f.group("A")
		// Joining one at a time keeps the pair in different groups for a moment;
		// nothing may merge then either.
		f.add(a, first)
		f.add(a, second)
		f.setEnabled(a, true)

		if merged := f.mergeAll(); merged != 0 {
			t.Fatalf("start-up merged %d held workflow(s)", merged)
		}
		f.manual(first, true)
		if !f.exists(first) || !f.exists(second) {
			t.Fatal("a save merged held workflows")
		}

		f.setEnabled(a, false)
		if merged := f.mergeAll(); merged != 1 {
			t.Fatalf("merged %d once released, want 1", merged)
		}
		members, err := repo.NewWorkflowGroupRepository(db).MemberIDs(uuid.MustParse(a))
		if err != nil {
			t.Fatalf("members: %v", err)
		}
		if len(members) != 1 {
			t.Errorf("group members after the merge = %v, want the survivor only", members)
		}
	})
}

func TestModuleUpgradeLeavesTheHeldState(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newHeldFixture(t, db)
		install := moduleWorkflowRequest("mod", "wf", "channel.follow")
		install.Enabled = false
		created, err := f.workflows.CreateWorkflow(context.Background(), install)
		if err != nil {
			t.Fatalf("install: %v", err)
		}
		x := created.Workflow.Id
		a := f.group("A", x)
		f.setEnabled(a, true)

		upgraded, err := f.workflows.CreateWorkflow(context.Background(), moduleWorkflowRequest("mod", "wf", "channel.follow"))
		if err != nil {
			t.Fatalf("upgrade: %v", err)
		}
		if upgraded.Workflow.Id != x || len(upgraded.Workflow.GroupIds) != 1 {
			t.Errorf("upgrade = %s in groups %v, want %s in A", upgraded.Workflow.Id, upgraded.Workflow.GroupIds, x)
		}
		f.expect("upgraded", x, true, savedOff)
	})
}
