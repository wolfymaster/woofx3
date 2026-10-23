package services

import (
	"context"
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// newWorkflowTestService backs the workflow service with an in-memory SQLite
// database migrated by the real SQLite chain, so the module upsert runs
// against the schema production has.
func newWorkflowTestService(t *testing.T) client.WorkflowService {
	t.Helper()
	db := openEmptySQLite(t)
	// One connection: each new :memory: connection is a separate database.
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, sqliteChain(t)).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return NewWorkflowService(repo.NewWorkflowRepository(db, database.RandomIDs{}), repo.NewCommandRepository(db), db, nil, nil)
}

func createWorkflow(t *testing.T, svc client.WorkflowService, req *client.CreateWorkflowRequest) *client.Workflow {
	t.Helper()
	if req.TriggerJson == "" {
		req.TriggerJson = `{"type":"event","event":"channel.cheer"}`
	}
	res, err := svc.CreateWorkflow(context.Background(), req)
	if err != nil {
		t.Fatalf("create workflow %q: %v", req.Name, err)
	}
	return res.Workflow
}

// Installing a module should leave it working: its bundled workflows go live
// without the streamer finding and switching on each one.
func TestCreateWorkflow_ModuleWorkflowIsEnabledOnInstall(t *testing.T) {
	svc := newWorkflowTestService(t)
	wf := createWorkflow(t, svc, &client.CreateWorkflowRequest{
		Name:          "woofx3_hype_board/Hype Board: count cheers",
		Enabled:       true,
		CreatedByType: "MODULE",
		CreatedByRef:  "woofx3_hype_board",
		ManifestId:    "count-cheers",
	})
	if !wf.Enabled {
		t.Fatal("a module's bundled workflow was created disabled")
	}
}

// A workflow someone is authoring stays inert until they switch it on, even
// if the request asks for it enabled.
func TestCreateWorkflow_UserWorkflowStartsDisabled(t *testing.T) {
	svc := newWorkflowTestService(t)
	wf := createWorkflow(t, svc, &client.CreateWorkflowRequest{
		Name:    "my cheer alert",
		Enabled: true,
	})
	if wf.Enabled {
		t.Fatal("a user-authored workflow was created enabled")
	}
}

// Upgrading a module registers its workflows again. A streamer who switched
// one off must not find it back on after the upgrade.
func TestCreateWorkflow_ModuleUpgradeKeepsStreamersToggle(t *testing.T) {
	svc := newWorkflowTestService(t)
	register := func() *client.Workflow {
		return createWorkflow(t, svc, &client.CreateWorkflowRequest{
			Name:          "woofx3_hype_board/Hype Board: count cheers",
			Enabled:       true,
			CreatedByType: "MODULE",
			CreatedByRef:  "woofx3_hype_board",
			ManifestId:    "count-cheers",
		})
	}
	first := register()
	off := false
	if _, err := svc.UpdateWorkflow(context.Background(), &client.UpdateWorkflowRequest{
		Id:      first.Id,
		Enabled: &off,
	}); err != nil {
		t.Fatalf("switch workflow off: %v", err)
	}

	second := register()
	if second.Id != first.Id {
		t.Fatalf("upgrade duplicated the workflow: %s -> %s", first.Id, second.Id)
	}
	if second.Enabled {
		t.Fatal("the upgrade reported the workflow enabled while the stored row stays disabled")
	}
	got, err := svc.GetWorkflow(context.Background(), &client.GetWorkflowRequest{Id: first.Id})
	if err != nil {
		t.Fatalf("get workflow: %v", err)
	}
	if got.Workflow.Enabled {
		t.Fatal("a module upgrade switched the streamer's disabled workflow back on")
	}
}
