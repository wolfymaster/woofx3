package repository

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// The JSON sort, match and strip statements differ per dialect, so every test
// here runs on SQLite, the packaged engine's database, and on Postgres in CI.

func createDatabaseInstance(t *testing.T, db *gorm.DB) *models.ModuleResourceInstance {
	t.Helper()
	module := installModule(t, db)
	instance := &models.ModuleResourceInstance{ModuleID: module.ID, Kind: "database", InstanceID: "games", Settings: "{}"}
	if err := db.Create(instance).Error; err != nil {
		t.Fatalf("create database instance: %v", err)
	}
	return instance
}

var ctx = context.Background()

// tickingClock advances a second per reading, so creation order is strict.
func tickingClock() func() time.Time {
	at := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	return func() time.Time {
		at = at.Add(time.Second)
		return at
	}
}

func newRecordRepository(t *testing.T, db *gorm.DB) *DatabaseRecordRepository {
	t.Helper()
	r, err := NewDatabaseRecordRepository(db, tickingClock())
	if err != nil {
		t.Fatalf("NewDatabaseRecordRepository: %v", err)
	}
	return r
}

func insertRecord(t *testing.T, r *DatabaseRecordRepository, databaseID uuid.UUID, values map[string]any) *models.DatabaseRecord {
	t.Helper()
	record, inserted, err := r.Insert(ctx, databaseID, values, nil)
	if err != nil || !inserted {
		t.Fatalf("Insert = %v, %v", inserted, err)
	}
	return record
}

func TestDatabaseRecordInsertDeduplicatesByKeyOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		instance := createDatabaseInstance(t, db)
		r := newRecordRepository(t, db)
		key := "submission-1"

		first, inserted, err := r.Insert(ctx, instance.ID, map[string]any{"game": "Celeste"}, &key)
		if err != nil || !inserted {
			t.Fatalf("first Insert = %v, %v", inserted, err)
		}
		if first.Revision != 1 {
			t.Fatalf("revision = %d, want 1", first.Revision)
		}
		again, inserted, err := r.Insert(ctx, instance.ID, map[string]any{"game": "Hades"}, &key)
		if err != nil {
			t.Fatalf("repeat Insert: %v", err)
		}
		if inserted || again.ID != first.ID {
			t.Fatalf("repeat Insert = %v with id %s, want the existing %s", inserted, again.ID, first.ID)
		}
		insertRecord(t, r, instance.ID, map[string]any{"game": "Tunic"})
		insertRecord(t, r, instance.ID, map[string]any{"game": "Tunic"})
		count, err := r.Count(ctx, instance.ID)
		if err != nil || count != 3 {
			t.Fatalf("Count = %d, %v; want 3 (keyless inserts never collide)", count, err)
		}
	})
}

func TestDatabaseRecordsGoWithTheirInstanceOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		instance := createDatabaseInstance(t, db)
		r := newRecordRepository(t, db)
		insertRecord(t, r, instance.ID, map[string]any{"game": "Celeste"})
		if err := db.Delete(instance).Error; err != nil {
			t.Fatalf("delete instance: %v", err)
		}
		count, err := r.Count(ctx, instance.ID)
		if err != nil || count != 0 {
			t.Fatalf("Count after instance delete = %d, %v; want 0", count, err)
		}
	})
}

func TestDatabaseRecordListSortsEachTypeOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		instance := createDatabaseInstance(t, db)
		r := newRecordRepository(t, db)
		a := insertRecord(t, r, instance.ID, map[string]any{"name": "b", "score": float64(10), "won": true, "on": "2026-01-02"})
		b := insertRecord(t, r, instance.ID, map[string]any{"name": "a", "score": float64(9), "won": false, "on": "2025-12-31"})
		c := insertRecord(t, r, instance.ID, map[string]any{"name": "c", "score": 100.5, "on": "2026-01-01"})
		empty := insertRecord(t, r, instance.ID, map[string]any{})

		tests := []struct {
			name string
			sort DatabaseRecordSort
			want []uuid.UUID
		}{
			{"created ascending", DatabaseRecordSort{}, []uuid.UUID{a.ID, b.ID, c.ID, empty.ID}},
			{"created descending", DatabaseRecordSort{Descending: true}, []uuid.UUID{empty.ID, c.ID, b.ID, a.ID}},
			{"text", DatabaseRecordSort{ColumnID: "name"}, []uuid.UUID{b.ID, a.ID, c.ID, empty.ID}},
			{"number by value, not text", DatabaseRecordSort{ColumnID: "score"}, []uuid.UUID{b.ID, a.ID, c.ID, empty.ID}},
			{"number descending, empty last", DatabaseRecordSort{ColumnID: "score", Descending: true}, []uuid.UUID{c.ID, a.ID, b.ID, empty.ID}},
			{"boolean", DatabaseRecordSort{ColumnID: "won"}, []uuid.UUID{b.ID, a.ID, c.ID, empty.ID}},
			{"date", DatabaseRecordSort{ColumnID: "on"}, []uuid.UUID{b.ID, c.ID, a.ID, empty.ID}},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				records, err := r.List(ctx, instance.ID, tt.sort, 0, 10)
				if err != nil {
					t.Fatalf("List: %v", err)
				}
				got := make([]uuid.UUID, len(records))
				for i, record := range records {
					got[i] = record.ID
				}
				if len(got) != len(tt.want) {
					t.Fatalf("List = %v, want %v", got, tt.want)
				}
				for i := range got {
					if got[i] != tt.want[i] {
						t.Fatalf("List = %v, want %v", got, tt.want)
					}
				}
			})
		}

		page, err := r.List(ctx, instance.ID, DatabaseRecordSort{}, 1, 2)
		if err != nil || len(page) != 2 || page[0].ID != b.ID || page[1].ID != c.ID {
			t.Fatalf("List offset 1 limit 2 = %v, %v", page, err)
		}
	})
}

func TestDatabaseRecordStripColumnOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		instance := createDatabaseInstance(t, db)
		other := &models.ModuleResourceInstance{ModuleID: instance.ModuleID, Kind: "database", InstanceID: "other", Settings: "{}"}
		if err := db.Create(other).Error; err != nil {
			t.Fatalf("create other instance: %v", err)
		}
		r := newRecordRepository(t, db)
		kept := insertRecord(t, r, instance.ID, map[string]any{"game": "Celeste", "mood": "chill"})
		insertRecord(t, r, instance.ID, map[string]any{"game": "Hades"})
		untouched := insertRecord(t, r, other.ID, map[string]any{"mood": "hype"})

		if n, err := r.CountByColumn(ctx, instance.ID, "mood"); err != nil || n != 1 {
			t.Fatalf("CountByColumn before strip = %d, %v; want 1", n, err)
		}
		stripped, err := r.StripColumn(ctx, instance.ID, "mood")
		if err != nil || stripped != 1 {
			t.Fatalf("StripColumn = %d, %v; want 1", stripped, err)
		}
		if n, err := r.CountByColumn(ctx, instance.ID, "mood"); err != nil || n != 0 {
			t.Fatalf("CountByColumn after strip = %d, %v; want 0", n, err)
		}
		read, err := r.Get(ctx, instance.ID, kept.ID)
		if err != nil {
			t.Fatalf("Get: %v", err)
		}
		values, err := DecodeRecordValues(read.Values)
		if err != nil || len(values) != 1 || values["game"] != "Celeste" {
			t.Fatalf("values after strip = %v, %v; want only game", values, err)
		}
		if n, err := r.CountByColumn(ctx, other.ID, "mood"); err != nil || n != 1 {
			t.Fatalf("other database lost its column: %d, %v", n, err)
		}
		if _, err := r.Get(ctx, instance.ID, untouched.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("Get of another database's record = %v, want not found", err)
		}
	})
}

func TestDatabaseRecordMatchByValueOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		instance := createDatabaseInstance(t, db)
		r := newRecordRepository(t, db)
		first := insertRecord(t, r, instance.ID, map[string]any{"game": "Celeste", "score": float64(12), "won": true})
		insertRecord(t, r, instance.ID, map[string]any{"game": "Celeste", "score": float64(3), "won": false})

		tests := []struct {
			name   string
			column string
			value  any
			count  int64
		}{
			{"text", "game", "Celeste", 2},
			{"number", "score", float64(12), 1},
			{"boolean", "won", true, 1},
			{"no match", "game", "Hades", 0},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				n, err := r.CountByColumnValue(ctx, instance.ID, tt.column, tt.value)
				if err != nil || n != tt.count {
					t.Fatalf("CountByColumnValue = %d, %v; want %d", n, err, tt.count)
				}
			})
		}
		found, err := r.FindFirstByColumnValue(ctx, instance.ID, "game", "Celeste")
		if err != nil || found.ID != first.ID {
			t.Fatalf("FindFirstByColumnValue = %v, %v; want the earliest", found, err)
		}
		if _, err := r.FindFirstByColumnValue(ctx, instance.ID, "game", "Hades"); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("FindFirstByColumnValue no match = %v, want not found", err)
		}
	})
}

func TestDatabaseRecordUpdateOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		instance := createDatabaseInstance(t, db)
		r := newRecordRepository(t, db)
		record := insertRecord(t, r, instance.ID, map[string]any{"game": "Celeste", "vod": "https://example.com/1"})

		updated, err := r.Update(ctx, instance.ID, record.ID, map[string]any{"vod": nil, "score": float64(5)}, nil)
		if err != nil {
			t.Fatalf("Update: %v", err)
		}
		if updated.Revision != 2 || !updated.UpdatedAt.After(record.UpdatedAt) {
			t.Fatalf("updated revision %d at %s, want 2 after %s", updated.Revision, updated.UpdatedAt, record.UpdatedAt)
		}
		values, err := DecodeRecordValues(updated.Values)
		if err != nil || len(values) != 2 || values["game"] != "Celeste" || values["score"] != float64(5) {
			t.Fatalf("values = %v, %v; want game kept, vod cleared, score set", values, err)
		}

		stale := int64(1)
		if _, err := r.Update(ctx, instance.ID, record.ID, map[string]any{"game": "Hades"}, &stale); !errors.Is(err, ErrDatabaseRecordRevisionConflict) {
			t.Fatalf("Update at a stale revision = %v, want a conflict", err)
		}
		if _, err := r.Update(ctx, instance.ID, uuid.New(), map[string]any{"game": "Hades"}, nil); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("Update of a missing record = %v, want not found", err)
		}

		deleted, err := r.Delete(ctx, instance.ID, record.ID)
		if err != nil || deleted.Revision != 2 {
			t.Fatalf("Delete = %v, %v", deleted, err)
		}
		if _, err := r.Delete(ctx, instance.ID, record.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("second Delete = %v, want not found", err)
		}
	})
}

func TestDatabaseRecordRefusesNULOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		instance := createDatabaseInstance(t, db)
		r := newRecordRepository(t, db)
		if _, _, err := r.Insert(ctx, instance.ID, map[string]any{"game": "Cele\x00ste"}, nil); !errors.Is(err, ErrDatabaseRecordValueHasNUL) {
			t.Fatalf("Insert with NUL = %v, want ErrDatabaseRecordValueHasNUL", err)
		}
		record := insertRecord(t, r, instance.ID, map[string]any{"game": "Celeste"})
		if _, err := r.Update(ctx, instance.ID, record.ID, map[string]any{"game": "\x00"}, nil); !errors.Is(err, ErrDatabaseRecordValueHasNUL) {
			t.Fatalf("Update with NUL = %v, want ErrDatabaseRecordValueHasNUL", err)
		}
	})
}
