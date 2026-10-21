package services

import (
	"context"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

func newModuleSvc(t *testing.T) (*moduleService, *gorm.DB) {
	t.Helper()
	db := openEmptySQLite(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// Every connection to :memory: is a separate database.
	sqlDB.SetMaxOpenConns(1)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, sqliteChain(t)).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	svc := NewModuleService(
		repo.NewModuleRepository(db, database.RandomIDs{}, func() time.Time { return time.Now().UTC() }),
		repo.NewResourceReferenceRepository(db),
		repo.NewModuleResourceInstanceRepository(db),
		nil,
	)
	return svc, db
}

func moduleRequest(moduleID, name, version string, functions ...*client.CreateModuleFunctionRequest) *client.CreateModuleRequest {
	return &client.CreateModuleRequest{
		Name:          name,
		ModuleId:      moduleID,
		Version:       version,
		Manifest:      `{"version":"` + version + `"}`,
		ModuleKey:     moduleID + ":" + version + ":abcdef0",
		ArchiveKey:    "archives/" + moduleID + "-" + version + ".zip",
		CreatedByType: "CLIENT",
		CreatedByRef:  "client-1",
		Functions:     functions,
	}
}

func moduleFunction(manifestID, fileKey string) *client.CreateModuleFunctionRequest {
	return &client.CreateModuleFunctionRequest{
		ManifestId: manifestID,
		Name:       manifestID,
		FileName:   manifestID + ".lua",
		FileKey:    fileKey,
		Runtime:    "lua",
	}
}

func mustCreateModule(t *testing.T, svc *moduleService, req *client.CreateModuleRequest) *client.Module {
	t.Helper()
	res, err := svc.CreateModule(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateModule %s: %v", req.ModuleKey, err)
	}
	return res.Module
}

// storedModule reads the row back with its active functions keyed by
// manifest id.
func storedModule(t *testing.T, db *gorm.DB, moduleID string) (models.Module, map[string]models.ModuleFunction) {
	t.Helper()
	var m models.Module
	if err := db.Where("module_id = ?", moduleID).First(&m).Error; err != nil {
		t.Fatalf("load module %s: %v", moduleID, err)
	}
	var functions []models.ModuleFunction
	if err := db.Where("module_id = ? AND archived_at IS NULL", m.ID).Find(&functions).Error; err != nil {
		t.Fatalf("load functions of %s: %v", moduleID, err)
	}
	byManifestID := make(map[string]models.ModuleFunction, len(functions))
	for _, f := range functions {
		byManifestID[f.ManifestID] = f
	}
	return m, byManifestID
}

func TestCreateModuleRefusesANameAnotherModuleHolds(t *testing.T) {
	cases := []struct {
		name     string
		holderID string
	}{
		{name: "an ordinary module", holderID: "cozy"},
		{name: "the system module", holderID: "woofx3"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, db := newModuleSvc(t)
			mustCreateModule(t, svc, moduleRequest(tc.holderID, "Taken", "1.0.0", moduleFunction("f1", "key-v1")))

			_, err := svc.CreateModule(context.Background(), moduleRequest("evil", "Taken", "6.6.6", moduleFunction("f1", "key-evil")))
			assertTwirpCode(t, err, twirp.AlreadyExists)

			holder, functions := storedModule(t, db, tc.holderID)
			if holder.Version != "1.0.0" || holder.ModuleKey != tc.holderID+":1.0.0:abcdef0" || holder.Name != "Taken" {
				t.Fatalf("holder row changed: %+v", holder)
			}
			if functions["f1"].FileKey != "key-v1" {
				t.Fatalf("holder function changed: %+v", functions["f1"])
			}
			var count int64
			if err := db.Model(&models.Module{}).Where("module_id = ?", "evil").Count(&count).Error; err != nil {
				t.Fatalf("count: %v", err)
			}
			if count != 0 {
				t.Fatalf("the refused upload left %d rows", count)
			}
		})
	}
}

func TestCreateModuleRefusesARenameOntoAnotherModulesName(t *testing.T) {
	svc, db := newModuleSvc(t)
	mustCreateModule(t, svc, moduleRequest("cozy", "Cozy", "1.0.0"))
	mustCreateModule(t, svc, moduleRequest("other", "Other", "1.0.0"))

	_, err := svc.CreateModule(context.Background(), moduleRequest("other", "Cozy", "2.0.0"))
	assertTwirpCode(t, err, twirp.AlreadyExists)

	other, _ := storedModule(t, db, "other")
	if other.Version != "1.0.0" || other.Name != "Other" {
		t.Fatalf("refused rename changed the row: %+v", other)
	}
}

func TestCreateModuleAdoptsALegacyRowWithoutAModuleID(t *testing.T) {
	svc, db := newModuleSvc(t)
	legacy := mustCreateModule(t, svc, moduleRequest("cozy", "Cozy", "1.0.0"))
	if err := db.Model(&models.Module{}).Where("id = ?", legacy.Id).Update("module_id", "").Error; err != nil {
		t.Fatalf("clear module_id: %v", err)
	}

	upgraded := mustCreateModule(t, svc, moduleRequest("cozy", "Cozy", "2.0.0"))

	if upgraded.Id != legacy.Id {
		t.Fatalf("legacy row not adopted: got row %s, want %s", upgraded.Id, legacy.Id)
	}
	adopted, _ := storedModule(t, db, "cozy")
	if adopted.Version != "2.0.0" {
		t.Fatalf("adopted row version = %q, want 2.0.0", adopted.Version)
	}
}

func TestCreateModuleRenamesTheRowItsModuleIDOwns(t *testing.T) {
	svc, db := newModuleSvc(t)
	first := mustCreateModule(t, svc, moduleRequest("cozy", "Cozy", "1.0.0"))

	renamed := mustCreateModule(t, svc, moduleRequest("cozy", "Cozy Deluxe", "2.0.0"))

	if renamed.Id != first.Id {
		t.Fatalf("rename created row %s instead of replacing %s", renamed.Id, first.Id)
	}
	row, _ := storedModule(t, db, "cozy")
	if row.Name != "Cozy Deluxe" || row.Version != "2.0.0" {
		t.Fatalf("row = %+v, want renamed to v2", row)
	}
}
