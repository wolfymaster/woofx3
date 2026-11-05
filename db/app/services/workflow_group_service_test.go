package services

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// groupFixture is a workflow group service over a real, fully migrated
// database, with helpers that read the stored state back.
type groupFixture struct {
	t   *testing.T
	db  *gorm.DB
	svc client.WorkflowGroupService
}

func newGroupFixture(t *testing.T, db *gorm.DB) *groupFixture {
	t.Helper()
	publisher := workers.NewEventPublisher(repo.NewDbEventRepository(db), slog.New(slog.DiscardHandler))
	svc, err := NewWorkflowGroupService(db, publisher)
	if err != nil {
		t.Fatalf("NewWorkflowGroupService: %v", err)
	}
	return &groupFixture{t: t, db: db, svc: svc}
}

func (f *groupFixture) workflow(name string, enabled bool) string {
	f.t.Helper()
	return f.workflowWith(&models.WorkflowDefinition{Name: name, Enabled: enabled})
}

func (f *groupFixture) workflowWith(wf *models.WorkflowDefinition) string {
	f.t.Helper()
	if wf.Steps == "" {
		wf.Steps = "[]"
	}
	if wf.Trigger == "" {
		wf.Trigger = `{"type":"event","event":"channel.follow"}`
	}
	if wf.Taxonomy == "" {
		wf.Taxonomy = "[]"
	}
	if wf.CreatedByType == "" {
		wf.CreatedByType = "USER"
	}
	if err := f.db.Create(wf).Error; err != nil {
		f.t.Fatalf("create workflow %s: %v", wf.Name, err)
	}
	return wf.ID.String()
}

func (f *groupFixture) group(name string, members ...string) string {
	f.t.Helper()
	created, err := f.svc.CreateWorkflowGroup(context.Background(), &client.CreateWorkflowGroupRequest{Name: name})
	if err != nil {
		f.t.Fatalf("create group %s: %v", name, err)
	}
	if len(members) > 0 {
		f.add(created.Group.Id, members...)
	}
	return created.Group.Id
}

func (f *groupFixture) setEnabled(groupID string, enabled bool) {
	f.t.Helper()
	if _, err := f.svc.SetWorkflowGroupEnabled(context.Background(), &client.SetWorkflowGroupEnabledRequest{Id: groupID, Enabled: enabled}); err != nil {
		f.t.Fatalf("switch group %s to %v: %v", groupID, enabled, err)
	}
}

func (f *groupFixture) add(groupID string, workflowIDs ...string) {
	f.t.Helper()
	if _, err := f.svc.AddWorkflowGroupMembers(context.Background(), &client.AddWorkflowGroupMembersRequest{GroupId: groupID, WorkflowIds: workflowIDs}); err != nil {
		f.t.Fatalf("add to group %s: %v", groupID, err)
	}
}

func (f *groupFixture) remove(groupID string, workflowIDs ...string) {
	f.t.Helper()
	if _, err := f.svc.RemoveWorkflowGroupMembers(context.Background(), &client.RemoveWorkflowGroupMembersRequest{GroupId: groupID, WorkflowIds: workflowIDs}); err != nil {
		f.t.Fatalf("remove from group %s: %v", groupID, err)
	}
}

func (f *groupFixture) deleteGroup(groupID string) {
	f.t.Helper()
	if _, err := f.svc.DeleteWorkflowGroup(context.Background(), &client.DeleteWorkflowGroupRequest{Id: groupID}); err != nil {
		f.t.Fatalf("delete group %s: %v", groupID, err)
	}
}

func (f *groupFixture) stored(workflowID string) *models.WorkflowDefinition {
	f.t.Helper()
	var wf models.WorkflowDefinition
	if err := f.db.First(&wf, "id = ?", workflowID).Error; err != nil {
		f.t.Fatalf("read workflow %s: %v", workflowID, err)
	}
	return &wf
}

// expect checks a workflow's switch and saved state; saved nil means none.
func (f *groupFixture) expect(step, workflowID string, enabled bool, saved *bool) {
	f.t.Helper()
	wf := f.stored(workflowID)
	if wf.Enabled != enabled {
		f.t.Errorf("%s: enabled = %v, want %v", step, wf.Enabled, enabled)
	}
	if !sameSavedState(wf.PreGroupEnabled, saved) {
		f.t.Errorf("%s: saved = %v, want %v", step, describeSaved(wf.PreGroupEnabled), describeSaved(saved))
	}
}

func describeSaved(saved *bool) string {
	if saved == nil {
		return "none"
	}
	if *saved {
		return "on"
	}
	return "off"
}

func (f *groupFixture) events(entityType string) []models.WorkerEvent {
	f.t.Helper()
	var events []models.WorkerEvent
	if err := f.db.Where("entity_type = ?", entityType).Order("id").Find(&events).Error; err != nil {
		f.t.Fatalf("read outbox: %v", err)
	}
	return events
}

func (f *groupFixture) clearEvents() {
	f.t.Helper()
	if err := f.db.Where("1 = 1").Delete(&models.WorkerEvent{}).Error; err != nil {
		f.t.Fatalf("clear outbox: %v", err)
	}
}

func TestWorkflowGroupEdgeCases(t *testing.T) {
	tests := []struct {
		row  string
		play func(f *groupFixture)
	}{
		{"1 basic", func(f *groupFixture) {
			x := f.workflow("x", false)
			a := f.group("A", x)
			f.setEnabled(a, true)
			f.expect("A on", x, true, savedOff)
			f.setEnabled(a, false)
			f.expect("A off", x, false, nil)
		}},
		{"2 already on", func(f *groupFixture) {
			x := f.workflow("x", true)
			a := f.group("A", x)
			f.setEnabled(a, true)
			f.expect("A on", x, true, savedOn)
			f.setEnabled(a, false)
			f.expect("A off", x, true, nil)
		}},
		{"3 overlap", func(f *groupFixture) {
			x := f.workflow("x", false)
			a, b := f.group("A", x), f.group("B", x)
			f.setEnabled(a, true)
			f.setEnabled(b, true)
			f.expect("B on", x, true, savedOff)
			f.setEnabled(a, false)
			f.expect("A off", x, true, savedOff)
			f.setEnabled(b, false)
			f.expect("B off", x, false, nil)
		}},
		{"4 overlap, other order", func(f *groupFixture) {
			x := f.workflow("x", false)
			a, b := f.group("A", x), f.group("B", x)
			f.setEnabled(a, true)
			f.setEnabled(b, true)
			f.setEnabled(b, false)
			f.expect("B off", x, true, savedOff)
			f.setEnabled(a, false)
			f.expect("A off", x, false, nil)
		}},
		{"5 overlap, X originally on", func(f *groupFixture) {
			x := f.workflow("x", true)
			a, b := f.group("A", x), f.group("B", x)
			f.setEnabled(a, true)
			f.setEnabled(b, true)
			f.setEnabled(a, false)
			f.expect("A off", x, true, savedOn)
			f.setEnabled(b, false)
			f.expect("B off", x, true, nil)
		}},
		{"6 later group never captures forced state", func(f *groupFixture) {
			x := f.workflow("x", false)
			a, b := f.group("A", x), f.group("B", x)
			f.setEnabled(a, true)
			f.setEnabled(b, true)
			f.expect("B on", x, true, savedOff)
		}},
		{"11 add to an on group", func(f *groupFixture) {
			x := f.workflow("x", false)
			a := f.group("A")
			f.setEnabled(a, true)
			f.add(a, x)
			f.expect("added", x, true, savedOff)
		}},
		{"11 add to an on group, already held", func(f *groupFixture) {
			x := f.workflow("x", false)
			b := f.group("B", x)
			f.setEnabled(b, true)
			a := f.group("A")
			f.setEnabled(a, true)
			f.add(a, x)
			f.expect("added", x, true, savedOff)
			f.setEnabled(b, false)
			f.expect("B off", x, true, savedOff)
			f.setEnabled(a, false)
			f.expect("A off", x, false, nil)
		}},
		{"12 add to an off group", func(f *groupFixture) {
			x := f.workflow("x", false)
			f.group("A", x)
			f.expect("added", x, false, nil)
		}},
		{"13 remove from an on group", func(f *groupFixture) {
			x := f.workflow("x", false)
			a := f.group("A", x)
			f.setEnabled(a, true)
			f.remove(a, x)
			f.expect("removed", x, false, nil)
		}},
		{"13 remove from an on group, still held", func(f *groupFixture) {
			x := f.workflow("x", false)
			a, b := f.group("A", x), f.group("B", x)
			f.setEnabled(a, true)
			f.setEnabled(b, true)
			f.remove(a, x)
			f.expect("removed", x, true, savedOff)
		}},
		{"14 remove from an off group", func(f *groupFixture) {
			x := f.workflow("x", true)
			a := f.group("A", x)
			f.remove(a, x)
			f.expect("removed", x, true, nil)
		}},
		{"15 delete an on group", func(f *groupFixture) {
			x := f.workflow("x", false)
			y := f.workflow("y", false)
			a, b := f.group("A", x, y), f.group("B", y)
			f.setEnabled(a, true)
			f.setEnabled(b, true)
			f.deleteGroup(a)
			f.expect("x after delete", x, false, nil)
			f.expect("y after delete", y, true, savedOff)
			var memberships int64
			f.db.Model(&models.WorkflowGroupMember{}).Where("group_id = ?", a).Count(&memberships)
			if memberships != 0 {
				f.t.Errorf("memberships of the deleted group = %d, want 0", memberships)
			}
		}},
		{"16 delete an off group", func(f *groupFixture) {
			x := f.workflow("x", true)
			a := f.group("A", x)
			f.deleteGroup(a)
			f.expect("deleted", x, true, nil)
		}},
		{"17 delete the trigger", func(f *groupFixture) {
			x := f.workflow("x", false)
			y := f.workflow("y", false)
			a := f.group("A", x, y)
			f.setEnabled(a, true)
			if err := f.db.Delete(&models.WorkflowDefinition{}, "id = ?", x).Error; err != nil {
				f.t.Fatalf("delete x: %v", err)
			}
			listed, err := f.svc.ListWorkflowGroups(context.Background(), &client.ListWorkflowGroupsRequest{})
			if err != nil {
				f.t.Fatalf("list: %v", err)
			}
			if got := listed.Groups[0].MemberIds; len(got) != 1 || got[0] != y {
				f.t.Errorf("members after deleting x = %v, want only y", got)
			}
			f.setEnabled(a, false)
			f.expect("A off", y, false, nil)
		}},
		{"20 group has no members", func(f *groupFixture) {
			x := f.workflow("x", true)
			a := f.group("A")
			f.setEnabled(a, true)
			f.setEnabled(a, false)
			f.expect("untouched", x, true, nil)
			listed, err := f.svc.ListWorkflowGroups(context.Background(), &client.ListWorkflowGroupsRequest{})
			if err != nil {
				f.t.Fatalf("list: %v", err)
			}
			if len(listed.Groups) != 1 || listed.Groups[0].Enabled || listed.Groups[0].MemberIds == nil {
				f.t.Errorf("groups = %v, want one, off, with an empty member list", listed.Groups)
			}
		}},
		{"idempotent switch", func(f *groupFixture) {
			x := f.workflow("x", false)
			a := f.group("A", x)
			f.setEnabled(a, true)
			f.clearEvents()
			f.setEnabled(a, true)
			if n := len(f.events("workflow")) + len(f.events("workflow_group")); n != 0 {
				f.t.Errorf("switching on a group that is on announced %d events", n)
			}
			f.expect("on twice", x, true, savedOff)
			f.setEnabled(a, false)
			f.setEnabled(a, false)
			f.expect("off twice", x, false, nil)
		}},
		{"module-owned member allowed", func(f *groupFixture) {
			x := f.workflowWith(&models.WorkflowDefinition{Name: "m", CreatedByType: "MODULE", CreatedByRef: "mod", ManifestID: "wf"})
			a := f.group("A", x)
			f.setEnabled(a, true)
			f.expect("A on", x, true, savedOff)
		}},
	}
	for _, tc := range tests {
		t.Run(tc.row, func(t *testing.T) {
			dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
				tc.play(newGroupFixture(t, db))
			})
		})
	}
}

func TestWorkflowGroupRefusals(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newGroupFixture(t, db)
		ctx := context.Background()
		x := f.workflow("x", false)
		command := f.workflowWith(&models.WorkflowDefinition{Name: "!hello", Trigger: `{"type":"command","event":"chat.command.hello"}`})
		a := f.group("A")
		missing := uuid.NewString()

		refusals := []struct {
			name string
			call func() error
			want twirp.ErrorCode
		}{
			{"a group without a name", func() error {
				_, err := f.svc.CreateWorkflowGroup(ctx, &client.CreateWorkflowGroupRequest{Name: "  "})
				return err
			}, twirp.InvalidArgument},
			{"a taken name", func() error {
				_, err := f.svc.CreateWorkflowGroup(ctx, &client.CreateWorkflowGroupRequest{Name: "A"})
				return err
			}, twirp.AlreadyExists},
			{"a malformed group id", func() error {
				_, err := f.svc.SetWorkflowGroupEnabled(ctx, &client.SetWorkflowGroupEnabledRequest{Id: "nope", Enabled: true})
				return err
			}, twirp.InvalidArgument},
			{"an unknown group", func() error {
				_, err := f.svc.SetWorkflowGroupEnabled(ctx, &client.SetWorkflowGroupEnabledRequest{Id: missing, Enabled: true})
				return err
			}, twirp.NotFound},
			{"deleting an unknown group", func() error {
				_, err := f.svc.DeleteWorkflowGroup(ctx, &client.DeleteWorkflowGroupRequest{Id: missing})
				return err
			}, twirp.NotFound},
			{"no workflows to add", func() error {
				_, err := f.svc.AddWorkflowGroupMembers(ctx, &client.AddWorkflowGroupMembersRequest{GroupId: a})
				return err
			}, twirp.InvalidArgument},
			{"a malformed workflow id", func() error {
				_, err := f.svc.AddWorkflowGroupMembers(ctx, &client.AddWorkflowGroupMembersRequest{GroupId: a, WorkflowIds: []string{"nope"}})
				return err
			}, twirp.InvalidArgument},
			{"an unknown workflow", func() error {
				_, err := f.svc.AddWorkflowGroupMembers(ctx, &client.AddWorkflowGroupMembersRequest{GroupId: a, WorkflowIds: []string{x, missing}})
				return err
			}, twirp.NotFound},
			{"a chat command's workflow", func() error {
				_, err := f.svc.AddWorkflowGroupMembers(ctx, &client.AddWorkflowGroupMembersRequest{GroupId: a, WorkflowIds: []string{command}})
				return err
			}, twirp.FailedPrecondition},
		}
		for _, tc := range refusals {
			if got := twirpCode(tc.call()); got != tc.want {
				t.Errorf("%s: code = %q, want %q", tc.name, got, tc.want)
			}
		}
		members, err := repo.NewWorkflowGroupRepository(db).MemberIDs(uuid.MustParse(a))
		if err != nil {
			t.Fatalf("members: %v", err)
		}
		if len(members) != 0 {
			t.Errorf("a refused add left members %v", members)
		}
	})
}

func TestWorkflowGroupAnnouncesOnlyChangedWorkflows(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newGroupFixture(t, db)
		on := f.workflow("on", true)
		off := f.workflow("off", false)
		a := f.group("A", on, off)
		f.clearEvents()

		f.setEnabled(a, true)

		workflowEvents := f.events("workflow")
		if len(workflowEvents) != 1 || workflowEvents[0].EntityID != off {
			t.Fatalf("workflow events = %v, want one for the workflow that went on", workflowEvents)
		}
		if workflowEvents[0].NATSSubject != "db.workflow.updated.system" {
			t.Errorf("subject = %q", workflowEvents[0].NATSSubject)
		}
		groupEvents := f.events("workflow_group")
		if len(groupEvents) != 1 || groupEvents[0].NATSSubject != "db.workflow_group.updated.system" {
			t.Fatalf("group events = %v, want one db.workflow_group.updated", groupEvents)
		}

		// Joining a group changes a workflow's group list even when its switch stays put.
		f.clearEvents()
		other := f.workflow("other", true)
		f.add(a, other)
		workflowEvents = f.events("workflow")
		if len(workflowEvents) != 1 || workflowEvents[0].EntityID != other {
			t.Errorf("workflow events after add = %v, want one for the added workflow", workflowEvents)
		}
	})
}

func TestWorkflowGroupSwitchIsAtomic(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newGroupFixture(t, db)
		x := f.workflow("x", false)
		y := f.workflow("y", false)
		a := f.group("A", x, y)
		f.clearEvents()

		// Fails the second member's write, after the first has been written.
		const failSecond = "test:fail_second_member_write"
		writes := 0
		if err := db.Callback().Update().Before("gorm:update").Register(failSecond, func(tx *gorm.DB) {
			if tx.Statement.Table == "workflow_definitions" {
				writes++
				if writes == 2 {
					// AddError hands back the error it records; recording it is what fails the write.
					_ = tx.AddError(errors.New("forced failure"))
				}
			}
		}); err != nil {
			t.Fatalf("register callback: %v", err)
		}
		_, err := f.svc.SetWorkflowGroupEnabled(context.Background(), &client.SetWorkflowGroupEnabledRequest{Id: a, Enabled: true})
		if err := db.Callback().Update().Remove(failSecond); err != nil {
			t.Fatalf("remove callback: %v", err)
		}
		if err == nil {
			t.Fatal("the switch succeeded despite a failed member write")
		}

		f.expect("x after the failure", x, false, nil)
		f.expect("y after the failure", y, false, nil)
		var group models.WorkflowGroup
		if err := db.First(&group, "id = ?", a).Error; err != nil {
			t.Fatalf("read group: %v", err)
		}
		if group.Enabled {
			t.Error("the group stayed on after a failed switch")
		}
		if n := len(f.events("workflow")) + len(f.events("workflow_group")); n != 0 {
			t.Errorf("a failed switch left %d events in the outbox", n)
		}

		f.setEnabled(a, true)
		f.expect("x after a retry", x, true, savedOff)
		f.expect("y after a retry", y, true, savedOff)
	})
}

func TestWorkflowGroupOverlappingSwitchesStayConsistent(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newGroupFixture(t, db)
		x := f.workflow("x", false)
		y := f.workflow("y", false)
		a, b := f.group("A", x, y), f.group("B", y, x)

		together := func(enabled bool) {
			t.Helper()
			var wg sync.WaitGroup
			errs := make([]error, 2)
			for i, id := range []string{a, b} {
				wg.Add(1)
				go func() {
					defer wg.Done()
					_, errs[i] = f.svc.SetWorkflowGroupEnabled(context.Background(),
						&client.SetWorkflowGroupEnabledRequest{Id: id, Enabled: enabled})
				}()
			}
			wg.Wait()
			for _, err := range errs {
				if err != nil {
					t.Fatalf("switch to %v: %v", enabled, err)
				}
			}
		}
		for round := 0; round < 10; round++ {
			together(true)
			f.expect("x with both on", x, true, savedOff)
			f.expect("y with both on", y, true, savedOff)
			together(false)
			f.expect("x with both off", x, false, nil)
			f.expect("y with both off", y, false, nil)
		}
	})
}
