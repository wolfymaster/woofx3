package repository

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

type archivedRow struct {
	ArchivedAt time.Time
}

func installTestModule(t *testing.T, db *gorm.DB) *models.Module {
	t.Helper()
	module := &models.Module{ModuleKey: "wheel:1.0.0:abc", ModuleID: "wheel", Name: "Wheel", Version: "1.0.0"}
	if err := db.Create(module).Error; err != nil {
		t.Fatalf("install module: %v", err)
	}
	return module
}

// assertUpsertKeepsIdentity runs an upsert twice for the same manifest id,
// each time with a fresh candidate id, and checks the second resolved to the
// row the first inserted.
func assertUpsertKeepsIdentity(t *testing.T, upsert func(candidate uuid.UUID) (uuid.UUID, error)) {
	t.Helper()
	first, err := upsert(uuid.New())
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	second, err := upsert(uuid.New())
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if first == uuid.Nil || second != first {
		t.Fatalf("ids = %s then %s, want the same non-nil id", first, second)
	}
}

func TestModuleRegistrationUpsertsInsertThenUpdateOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		r := NewModuleRepository(db, database.RandomIDs{}, time.Now)
		module := installTestModule(t, db)

		t.Run("function", func(t *testing.T) {
			assertUpsertKeepsIdentity(t, func(candidate uuid.UUID) (uuid.UUID, error) {
				f := &models.ModuleFunction{ID: candidate, ModuleID: module.ID, ManifestID: "spin", Name: "spin", FileName: "spin.js", FileKey: "k", EntryPoint: "main", Runtime: "js"}
				err := r.UpsertFunction(f)
				return f.ID, err
			})
		})
		t.Run("trigger", func(t *testing.T) {
			assertUpsertKeepsIdentity(t, func(candidate uuid.UUID) (uuid.UUID, error) {
				tr := &models.Trigger{ID: candidate, Taxonomy: "[]", Name: "Spun", Event: "wheel.spun", ConfigSchema: "[]", CreatedByType: "MODULE", CreatedByRef: "wheel", ManifestID: "spun", Transport: "eventbus"}
				err := r.UpsertTrigger(tr)
				return tr.ID, err
			})
		})
		t.Run("action", func(t *testing.T) {
			assertUpsertKeepsIdentity(t, func(candidate uuid.UUID) (uuid.UUID, error) {
				a := &models.Action{ID: candidate, Name: "Spin", Call: "spin", ParamsSchema: "{}", CreatedByType: "MODULE", CreatedByRef: "wheel", ManifestID: "spin", Taxonomy: "[]"}
				err := r.UpsertAction(a)
				return a.ID, err
			})
		})
		t.Run("asset", func(t *testing.T) {
			assertUpsertKeepsIdentity(t, func(candidate uuid.UUID) (uuid.UUID, error) {
				a := &models.Asset{ID: candidate, Name: "Ding", ManifestPath: "assets/ding.mp3", RepositoryKey: "k", CreatedByType: "MODULE", CreatedByRef: "wheel", ManifestID: "ding"}
				err := r.UpsertAsset(a)
				return a.ID, err
			})
		})
		t.Run("module resource", func(t *testing.T) {
			assertUpsertKeepsIdentity(t, func(candidate uuid.UUID) (uuid.UUID, error) {
				res := &models.ModuleResource{ID: candidate, ModuleID: module.ID, ResourceType: "trigger", ManifestID: "spun", ResourceName: "Spun", OriginalVersion: "1.0.0", CurrentVersion: "1.0.0"}
				err := r.UpsertModuleResource(res)
				return res.ID, err
			})
		})
		t.Run("widget", func(t *testing.T) {
			assertUpsertKeepsIdentity(t, func(candidate uuid.UUID) (uuid.UUID, error) {
				w := &models.Widget{ID: candidate, Name: "Wheel", Directory: "widgets/wheel", AlertTypes: "[]", SettingsSchema: "[]", Surfaces: `["scene"]`, Taxonomy: "[]", BehaviorKinds: `{"transitions":[],"effects":[]}`, CreatedByType: "MODULE", CreatedByRef: "wheel", ManifestID: "wheel"}
				err := r.UpsertWidget(w)
				return w.ID, err
			})
		})
		t.Run("background task", func(t *testing.T) {
			assertUpsertKeepsIdentity(t, func(candidate uuid.UUID) (uuid.UUID, error) {
				bt := &models.BackgroundTask{ID: candidate, Name: "Tick", Function: "tick", Schedule: "* * * * *", CreatedByType: "MODULE", CreatedByRef: "wheel", ManifestID: "tick"}
				err := r.UpsertBackgroundTask(bt)
				return bt.ID, err
			})
		})
	})
}

func TestModuleResourceArchivesStampArchivedAtOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		r := NewModuleRepository(db, database.RandomIDs{}, time.Now)
		module := installTestModule(t, db)
		f := &models.ModuleFunction{ID: uuid.New(), ModuleID: module.ID, ManifestID: "spin", Name: "spin", FileName: "spin.js", FileKey: "k", EntryPoint: "main", Runtime: "js"}
		tr := &models.Trigger{ID: uuid.New(), Taxonomy: "[]", Name: "Spun", Event: "wheel.spun", ConfigSchema: "[]", CreatedByType: "MODULE", CreatedByRef: "wheel", ManifestID: "spun", Transport: "eventbus"}
		a := &models.Action{ID: uuid.New(), Name: "Spin", Call: "spin", CreatedByType: "MODULE", CreatedByRef: "wheel", ManifestID: "spin", Taxonomy: "[]", ParamsSchema: "{}"}
		w := &models.Widget{ID: uuid.New(), Name: "Wheel", Directory: "widgets/wheel", AlertTypes: "[]", SettingsSchema: "[]", Surfaces: `["scene"]`, Taxonomy: "[]", BehaviorKinds: `{"transitions":[],"effects":[]}`, CreatedByType: "MODULE", CreatedByRef: "wheel", ManifestID: "wheel"}
		for name, err := range map[string]error{
			"function": r.UpsertFunction(f),
			"trigger":  r.UpsertTrigger(tr),
			"action":   r.UpsertAction(a),
			"widget":   r.UpsertWidget(w),
		} {
			if err != nil {
				t.Fatalf("upsert %s: %v", name, err)
			}
		}

		if err := r.ArchiveFunctionByManifestID(module.ID, "spin"); err != nil {
			t.Fatalf("ArchiveFunctionByManifestID: %v", err)
		}
		archived, err := r.ArchiveTriggerByManifestID("wheel", "spun")
		if err != nil || archived == nil {
			t.Fatalf("ArchiveTriggerByManifestID = %v, %v", archived, err)
		}
		if err := r.ArchiveActionByManifestID("wheel", "spin"); err != nil {
			t.Fatalf("ArchiveActionByManifestID: %v", err)
		}
		if err := r.ArchiveWidgetByManifestID("wheel", "wheel"); err != nil {
			t.Fatalf("ArchiveWidgetByManifestID: %v", err)
		}

		for _, table := range []string{"functions", "triggers", "actions", "widgets"} {
			var stamped []archivedRow
			if err := db.Table(table).Select("archived_at").Where("archived_at IS NOT NULL").Find(&stamped).Error; err != nil {
				t.Fatalf("read %s: %v", table, err)
			}
			if len(stamped) != 1 || stamped[0].ArchivedAt.IsZero() {
				t.Errorf("%s archived rows = %+v, want one with a time", table, stamped)
			}
		}
	})
}
