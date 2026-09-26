package services

import (
	"context"
	"testing"

	client "github.com/wolfymaster/woofx3/clients/db"
)

func registerModuleCommand(t *testing.T, f *commandPermFixture, moduleID, name, actionsJSON string) *client.Command {
	t.Helper()
	res, err := f.svc.CreateCommand(context.Background(), &client.CreateCommandRequest{
		Command:       name,
		ActionsJson:   actionsJSON,
		Enabled:       true,
		CreatedByType: "MODULE",
		CreatedByRef:  moduleID,
	})
	if err != nil {
		t.Fatalf("register module command %q: %v", name, err)
	}
	return res.Command
}

// Reinstalling a module registers its commands again. The streamer may have
// edited the command since, so the second registration must hand back the row
// they edited rather than insert a fresh copy of the manifest default.
func TestCreateCommand_ModuleReRegistrationKeepsExistingRow(t *testing.T) {
	f := newCommandPermFixture(t)
	manifestDefault := `[{"id":"action-1","type":"workflow","workflow":{"workflowId":"spotify:workflow:sr"}}]`
	first := registerModuleCommand(t, f, "spotify", "sr", manifestDefault)

	edited := `[{"id":"action-1","action":"function","function":"spotify:function:song_request"}]`
	if _, err := f.svc.UpdateCommand(context.Background(), &client.UpdateCommandRequest{
		Id:          first.Id,
		Command:     "sr",
		ActionsJson: edited,
		Cooldown:    30,
		Enabled:     true,
	}); err != nil {
		t.Fatalf("update command: %v", err)
	}

	second := registerModuleCommand(t, f, "spotify", "sr", manifestDefault)
	if second.Id != first.Id {
		t.Fatalf("re-registration changed the command id: %s -> %s", first.Id, second.Id)
	}
	if second.ActionsJson != edited || second.Cooldown != 30 {
		t.Fatalf("re-registration overwrote the streamer's edits: actions=%s cooldown=%d", second.ActionsJson, second.Cooldown)
	}

	all, err := f.svc.ListCommands(context.Background(), &client.ListCommandsRequest{})
	if err != nil {
		t.Fatalf("list commands: %v", err)
	}
	if len(all.Commands) != 1 {
		t.Fatalf("expected one command after re-registration, got %d", len(all.Commands))
	}
}

// Only a module's own registration is adopted. A streamer's command that
// happens to share the name is a different command.
func TestCreateCommand_UserCommandWithSameNameIsNotAdopted(t *testing.T) {
	f := newCommandPermFixture(t)
	f.createCommand(t, "sr", nil, nil)

	moduleCmd := registerModuleCommand(t, f, "spotify", "sr", "[]")
	if moduleCmd.CreatedByType != "MODULE" {
		t.Fatalf("module registration adopted the streamer's command: created_by_type=%s", moduleCmd.CreatedByType)
	}
}
