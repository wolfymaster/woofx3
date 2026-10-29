package services

import (
	"context"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// newWorkflowTestService backs the workflow service with an in-memory SQLite
// database migrated by the real SQLite chain, so the module upsert runs
// against the schema production has.
func newWorkflowTestService(t *testing.T) (client.WorkflowService, *gorm.DB) {
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
	return NewWorkflowService(repo.NewWorkflowRepository(db, database.RandomIDs{}), repo.NewCommandRepository(db), db, nil, nil), db
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
	svc, _ := newWorkflowTestService(t)
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
	svc, _ := newWorkflowTestService(t)
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
	svc, _ := newWorkflowTestService(t)
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

func backdateWorkflow(t *testing.T, db *gorm.DB, id string, at time.Time) {
	t.Helper()
	err := db.Model(&models.WorkflowDefinition{}).
		Where("id = ?", id).
		UpdateColumns(map[string]any{"created_at": at, "updated_at": at}).Error
	if err != nil {
		t.Fatalf("backdate workflow: %v", err)
	}
}

func getWorkflow(t *testing.T, svc client.WorkflowService, id string) *client.Workflow {
	t.Helper()
	resp, err := svc.GetWorkflow(context.Background(), &client.GetWorkflowRequest{Id: id})
	if err != nil {
		t.Fatalf("get workflow: %v", err)
	}
	return resp.Workflow
}

// A workflow reports when it was made and last written, and a write moves only
// the second, so a reader can tell a newer copy of a workflow from an older one.
func TestWorkflowService_ReportsWhenAWorkflowWasMadeAndLastWritten(t *testing.T) {
	svc, db := newWorkflowTestService(t)
	created := createWorkflow(t, svc, &client.CreateWorkflowRequest{Name: "my cheer alert"})
	earlier := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	backdateWorkflow(t, db, created.Id, earlier)

	before := getWorkflow(t, svc, created.Id)
	if !before.CreatedAt.AsTime().Equal(earlier) || !before.UpdatedAt.AsTime().Equal(earlier) {
		t.Fatalf("times not reported: created %v, updated %v", before.CreatedAt.AsTime(), before.UpdatedAt.AsTime())
	}

	if _, err := svc.UpdateWorkflow(context.Background(), &client.UpdateWorkflowRequest{Id: created.Id, Name: "renamed"}); err != nil {
		t.Fatalf("update workflow: %v", err)
	}
	after := getWorkflow(t, svc, created.Id)
	if !after.CreatedAt.AsTime().Equal(earlier) {
		t.Fatalf("a write moved the creation time to %v", after.CreatedAt.AsTime())
	}
	if !after.UpdatedAt.AsTime().After(earlier) {
		t.Fatalf("a write left the update time at %v", after.UpdatedAt.AsTime())
	}
}

// A module's workflows are written by an upsert in raw SQL, which gorm does not
// stamp, so the upsert keeps the times itself.
func TestWorkflowService_ModuleReinstallMovesOnlyTheUpdateTime(t *testing.T) {
	svc, db := newWorkflowTestService(t)
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
	if first.CreatedAt.AsTime().IsZero() || first.UpdatedAt.AsTime().IsZero() {
		t.Fatalf("install reported no times: created %v, updated %v", first.CreatedAt.AsTime(), first.UpdatedAt.AsTime())
	}
	earlier := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	backdateWorkflow(t, db, first.Id, earlier)

	second := register()
	if !second.CreatedAt.AsTime().Equal(earlier) {
		t.Fatalf("a reinstall moved the creation time to %v", second.CreatedAt.AsTime())
	}
	if !second.UpdatedAt.AsTime().After(earlier) {
		t.Fatalf("a reinstall left the update time at %v", second.UpdatedAt.AsTime())
	}
	stored := getWorkflow(t, svc, first.Id)
	if !stored.UpdatedAt.AsTime().Equal(second.UpdatedAt.AsTime()) {
		t.Fatalf("reinstall reported update time %v, row holds %v", second.UpdatedAt.AsTime(), stored.UpdatedAt.AsTime())
	}
}

func TestBuildWorkflowChangeData_CarriesTheWorkflowsTimes(t *testing.T) {
	created := time.Date(2026, 1, 2, 3, 4, 5, 600, time.UTC)
	updated := created.Add(time.Hour)
	data := buildWorkflowChangeData(&models.WorkflowDefinition{ID: uuid.New(), CreatedAt: created, UpdatedAt: updated})
	if data["created_at"] != "2026-01-02T03:04:05.0000006Z" || data["updated_at"] != "2026-01-02T04:04:05.0000006Z" {
		t.Fatalf("times not carried: %v, %v", data["created_at"], data["updated_at"])
	}
}
