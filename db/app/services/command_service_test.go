package services

import (
	"context"
	"errors"
	"testing"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func builtInGroupIDs(t *testing.T, f *commandPermFixture, names ...string) []string {
	t.Helper()
	ids := make([]string, len(names))
	for i, name := range names {
		group, err := f.groupRepo.GetByName(name)
		if err != nil {
			t.Fatalf("get %s group: %v", name, err)
		}
		ids[i] = group.ID.String()
	}
	return ids
}

func assertInvalidArgument(t *testing.T, err error, argument string) {
	t.Helper()
	var twerr twirp.Error
	if !errors.As(err, &twerr) {
		t.Fatalf("expected a twirp error, got %v", err)
	}
	if twerr.Code() != twirp.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %s: %s", twerr.Code(), twerr.Msg())
	}
	if twerr.Meta("argument") != argument {
		t.Fatalf("expected the %q argument to be refused, got %q", argument, twerr.Meta("argument"))
	}
}

func TestCreateCommand_RefusesUnknownVisibility(t *testing.T) {
	f := newCommandPermFixture(t)
	for _, visibility := range []string{"Public", "private", "everyone", " restricted"} {
		t.Run(visibility, func(t *testing.T) {
			_, err := f.svc.CreateCommand(context.Background(), &client.CreateCommandRequest{
				Command:     "song",
				ActionsJson: "[]",
				Enabled:     true,
				Visibility:  visibility,
			})
			assertInvalidArgument(t, err, "visibility")
		})
	}

	all, err := f.svc.ListCommands(context.Background(), &client.ListCommandsRequest{})
	if err != nil {
		t.Fatalf("list commands: %v", err)
	}
	if len(all.Commands) != 0 {
		t.Fatalf("a refused create stored %d command(s)", len(all.Commands))
	}
}

func TestUpdateCommand_RefusesUnknownVisibility(t *testing.T) {
	f := newCommandPermFixture(t)
	f.createCommand(t, "song", nil, nil)
	cmd, err := repository.NewCommandRepository(f.db).GetByCommand("song")
	if err != nil {
		t.Fatalf("get command: %v", err)
	}

	_, err = f.svc.UpdateCommand(context.Background(), &client.UpdateCommandRequest{
		Id:          cmd.ID.String(),
		Command:     "song",
		Enabled:     true,
		Visibility:  "everyone",
		ActionsJson: "",
	})
	assertInvalidArgument(t, err, "visibility")

	stored, err := repository.NewCommandRepository(f.db).GetByCommand("song")
	if err != nil {
		t.Fatalf("get command: %v", err)
	}
	if stored.Visibility != models.CommandVisibilityRestricted {
		t.Fatalf("a refused update changed visibility to %q", stored.Visibility)
	}
}

// A module command declaring requiredRole moderator registers restricted to
// the moderator and broadcaster groups (barkloader resolves the role to those
// group ids). A moderator gets through; a viewer does not.
func TestCreateCommand_ModuleRoleGrantAdmitsOnlyThatRole(t *testing.T) {
	f := newCommandPermFixture(t)
	groupIDs := builtInGroupIDs(t, f, models.GroupModerator, models.GroupBroadcaster)
	if _, err := f.svc.CreateCommand(context.Background(), &client.CreateCommandRequest{
		Command:       "vanish",
		ActionsJson:   "[]",
		Enabled:       true,
		CreatedByType: "MODULE",
		CreatedByRef:  "modtools",
		Visibility:    string(models.CommandVisibilityRestricted),
		GroupIds:      groupIDs,
	}); err != nil {
		t.Fatalf("register module command: %v", err)
	}
	if _, err := f.groupSvc.AddUserToGroup(context.Background(), &client.GroupMembershipRequest{
		GroupId:  groupIDs[0],
		Username: "trustedmod",
	}); err != nil {
		t.Fatalf("add moderator: %v", err)
	}

	if !f.can(t, "trustedmod", "vanish") {
		t.Fatal("a moderator must be allowed a moderator command")
	}
	if f.can(t, "randomchatter", "vanish") {
		t.Fatal("a viewer must be denied a moderator command")
	}
}

// Re-registering a module command on reinstall must not touch the grants the
// streamer set, even when the manifest now asks for different access.
func TestCreateCommand_ModuleReRegistrationKeepsStreamerGrants(t *testing.T) {
	f := newCommandPermFixture(t)
	register := func(visibility models.CommandVisibility, groupIDs []string) *client.Command {
		t.Helper()
		res, err := f.svc.CreateCommand(context.Background(), &client.CreateCommandRequest{
			Command:       "vanish",
			ActionsJson:   "[]",
			Enabled:       true,
			CreatedByType: "MODULE",
			CreatedByRef:  "modtools",
			Visibility:    string(visibility),
			GroupIds:      groupIDs,
		})
		if err != nil {
			t.Fatalf("register module command: %v", err)
		}
		return res.Command
	}

	first := register(models.CommandVisibilityPublic, nil)
	vips := builtInGroupIDs(t, f, models.GroupVIP)
	if _, err := f.svc.UpdateCommand(context.Background(), &client.UpdateCommandRequest{
		Id:         first.Id,
		Command:    "vanish",
		Enabled:    true,
		Visibility: string(models.CommandVisibilityRestricted),
		GroupIds:   vips,
	}); err != nil {
		t.Fatalf("streamer edit: %v", err)
	}

	second := register(models.CommandVisibilityPublic, nil)
	if second.Visibility != string(models.CommandVisibilityRestricted) {
		t.Fatalf("re-registration reset visibility to %q", second.Visibility)
	}
	if len(second.GroupIds) != 1 || second.GroupIds[0] != vips[0] {
		t.Fatalf("re-registration replaced the streamer's grants: %v", second.GroupIds)
	}
	if f.can(t, "randomchatter", "vanish") {
		t.Fatal("re-registration reopened a command the streamer restricted")
	}
}
