package services

import (
	"context"
	"testing"

	"github.com/casbin/casbin/v2"
	casbinmodel "github.com/casbin/casbin/v2/model"
	gormadapter "github.com/casbin/gorm-adapter/v3"
	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/config"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// newTestEnforcer builds a Casbin enforcer over the same production model
// string and the same gorm-backed `permissions` table the real service uses
// (see db/app.go), so enforcement tests exercise the actual policy rows the
// services write rather than a hand-built fixture.
func newTestEnforcer(t *testing.T, db *gorm.DB) *casbin.Enforcer {
	t.Helper()
	modelStr, err := config.GetCasbinModelString()
	if err != nil {
		t.Fatalf("casbin model: %v", err)
	}
	m, err := casbinmodel.NewModelFromString(modelStr)
	if err != nil {
		t.Fatalf("parse casbin model: %v", err)
	}
	// The adapter creates `permissions` itself; its sqlite DDL parser only
	// understands the shape gorm's own AutoMigrate emits, so the test schema
	// deliberately does not pre-create the table. application_id is this
	// project's addition and is invisible to (and unused by) the adapter.
	adapter, err := gormadapter.NewAdapterByDBUseTableName(db, "", "permissions")
	if err != nil {
		t.Fatalf("casbin adapter: %v", err)
	}
	if err := db.Exec(`ALTER TABLE permissions ADD COLUMN application_id TEXT NOT NULL DEFAULT ''`).Error; err != nil {
		t.Fatalf("add application_id: %v", err)
	}
	e, err := casbin.NewEnforcer(m, adapter)
	if err != nil {
		t.Fatalf("new enforcer: %v", err)
	}
	return e
}

func newGroupSvc(t *testing.T) (*groupService, *gorm.DB, uuid.UUID) {
	t.Helper()
	db := newTestDB(t)
	app := &models.Application{ID: uuid.New(), Name: "default", IsDefault: true, UserID: uuid.New()}
	if err := db.Create(app).Error; err != nil {
		t.Fatalf("seed application: %v", err)
	}
	svc := NewGroupService(
		repository.NewGroupRepository(db),
		repository.NewPermissionRepository(db),
		newTestEnforcer(t, db),
	)
	return svc, db, app.ID
}

func TestGroupService_CRUD(t *testing.T) {
	svc, _, appID := newGroupSvc(t)
	ctx := context.Background()

	created, err := svc.CreateGroup(ctx, &client.CreateGroupRequest{
		ApplicationId: appID.String(),
		Name:          "regulars",
		Description:   "long-time chatters",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Group.Name != "regulars" {
		t.Fatalf("expected name regulars, got %q", created.Group.Name)
	}
	if created.Group.IsBuiltIn {
		t.Fatal("a hand-created group must not be marked built-in")
	}

	updated, err := svc.UpdateGroup(ctx, &client.UpdateGroupRequest{
		Id:          created.Group.Id,
		Name:        "veterans",
		Description: "renamed",
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Group.Name != "veterans" {
		t.Fatalf("expected rename to veterans, got %q", updated.Group.Name)
	}

	listed, err := svc.ListGroups(ctx, &client.ListGroupsRequest{ApplicationId: appID.String()})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed.Groups) != 1 {
		t.Fatalf("expected 1 group, got %d", len(listed.Groups))
	}

	if _, err := svc.DeleteGroup(ctx, &client.DeleteGroupRequest{Id: created.Group.Id}); err != nil {
		t.Fatalf("delete: %v", err)
	}
	listed, err = svc.ListGroups(ctx, &client.ListGroupsRequest{ApplicationId: appID.String()})
	if err != nil {
		t.Fatalf("list after delete: %v", err)
	}
	if len(listed.Groups) != 0 {
		t.Fatalf("expected 0 groups after delete, got %d", len(listed.Groups))
	}
}

func TestGroupService_Membership(t *testing.T) {
	svc, db, appID := newGroupSvc(t)
	ctx := context.Background()

	created, err := svc.CreateGroup(ctx, &client.CreateGroupRequest{
		ApplicationId: appID.String(),
		Name:          "regulars",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Usernames are normalised to lowercase on the way in so the chat pipeline
	// and the management UI cannot disagree about identity.
	if _, err := svc.AddUserToGroup(ctx, &client.GroupMembershipRequest{
		ApplicationId: appID.String(),
		GroupId:       created.Group.Id,
		Username:      "  WolfyMaster  ",
	}); err != nil {
		t.Fatalf("add member: %v", err)
	}

	members, err := svc.ListGroupMembers(ctx, &client.ListGroupMembersRequest{GroupId: created.Group.Id})
	if err != nil {
		t.Fatalf("list members: %v", err)
	}
	if len(members.Usernames) != 1 || members.Usernames[0] != "wolfymaster" {
		t.Fatalf("expected [wolfymaster], got %v", members.Usernames)
	}

	// Membership must also be mirrored into the Casbin grouping rows, since
	// that is what the enforcer actually reads.
	var casbinRows int64
	if err := db.Model(&models.Permission{}).
		Where("ptype = 'g' AND v0 = ? AND v1 = ?", "wolfymaster", "group:"+created.Group.Id).
		Count(&casbinRows).Error; err != nil {
		t.Fatalf("count casbin rows: %v", err)
	}
	if casbinRows != 1 {
		t.Fatalf("expected 1 casbin grouping row, got %d", casbinRows)
	}

	forUser, err := svc.ListUserGroupsForUser(ctx, &client.ListUserGroupsForUserRequest{
		ApplicationId: appID.String(),
		Username:      "WOLFYMASTER",
	})
	if err != nil {
		t.Fatalf("list groups for user: %v", err)
	}
	if len(forUser.Groups) != 1 {
		t.Fatalf("expected 1 group for user, got %d", len(forUser.Groups))
	}

	if _, err := svc.RemoveUserFromGroup(ctx, &client.GroupMembershipRequest{
		ApplicationId: appID.String(),
		GroupId:       created.Group.Id,
		Username:      "wolfymaster",
	}); err != nil {
		t.Fatalf("remove member: %v", err)
	}
	members, err = svc.ListGroupMembers(ctx, &client.ListGroupMembersRequest{GroupId: created.Group.Id})
	if err != nil {
		t.Fatalf("list members after remove: %v", err)
	}
	if len(members.Usernames) != 0 {
		t.Fatalf("expected no members, got %v", members.Usernames)
	}
}

func TestSeedBuiltInGroups_CreatesCatalogIdempotently(t *testing.T) {
	_, db, appID := newGroupSvc(t)
	groupRepo := repository.NewGroupRepository(db)

	for range 2 {
		if err := SeedBuiltInGroups(groupRepo, appID); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	groups, err := groupRepo.GetByApplicationID(appID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(groups) != len(models.BuiltInGroups) {
		t.Fatalf("expected %d built-in groups, got %d", len(models.BuiltInGroups), len(groups))
	}
	byName := make(map[string]models.Group, len(groups))
	for _, g := range groups {
		byName[g.Name] = g
	}
	for _, want := range models.BuiltInGroups {
		got, ok := byName[want.Name]
		if !ok {
			t.Fatalf("missing built-in group %q", want.Name)
		}
		if !got.IsBuiltIn {
			t.Fatalf("group %q should be marked built-in", want.Name)
		}
	}
}

func TestSeedBuiltInGroups_PromotesExistingSameNamedGroup(t *testing.T) {
	svc, db, appID := newGroupSvc(t)
	ctx := context.Background()
	groupRepo := repository.NewGroupRepository(db)

	// An operator who hand-made a "moderator" group before upgrading must keep
	// it (and its membership) rather than get a duplicate or an error.
	existing, err := svc.CreateGroup(ctx, &client.CreateGroupRequest{
		ApplicationId: appID.String(),
		Name:          models.GroupModerator,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.AddUserToGroup(ctx, &client.GroupMembershipRequest{
		ApplicationId: appID.String(),
		GroupId:       existing.Group.Id,
		Username:      "existingmod",
	}); err != nil {
		t.Fatalf("add member: %v", err)
	}

	if err := SeedBuiltInGroups(groupRepo, appID); err != nil {
		t.Fatalf("seed: %v", err)
	}

	groups, err := groupRepo.GetByApplicationID(appID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(groups) != len(models.BuiltInGroups) {
		t.Fatalf("expected no duplicate, got %d groups", len(groups))
	}

	promoted, err := groupRepo.GetByName(appID, models.GroupModerator)
	if err != nil {
		t.Fatalf("get moderator: %v", err)
	}
	if promoted.ID.String() != existing.Group.Id {
		t.Fatalf("expected the existing group to be promoted, got a different id")
	}
	if !promoted.IsBuiltIn {
		t.Fatal("promoted group should be marked built-in")
	}
	members, err := groupRepo.ListMembers(promoted.ID)
	if err != nil {
		t.Fatalf("list members: %v", err)
	}
	if len(members) != 1 || members[0] != "existingmod" {
		t.Fatalf("expected membership preserved, got %v", members)
	}
}

func TestGroupService_BuiltInCannotBeDeletedOrRenamed(t *testing.T) {
	svc, db, appID := newGroupSvc(t)
	ctx := context.Background()
	groupRepo := repository.NewGroupRepository(db)

	if err := SeedBuiltInGroups(groupRepo, appID); err != nil {
		t.Fatalf("seed: %v", err)
	}
	moderator, err := groupRepo.GetByName(appID, models.GroupModerator)
	if err != nil {
		t.Fatalf("get moderator: %v", err)
	}

	if _, err := svc.DeleteGroup(ctx, &client.DeleteGroupRequest{Id: moderator.ID.String()}); err == nil {
		t.Fatal("expected deleting a built-in group to be refused")
	}
	if _, err := groupRepo.GetByName(appID, models.GroupModerator); err != nil {
		t.Fatalf("built-in group should still exist: %v", err)
	}

	if _, err := svc.UpdateGroup(ctx, &client.UpdateGroupRequest{
		Id:   moderator.ID.String(),
		Name: "mods",
	}); err == nil {
		t.Fatal("expected renaming a built-in group to be refused")
	}

	// The description remains editable - only the identity is frozen.
	updated, err := svc.UpdateGroup(ctx, &client.UpdateGroupRequest{
		Id:          moderator.ID.String(),
		Name:        models.GroupModerator,
		Description: "channel mods",
	})
	if err != nil {
		t.Fatalf("expected description edit to be allowed: %v", err)
	}
	if updated.Group.Description != "channel mods" {
		t.Fatalf("expected description update, got %q", updated.Group.Description)
	}
	if updated.Group.Name != models.GroupModerator {
		t.Fatalf("expected name unchanged, got %q", updated.Group.Name)
	}
}

func TestApplicationService_CreateApplication_SeedsBuiltInGroups(t *testing.T) {
	db := newTestDB(t)
	groupRepo := repository.NewGroupRepository(db)
	svc := NewApplicationService(repository.NewApplicationRepository(db), groupRepo)

	resp, err := svc.CreateApplication(context.Background(), &client.CreateApplicationRequest{
		Name:    "app",
		OwnerId: uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("create application: %v", err)
	}
	appID, err := uuid.Parse(resp.Application.Id)
	if err != nil {
		t.Fatalf("parse app id: %v", err)
	}

	groups, err := groupRepo.GetByApplicationID(appID)
	if err != nil {
		t.Fatalf("list groups: %v", err)
	}
	if len(groups) != len(models.BuiltInGroups) {
		t.Fatalf("expected %d seeded groups, got %d", len(models.BuiltInGroups), len(groups))
	}
	for _, g := range groups {
		if !g.IsBuiltIn {
			t.Fatalf("seeded group %q must be built-in", g.Name)
		}
		if !models.IsBuiltInGroupName(g.Name) {
			t.Fatalf("unexpected seeded group %q", g.Name)
		}
	}
}
