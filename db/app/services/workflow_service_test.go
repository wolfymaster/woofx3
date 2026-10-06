package services

import (
	"context"
	"testing"

	"github.com/libtnb/sqlite"
	"gorm.io/gorm"

	client "github.com/wolfymaster/woofx3/clients/db"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// newWorkflowTestService backs the workflow service with an in-memory SQLite
// table. The module upsert names `public.workflow_definitions`, so the table
// lives in an attached `public` schema, which unqualified names also resolve
// to.
func newWorkflowTestService(t *testing.T) client.WorkflowService {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// One connection: each new :memory: connection is a separate database.
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	stmts := []string{
		`ATTACH DATABASE ':memory:' AS public`,
		`CREATE TABLE public.workflow_definitions (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			steps TEXT,
			trigger TEXT,
			created_by_type TEXT NOT NULL DEFAULT 'USER',
			created_by_ref TEXT NOT NULL DEFAULT '',
			manifest_id TEXT NOT NULL DEFAULT '',
			taxonomy TEXT NOT NULL DEFAULT '[]',
			enabled BOOLEAN NOT NULL DEFAULT 0
		)`,
		`CREATE UNIQUE INDEX public.idx_workflow_definitions_module_manifest
			ON workflow_definitions (created_by_type, created_by_ref, manifest_id)
			WHERE manifest_id <> ''`,
	}
	for _, stmt := range stmts {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatalf("schema: %v", err)
		}
	}
	return NewWorkflowService(repo.NewWorkflowRepository(db), db, nil, nil)
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
	got, err := svc.GetWorkflow(context.Background(), &client.GetWorkflowRequest{Id: first.Id})
	if err != nil {
		t.Fatalf("get workflow: %v", err)
	}
	if got.Workflow.Enabled {
		t.Fatal("a module upgrade switched the streamer's disabled workflow back on")
	}
}
