package services

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

func columnsSettings(columns string) string {
	return `{"columns":` + columns + `}`
}

func TestParseDatabaseColumns(t *testing.T) {
	longLabel := strings.Repeat("a", 101)
	tooMany := make([]string, 33)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf(`{"id":"c%d","label":"C","type":"text"}`, i)
	}
	tests := []struct {
		name     string
		settings string
		problem  string
	}{
		{"no columns setting", `{}`, ""},
		{"empty settings", ``, ""},
		{"every type", columnsSettings(`[
			{"id":"game","label":"Game","type":"text","public":true},
			{"id":"score","label":"Score","type":"number"},
			{"id":"won","label":"Won","type":"boolean"},
			{"id":"on","label":"Played on","type":"date"},
			{"id":"vod","label":"VOD","type":"url"},
			{"id":"mood","label":"Mood","type":"select","options":[{"value":"chill","label":"Chill"}]}
		]`), ""},
		{"not a list", columnsSettings(`{"id":"game"}`), "must be a list"},
		{"unknown field", columnsSettings(`[{"id":"game","label":"Game","type":"text","color":"red"}]`), "must be a list"},
		{"bad id", columnsSettings(`[{"id":"a b","label":"Game","type":"text"}]`), "id must be"},
		{"all-digit id", columnsSettings(`[{"id":"123","label":"Game","type":"text"}]`), "not only digits"},
		{"long id", columnsSettings(`[{"id":"` + strings.Repeat("a", 65) + `","label":"Game","type":"text"}]`), "id must be"},
		{"repeated id", columnsSettings(`[{"id":"g","label":"A","type":"text"},{"id":"g","label":"B","type":"text"}]`), "used by another column"},
		{"empty label", columnsSettings(`[{"id":"g","label":"","type":"text"}]`), "label must be"},
		{"long label", columnsSettings(`[{"id":"g","label":"` + longLabel + `","type":"text"}]`), "label must be"},
		{"NUL label", columnsSettings(`[{"id":"g","label":"a\u0000","type":"text"}]`), "NUL"},
		{"unknown type", columnsSettings(`[{"id":"g","label":"G","type":"color"}]`), "type must be"},
		{"options on text", columnsSettings(`[{"id":"g","label":"G","type":"text","options":[{"value":"a","label":"A"}]}]`), "only a select"},
		{"select without options", columnsSettings(`[{"id":"g","label":"G","type":"select"}]`), "1 to 50 options"},
		{"bad option value", columnsSettings(`[{"id":"g","label":"G","type":"select","options":[{"value":"a b","label":"A"}]}]`), "option values"},
		{"repeated option", columnsSettings(`[{"id":"g","label":"G","type":"select","options":[{"value":"a","label":"A"},{"value":"a","label":"B"}]}]`), "repeats"},
		{"too many columns", columnsSettings(`[` + strings.Join(tooMany, ",") + `]`), "at most 32"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseDatabaseColumns(tt.settings, DefaultDatabaseLimits())
			if tt.problem == "" {
				if err != nil {
					t.Fatalf("parseDatabaseColumns: %v", err)
				}
				return
			}
			refused, ok := asKindSettingsError(err)
			if !ok || !strings.Contains(refused.Reason, tt.problem) {
				t.Fatalf("parseDatabaseColumns error = %v, want a refusal mentioning %q", err, tt.problem)
			}
		})
	}
}

func TestKindSettingsValidatorsRefuseADuplicate(t *testing.T) {
	validators := NewKindSettingsValidators()
	validator := NewDatabaseColumnsValidator(nil, DefaultDatabaseLimits())
	if err := validators.Register(DatabaseKind, validator); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := validators.Register(DatabaseKind, validator); err == nil {
		t.Fatal("second Register of the same kind succeeded")
	}
	if _, ok := validators.For("woofx3:queue"); ok {
		t.Fatal("an unregistered kind has a validator")
	}
}

// databaseFixture is a module service with the database validator registered,
// the bundled woofx3 module installed and one database instance created.
type databaseFixture struct {
	svc      *moduleService
	db       *gorm.DB
	records  *repo.DatabaseRecordRepository
	instance *models.ModuleResourceInstance
}

const fixtureDatabaseID = "woofx3:database:games"

func newDatabaseFixture(t *testing.T, db *gorm.DB, columns string) *databaseFixture {
	t.Helper()
	now := func() time.Time { return time.Now().UTC() }
	records, err := repo.NewDatabaseRecordRepository(db, now)
	if err != nil {
		t.Fatalf("NewDatabaseRecordRepository: %v", err)
	}
	validators := NewKindSettingsValidators()
	if err := validators.Register(DatabaseKind, NewDatabaseColumnsValidator(records, DefaultDatabaseLimits())); err != nil {
		t.Fatalf("Register: %v", err)
	}
	module := &models.Module{ModuleKey: "woofx3:0.45.0:abc", ModuleID: "woofx3", Name: "woofx3", Version: "0.45.0"}
	if err := db.Create(module).Error; err != nil {
		t.Fatalf("install module: %v", err)
	}
	svc := NewModuleService(
		repo.NewModuleRepository(db, database.RandomIDs{}, now),
		repo.NewResourceReferenceRepository(db),
		repo.NewModuleResourceInstanceRepository(db),
		workers.NewEventPublisher(repo.NewDbEventRepository(db), slog.New(slog.DiscardHandler)),
		validators,
	)
	if _, err := svc.CreateResourceInstance(context.Background(), &client.CreateResourceInstanceRequest{
		ModuleName: "woofx3", Kind: "database", InstanceId: "games", DisplayName: "Games", SettingsJson: columnsSettings(columns),
	}); err != nil {
		t.Fatalf("CreateResourceInstance: %v", err)
	}
	var instance models.ModuleResourceInstance
	if err := db.Where("instance_id = ?", "games").Take(&instance).Error; err != nil {
		t.Fatalf("read instance: %v", err)
	}
	return &databaseFixture{svc: svc, db: db, records: records, instance: &instance}
}

func (f *databaseFixture) insert(t *testing.T, values map[string]any) {
	t.Helper()
	if _, _, err := f.records.Insert(context.Background(), f.instance.ID, values, nil); err != nil {
		t.Fatalf("Insert: %v", err)
	}
}

func (f *databaseFixture) update(columns string) error {
	_, err := f.svc.UpdateResourceInstance(context.Background(), &client.UpdateResourceInstanceRequest{
		CanonicalId: fixtureDatabaseID, DisplayName: "Games", SettingsJson: columnsSettings(columns),
	})
	return err
}

func wantInvalidArgument(t *testing.T, err error, mention string) {
	t.Helper()
	terr, ok := err.(twirp.Error)
	if !ok || terr.Code() != twirp.InvalidArgument || !strings.Contains(terr.Msg(), mention) {
		t.Fatalf("error = %v, want invalid_argument mentioning %q", err, mention)
	}
}

const (
	gameColumn  = `{"id":"game","label":"Game","type":"text"}`
	moodColumn  = `{"id":"mood","label":"Mood","type":"select","options":[{"value":"chill","label":"Chill"},{"value":"hype","label":"Hype"}]}`
	scoreColumn = `{"id":"score","label":"Score","type":"number"}`
)

func TestDatabaseColumnChangesOnEveryDialect(t *testing.T) {
	tests := []struct {
		name    string
		rows    []map[string]any
		next    string
		problem string
	}{
		{"add, relabel, publish and reorder", nil,
			`[` + scoreColumn + `,{"id":"game","label":"Title","type":"text","public":true},` + moodColumn + `,{"id":"vod","label":"VOD","type":"url"}]`, ""},
		{"change type of an empty column", []map[string]any{{"game": "Celeste"}},
			`[` + gameColumn + `,` + moodColumn + `,{"id":"score","label":"Score","type":"text"}]`, ""},
		{"change type of a used column", []map[string]any{{"score": float64(3)}, {"score": float64(4)}},
			`[` + gameColumn + `,` + moodColumn + `,{"id":"score","label":"Score","type":"text"}]`, "2 row(s)"},
		{"remove an unused option", []map[string]any{{"mood": "chill"}},
			`[` + gameColumn + `,{"id":"mood","label":"Mood","type":"select","options":[{"value":"chill","label":"Chill"}]},` + scoreColumn + `]`, ""},
		{"remove a used option", []map[string]any{{"mood": "hype"}},
			`[` + gameColumn + `,{"id":"mood","label":"Mood","type":"select","options":[{"value":"chill","label":"Chill"}]},` + scoreColumn + `]`, `option "Hype"`},
		{"invalid definition", nil, `[{"id":"game","label":"","type":"text"}]`, "label must be"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
				f := newDatabaseFixture(t, db, `[`+gameColumn+`,`+moodColumn+`,`+scoreColumn+`]`)
				for _, row := range tt.rows {
					f.insert(t, row)
				}
				err := f.update(tt.next)
				if tt.problem == "" {
					if err != nil {
						t.Fatalf("update: %v", err)
					}
					return
				}
				wantInvalidArgument(t, err, tt.problem)
				var stored models.ModuleResourceInstance
				if err := db.Where("id = ?", f.instance.ID).Take(&stored).Error; err != nil {
					t.Fatalf("read instance: %v", err)
				}
				if stored.Settings != f.instance.Settings {
					t.Fatalf("refused settings were stored: %s", stored.Settings)
				}
			})
		})
	}
}

func TestDeletingADatabaseColumnStripsItsValuesOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newDatabaseFixture(t, db, `[`+gameColumn+`,`+scoreColumn+`]`)
		f.insert(t, map[string]any{"game": "Celeste", "score": float64(7)})
		if err := f.update(`[` + gameColumn + `]`); err != nil {
			t.Fatalf("delete column: %v", err)
		}
		if n, err := f.records.CountByColumn(context.Background(), f.instance.ID, "score"); err != nil || n != 0 {
			t.Fatalf("score values left = %d, %v", n, err)
		}
		// A new column under the old id starts empty, so a new type is allowed.
		if err := f.update(`[` + gameColumn + `,{"id":"score","label":"Score","type":"text"}]`); err != nil {
			t.Fatalf("re-add column with another type: %v", err)
		}
	})
}

func TestCompareAndSetCannotBypassDatabaseColumnRulesOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newDatabaseFixture(t, db, `[`+scoreColumn+`]`)
		f.insert(t, map[string]any{"score": float64(3)})
		cas := func(value string) error {
			_, err := f.svc.CompareAndSetResourceInstanceSetting(context.Background(), &client.CompareAndSetResourceInstanceSettingRequest{
				CanonicalId: fixtureDatabaseID, ModuleName: "woofx3", Key: "columns",
				ExpectedJson: `[` + scoreColumn + `]`, ValueJson: value,
			})
			return err
		}
		wantInvalidArgument(t, cas(`[{"id":"score","label":"Score","type":"text"}]`), "1 row(s)")
		wantInvalidArgument(t, cas(`[{"id":"1","label":"Score","type":"number"}]`), "not only digits")
		if n, err := f.records.CountByColumn(context.Background(), f.instance.ID, "score"); err != nil || n != 1 {
			t.Fatalf("a refused compare-and-set stripped values: %d, %v", n, err)
		}
	})
}
