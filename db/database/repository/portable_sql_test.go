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

// The hand-written upserts and updates are written once for Postgres and
// SQLite. These run them on both migration chains: a schema-qualified table
// name or NOW() fails on SQLite, and SQLite accepting a statement says
// nothing about Postgres.

var (
	firstWrite  = time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	secondWrite = time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
)

// steppedClock returns each of its times once, in order, then keeps
// returning the last.
func steppedClock(times ...time.Time) func() time.Time {
	return func() time.Time {
		next := times[0]
		if len(times) > 1 {
			times = times[1:]
		}
		return next
	}
}

func installModule(t *testing.T, db *gorm.DB) *models.Module {
	t.Helper()
	module := &models.Module{ModuleKey: "hype:1.0.0:abc", ModuleID: "hype", Name: "Hype", Version: "1.0.0"}
	if err := db.Create(module).Error; err != nil {
		t.Fatalf("install module: %v", err)
	}
	return module
}

// moduleTrigger, moduleAction and moduleWidget are rows a module registers
// under a fixed manifest id. Their JSON columns hold valid JSON, which the
// Postgres jsonb columns demand and SQLite does not check.
func moduleTrigger(module *models.Module, id uuid.UUID, name string) *models.Trigger {
	return &models.Trigger{ID: id, Name: name, Event: "channel.cheer", ConfigSchema: "[]", Emits: "{}", Taxonomy: "[]", CreatedByType: "MODULE", CreatedByRef: module.ModuleID, ManifestID: "cheer"}
}

func moduleAction(module *models.Module, id uuid.UUID, name string) *models.Action {
	return &models.Action{ID: id, Name: name, Call: "hype.boost", ParamsSchema: "{}", Returns: "{}", Taxonomy: "[]", CreatedByType: "MODULE", CreatedByRef: module.ModuleID, ManifestID: "boost"}
}

func moduleWidget(module *models.Module, id uuid.UUID, name string) *models.Widget {
	return &models.Widget{ID: id, Name: name, Directory: "board", Entry: "index.html", AlertTypes: "[]", SettingsSchema: "[]", Surfaces: "[]", Taxonomy: "[]", BehaviorKinds: `{"transitions":[],"effects":[]}`, CreatedByType: "MODULE", CreatedByRef: module.ModuleID, ManifestID: "board"}
}

// timestamps reads a row's created_at and updated_at.
func timestamps(t *testing.T, db *gorm.DB, table string, id uuid.UUID) (time.Time, time.Time) {
	t.Helper()
	var row struct {
		CreatedAt time.Time
		UpdatedAt time.Time
	}
	if err := db.Table(table).Select("created_at, updated_at").Where("id = ?", id).Take(&row).Error; err != nil {
		t.Fatalf("read %s timestamps: %v", table, err)
	}
	return row.CreatedAt, row.UpdatedAt
}

func TestModuleRepositoryUpsertsRunOnEveryDialect(t *testing.T) {
	tests := []struct {
		name  string
		table string
		// upsert writes the same manifest id with the given name and id
		// (uuid.Nil for none) and returns the id the repository reports.
		upsert func(t *testing.T, r *ModuleRepository, module *models.Module, name string, id uuid.UUID) uuid.UUID
	}{
		{
			name:  "trigger",
			table: "triggers",
			upsert: func(t *testing.T, r *ModuleRepository, module *models.Module, name string, id uuid.UUID) uuid.UUID {
				row := moduleTrigger(module, id, name)
				if err := r.UpsertTrigger(row); err != nil {
					t.Fatalf("UpsertTrigger: %v", err)
				}
				return row.ID
			},
		},
		{
			name:  "action",
			table: "actions",
			upsert: func(t *testing.T, r *ModuleRepository, module *models.Module, name string, id uuid.UUID) uuid.UUID {
				row := moduleAction(module, id, name)
				if err := r.UpsertAction(row); err != nil {
					t.Fatalf("UpsertAction: %v", err)
				}
				return row.ID
			},
		},
		{
			name:  "widget",
			table: "widgets",
			upsert: func(t *testing.T, r *ModuleRepository, module *models.Module, name string, id uuid.UUID) uuid.UUID {
				row := moduleWidget(module, id, name)
				if err := r.UpsertWidget(row); err != nil {
					t.Fatalf("UpsertWidget: %v", err)
				}
				return row.ID
			},
		},
		{
			name:  "asset",
			table: "assets",
			upsert: func(t *testing.T, r *ModuleRepository, module *models.Module, name string, id uuid.UUID) uuid.UUID {
				row := &models.Asset{ID: id, Name: name, ManifestPath: "assets/logo.png", RepositoryKey: "k", Kind: "image", ContentType: "image/png", CreatedByType: "MODULE", CreatedByRef: module.ModuleID, ManifestID: "logo"}
				if err := r.UpsertAsset(row); err != nil {
					t.Fatalf("UpsertAsset: %v", err)
				}
				return row.ID
			},
		},
		{
			name:  "background task",
			table: "background_tasks",
			upsert: func(t *testing.T, r *ModuleRepository, module *models.Module, name string, id uuid.UUID) uuid.UUID {
				row := &models.BackgroundTask{ID: id, Name: name, Function: "tick", Schedule: "* * * * *", CreatedByType: "MODULE", CreatedByRef: module.ModuleID, ManifestID: "tick"}
				if err := r.UpsertBackgroundTask(row); err != nil {
					t.Fatalf("UpsertBackgroundTask: %v", err)
				}
				return row.ID
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
				module := installModule(t, db)
				r := NewModuleRepository(db, database.RandomIDs{}, steppedClock(firstWrite, secondWrite))

				inserted := tt.upsert(t, r, module, "first", uuid.Nil)
				if inserted == uuid.Nil {
					t.Fatal("the insert reported no id")
				}
				// An upgrade sends a fresh id for a manifest id already stored;
				// the row keeps the one it has.
				updated := tt.upsert(t, r, module, "second", uuid.New())
				if updated != inserted {
					t.Fatalf("the second upsert reported id %s, want the row's %s", updated, inserted)
				}

				var name string
				if err := db.Table(tt.table).Select("name").Where("id = ?", inserted).Scan(&name).Error; err != nil {
					t.Fatalf("read name: %v", err)
				}
				if name != "second" {
					t.Fatalf("name = %q, want the second upsert's", name)
				}
				createdAt, updatedAt := timestamps(t, db, tt.table, inserted)
				if !createdAt.Equal(firstWrite) || !updatedAt.Equal(secondWrite) {
					t.Fatalf("created_at, updated_at = %s, %s, want %s, %s", createdAt, updatedAt, firstWrite, secondWrite)
				}
			})
		})
	}
}

func TestUpsertFunctionUpdatesTheActiveRowOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		module := installModule(t, db)
		r := NewModuleRepository(db, database.RandomIDs{}, steppedClock(firstWrite))

		first := &models.ModuleFunction{ModuleID: module.ID, ManifestID: "boost", Name: "boost", FileName: "boost.lua", FileKey: "v1", Runtime: "lua"}
		if err := r.UpsertFunction(first); err != nil {
			t.Fatalf("UpsertFunction: %v", err)
		}
		second := &models.ModuleFunction{ModuleID: module.ID, ManifestID: "boost", Name: "boost", FileName: "boost.lua", FileKey: "v2", Runtime: "lua"}
		if err := r.UpsertFunction(second); err != nil {
			t.Fatalf("UpsertFunction again: %v", err)
		}
		if first.ID == uuid.Nil || second.ID != first.ID {
			t.Fatalf("ids = %s, %s, want one row", first.ID, second.ID)
		}

		if err := r.ArchiveFunctionByManifestID(module.ID, "boost"); err != nil {
			t.Fatalf("ArchiveFunctionByManifestID: %v", err)
		}
		var stored models.ModuleFunction
		if err := db.Where("id = ?", first.ID).Take(&stored).Error; err != nil {
			t.Fatalf("read function: %v", err)
		}
		if stored.FileKey != "v2" {
			t.Fatalf("file_key = %q, want v2", stored.FileKey)
		}
		if stored.ArchivedAt == nil || !stored.ArchivedAt.Equal(firstWrite) {
			t.Fatalf("archived_at = %v, want %s", stored.ArchivedAt, firstWrite)
		}
	})
}

func TestUpsertModuleResourceRunsOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		module := installModule(t, db)
		r := NewModuleRepository(db, database.RandomIDs{}, steppedClock(firstWrite))

		for _, version := range []string{"1.0.0", "1.1.0"} {
			res := &models.ModuleResource{ModuleID: module.ID, ResourceType: "widget", ManifestID: "board", ResourceName: "Board", OriginalVersion: version, CurrentVersion: version}
			if err := r.UpsertModuleResource(res); err != nil {
				t.Fatalf("UpsertModuleResource %s: %v", version, err)
			}
		}
		resources, err := r.ListModuleResources(module.ID, "widget")
		if err != nil {
			t.Fatalf("ListModuleResources: %v", err)
		}
		if len(resources) != 1 || resources[0].OriginalVersion != "1.0.0" || resources[0].CurrentVersion != "1.1.0" {
			t.Fatalf("resources = %+v, want one row from 1.0.0 now at 1.1.0", resources)
		}
	})
}

func TestWorkflowUpsertRunsOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		r := NewWorkflowRepository(db, database.RandomIDs{})

		first := &models.WorkflowDefinition{Name: "first", Steps: "[]", Trigger: "{}", CreatedByType: "MODULE", CreatedByRef: "hype", ManifestID: "count", Taxonomy: "[]", Enabled: true}
		if err := r.Upsert(first); err != nil {
			t.Fatalf("Upsert: %v", err)
		}
		second := &models.WorkflowDefinition{Name: "second", Steps: "[]", Trigger: "{}", CreatedByType: "MODULE", CreatedByRef: "hype", ManifestID: "count", Taxonomy: "[]"}
		if err := r.Upsert(second); err != nil {
			t.Fatalf("Upsert again: %v", err)
		}
		if first.ID == uuid.Nil || second.ID != first.ID {
			t.Fatalf("ids = %s, %s, want one row", first.ID, second.ID)
		}
		if !second.Enabled {
			t.Fatal("the upgrade reported the workflow disabled; enabled must survive it")
		}
		stored, err := r.GetByID(first.ID)
		if err != nil {
			t.Fatalf("GetByID: %v", err)
		}
		if stored.Name != "second" {
			t.Fatalf("name = %q, want the second upsert's", stored.Name)
		}
	})
}

func TestSceneEventDeliveryAndCompletionRunOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		scene := &models.Scene{Name: "Main"}
		if err := db.Create(scene).Error; err != nil {
			t.Fatalf("create scene: %v", err)
		}
		r := NewSceneEventRepository(db, steppedClock(firstWrite, secondWrite))
		event, err := r.RecordSceneEvent(&models.SceneEvent{SceneID: scene.ID, Type: "behavior", Key: "k", Value: "{}", OccurredAt: firstWrite}, []string{"w1"})
		if err != nil {
			t.Fatalf("RecordSceneEvent: %v", err)
		}

		if err := r.RecordDelivery(event.ID, "w1"); err != nil {
			t.Fatalf("RecordDelivery: %v", err)
		}
		open, err := r.ListOpenDeliveries(&scene.ID)
		if err != nil {
			t.Fatalf("ListOpenDeliveries: %v", err)
		}
		if len(open) != 1 || open[0].DeliveredAt == nil || !open[0].DeliveredAt.Equal(firstWrite) || !open[0].LastAttemptAt.Equal(firstWrite) {
			t.Fatalf("open deliveries = %+v, want w1 delivered at %s", open, firstWrite)
		}

		if err := r.RecordCompletion(event.ID, "w1"); err != nil {
			t.Fatalf("RecordCompletion: %v", err)
		}
		log, total, err := r.ListSceneEventLog(&event.ID, nil, 0, 0)
		if err != nil {
			t.Fatalf("ListSceneEventLog: %v", err)
		}
		if total != 2 || log[0].Kind != "delivered" || log[1].Kind != "completed" {
			t.Fatalf("log = %+v, want delivered then completed", log)
		}
		if log[0].ID == uuid.Nil || log[0].ID == log[1].ID {
			t.Fatalf("log ids = %s, %s, want two distinct ids", log[0].ID, log[1].ID)
		}
		if !log[0].OccurredAt.Equal(firstWrite) || !log[1].OccurredAt.Equal(secondWrite) {
			t.Fatalf("log occurred_at = %s, %s, want %s, %s", log[0].OccurredAt, log[1].OccurredAt, firstWrite, secondWrite)
		}
	})
}

// Upgrades archive the triggers, actions and widgets a new manifest drops;
// each stamps archived_at from the repository's clock.
func TestModuleArchivesStampTheClockOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		module := installModule(t, db)
		r := NewModuleRepository(db, database.RandomIDs{}, steppedClock(firstWrite, secondWrite))
		trigger := moduleTrigger(module, uuid.Nil, "cheer")
		action := moduleAction(module, uuid.Nil, "boost")
		widget := moduleWidget(module, uuid.Nil, "board")
		if err := r.UpsertTrigger(trigger); err != nil {
			t.Fatalf("UpsertTrigger: %v", err)
		}
		if err := r.UpsertAction(action); err != nil {
			t.Fatalf("UpsertAction: %v", err)
		}
		if err := r.UpsertWidget(widget); err != nil {
			t.Fatalf("UpsertWidget: %v", err)
		}

		archived, err := r.ArchiveTriggerByManifestID(module.ModuleID, "cheer")
		if err != nil || archived == nil {
			t.Fatalf("ArchiveTriggerByManifestID = %v, %v", archived, err)
		}
		if err := r.ArchiveActionByManifestID(module.ModuleID, "boost"); err != nil {
			t.Fatalf("ArchiveActionByManifestID: %v", err)
		}
		if err := r.ArchiveWidgetByManifestID(module.ModuleID, "board"); err != nil {
			t.Fatalf("ArchiveWidgetByManifestID: %v", err)
		}

		for table, id := range map[string]uuid.UUID{"triggers": trigger.ID, "actions": action.ID, "widgets": widget.ID} {
			var row struct {
				ArchivedAt *time.Time
			}
			if err := db.Table(table).Select("archived_at").Where("id = ?", id).Take(&row).Error; err != nil {
				t.Fatalf("read %s: %v", table, err)
			}
			if row.ArchivedAt == nil || !row.ArchivedAt.Equal(secondWrite) {
				t.Errorf("%s archived_at = %v, want %s", table, row.ArchivedAt, secondWrite)
			}
		}
	})
}
