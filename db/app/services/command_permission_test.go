package services

import (
	"context"
	"testing"

	"github.com/casbin/casbin/v2"
	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

type commandPermFixture struct {
	svc       *commandService
	groupSvc  *groupService
	enforcer  *casbin.Enforcer
	groupRepo *repository.GroupRepository
	db        *gorm.DB
	appID     uuid.UUID
}

func newCommandPermFixture(t *testing.T) *commandPermFixture {
	t.Helper()
	db := newTestDB(t)
	app := &models.Application{ID: uuid.New(), Name: "default", IsDefault: true, UserID: uuid.New()}
	if err := db.Create(app).Error; err != nil {
		t.Fatalf("seed application: %v", err)
	}
	enforcer := newTestEnforcer(t, db)
	groupRepo := repository.NewGroupRepository(db)
	permissionRepo := repository.NewPermissionRepository(db)

	if err := SeedBuiltInGroups(groupRepo, app.ID); err != nil {
		t.Fatalf("seed built-in groups: %v", err)
	}

	return &commandPermFixture{
		svc: NewCommandService(
			repository.NewCommandRepository(db),
			nil,
			repository.NewCommandPermissionRepository(db),
			permissionRepo,
			groupRepo,
			enforcer,
		),
		groupSvc:  NewGroupService(groupRepo, permissionRepo, enforcer),
		enforcer:  enforcer,
		groupRepo: groupRepo,
		db:        db,
		appID:     app.ID,
	}
}

// can mirrors exactly what both enforcement paths ask Casbin.
func (f *commandPermFixture) can(t *testing.T, username, command string) bool {
	t.Helper()
	ok, err := f.enforcer.Enforce(username, "command/"+command, "read")
	if err != nil {
		t.Fatalf("enforce: %v", err)
	}
	return ok
}

func (f *commandPermFixture) createCommand(t *testing.T, name string, groupIDs, usernames []string) {
	t.Helper()
	_, err := f.svc.CreateCommand(context.Background(), &client.CreateCommandRequest{
		ApplicationId: f.appID.String(),
		Command:       name,
		Type:          "text",
		TypeValue:     "hello",
		Enabled:       true,
		GroupIds:      groupIDs,
		Usernames:     usernames,
	})
	if err != nil {
		t.Fatalf("create command %q: %v", name, err)
	}
}

// A command with no group and no user grant must stay usable by everyone.
// `visibility` defaults to "restricted", so this is the ordinary case for every
// command that predates group binding - regressing it would silently break the
// whole chat surface.
func TestCommandPermissions_NoGrantsMeansUnrestricted(t *testing.T) {
	f := newCommandPermFixture(t)
	f.createCommand(t, "song", nil, nil)

	if !f.can(t, "randomchatter", "song") {
		t.Fatal("a command with no grants must be usable by any user")
	}
	if !f.can(t, "someoneelse", "song") {
		t.Fatal("a command with no grants must be usable by any user")
	}
}

func TestCommandPermissions_GroupGrantDeniesNonMembers(t *testing.T) {
	f := newCommandPermFixture(t)

	mods, err := f.groupRepo.GetByName(f.appID, models.GroupModerator)
	if err != nil {
		t.Fatalf("get moderator group: %v", err)
	}
	f.createCommand(t, "vanish", []string{mods.ID.String()}, nil)

	if f.can(t, "randomchatter", "vanish") {
		t.Fatal("a non-member must be denied a group-restricted command")
	}

	if _, err := f.groupSvc.AddUserToGroup(context.Background(), &client.GroupMembershipRequest{
		ApplicationId: f.appID.String(),
		GroupId:       mods.ID.String(),
		Username:      "trustedmod",
	}); err != nil {
		t.Fatalf("add member: %v", err)
	}
	if !f.can(t, "trustedmod", "vanish") {
		t.Fatal("a group member must be allowed")
	}
	if f.can(t, "randomchatter", "vanish") {
		t.Fatal("a non-member must still be denied after another user joins")
	}
}

func TestCommandPermissions_UserGrantDeniesOthers(t *testing.T) {
	f := newCommandPermFixture(t)
	f.createCommand(t, "secret", nil, []string{"wolfymaster"})

	if !f.can(t, "wolfymaster", "secret") {
		t.Fatal("the granted user must be allowed")
	}
	if f.can(t, "intruder", "secret") {
		t.Fatal("a user without a grant must be denied")
	}
}

// The built-in "everyone" group carries no membership rows by design, so a
// grant to it has to resolve through the wildcard subject instead.
func TestCommandPermissions_EveryoneGroupAllowsAnyUser(t *testing.T) {
	f := newCommandPermFixture(t)

	everyone, err := f.groupRepo.GetByName(f.appID, models.GroupEveryone)
	if err != nil {
		t.Fatalf("get everyone group: %v", err)
	}
	f.createCommand(t, "hello", []string{everyone.ID.String()}, nil)

	if !f.can(t, "anybody", "hello") {
		t.Fatal("a grant to the everyone group must allow any user")
	}

	var wildcardRows int64
	if err := f.db.Model(&models.Permission{}).
		Where("ptype = 'p' AND v0 = ? AND v1 = ?", models.WildcardSubject, "command/hello").
		Count(&wildcardRows).Error; err != nil {
		t.Fatalf("count wildcard rows: %v", err)
	}
	if wildcardRows != 1 {
		t.Fatalf("expected the everyone grant to collapse to one wildcard row, got %d", wildcardRows)
	}
}

func TestCommandPermissions_PublicVisibilitySkipsPolicy(t *testing.T) {
	f := newCommandPermFixture(t)
	_, err := f.svc.CreateCommand(context.Background(), &client.CreateCommandRequest{
		ApplicationId: f.appID.String(),
		Command:       "uptime",
		Type:          "text",
		Enabled:       true,
		Visibility:    commandVisibilityPublic,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Public commands never get policy rows at all; the service short-circuits
	// before consulting Casbin.
	var rows int64
	if err := f.db.Model(&models.Permission{}).
		Where("ptype = 'p' AND v1 = ?", "command/uptime").
		Count(&rows).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 0 {
		t.Fatalf("expected no policy rows for a public command, got %d", rows)
	}
}

// Removing every grant from a previously restricted command must return it to
// the unrestricted state rather than leaving it denied for everyone.
func TestCommandPermissions_ClearingGrantsRestoresUnrestricted(t *testing.T) {
	f := newCommandPermFixture(t)

	mods, err := f.groupRepo.GetByName(f.appID, models.GroupModerator)
	if err != nil {
		t.Fatalf("get moderator group: %v", err)
	}
	f.createCommand(t, "vanish", []string{mods.ID.String()}, nil)
	if f.can(t, "randomchatter", "vanish") {
		t.Fatal("precondition: non-member should be denied")
	}

	cmd, err := repository.NewCommandRepository(f.db).GetByCommand("vanish", f.appID)
	if err != nil {
		t.Fatalf("get command: %v", err)
	}
	if _, err := f.svc.UpdateCommand(context.Background(), &client.UpdateCommandRequest{
		Id:      cmd.ID.String(),
		Command: "vanish",
		Type:    "text",
		Enabled: true,
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	if !f.can(t, "randomchatter", "vanish") {
		t.Fatal("clearing all grants must restore the unrestricted state")
	}
}

// A rename must not leave the old object's rules behind, or the old name would
// stay authorised forever.
func TestCommandPermissions_RenameMovesPolicy(t *testing.T) {
	f := newCommandPermFixture(t)

	mods, err := f.groupRepo.GetByName(f.appID, models.GroupModerator)
	if err != nil {
		t.Fatalf("get moderator group: %v", err)
	}
	f.createCommand(t, "vanish", []string{mods.ID.String()}, nil)

	cmd, err := repository.NewCommandRepository(f.db).GetByCommand("vanish", f.appID)
	if err != nil {
		t.Fatalf("get command: %v", err)
	}
	if _, err := f.svc.UpdateCommand(context.Background(), &client.UpdateCommandRequest{
		Id:       cmd.ID.String(),
		Command:  "poof",
		Type:     "text",
		Enabled:  true,
		GroupIds: []string{mods.ID.String()},
	}); err != nil {
		t.Fatalf("rename: %v", err)
	}

	var oldRows int64
	if err := f.db.Model(&models.Permission{}).
		Where("ptype = 'p' AND v1 = ?", "command/vanish").
		Count(&oldRows).Error; err != nil {
		t.Fatalf("count old rows: %v", err)
	}
	if oldRows != 0 {
		t.Fatalf("expected the old command name's rules to be cleared, got %d", oldRows)
	}
}

func TestPermissionService_ListPermissions(t *testing.T) {
	f := newCommandPermFixture(t)
	ctx := context.Background()

	mods, err := f.groupRepo.GetByName(f.appID, models.GroupModerator)
	if err != nil {
		t.Fatalf("get moderator group: %v", err)
	}
	f.createCommand(t, "vanish", []string{mods.ID.String()}, nil)
	if _, err := f.groupSvc.AddUserToGroup(ctx, &client.GroupMembershipRequest{
		ApplicationId: f.appID.String(),
		GroupId:       mods.ID.String(),
		Username:      "trustedmod",
	}); err != nil {
		t.Fatalf("add member: %v", err)
	}

	svc := NewPermissionService(nil, repository.NewPermissionRepository(f.db), f.enforcer)

	all, err := svc.ListPermissions(ctx, &client.ListPermissionsRequest{ApplicationId: f.appID.String()})
	if err != nil {
		t.Fatalf("list all: %v", err)
	}
	if len(all.Permissions) == 0 {
		t.Fatal("expected stored rules to be listed")
	}

	policies, err := svc.ListPermissions(ctx, &client.ListPermissionsRequest{
		ApplicationId: f.appID.String(),
		Ptype:         "p",
	})
	if err != nil {
		t.Fatalf("list policies: %v", err)
	}
	for _, p := range policies.Permissions {
		if p.Ptype != "p" {
			t.Fatalf("ptype filter leaked a %q rule", p.Ptype)
		}
	}

	forUser, err := svc.ListPermissions(ctx, &client.ListPermissionsRequest{
		ApplicationId: f.appID.String(),
		Subject:       "trustedmod",
	})
	if err != nil {
		t.Fatalf("list for subject: %v", err)
	}
	if len(forUser.Permissions) != 1 {
		t.Fatalf("expected 1 rule for trustedmod, got %d", len(forUser.Permissions))
	}
	if forUser.Permissions[0].V1 != "group:"+mods.ID.String() {
		t.Fatalf("expected the moderator grouping row, got %+v", forUser.Permissions[0])
	}
}
