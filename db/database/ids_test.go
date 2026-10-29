package database_test

import (
	"encoding/binary"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database"
	"gorm.io/gorm"
)

// sequentialIDs hands out 00000000-0000-0000-0000-000000000001, ...2, and so
// on, so a test knows which id each row gets.
type sequentialIDs struct {
	next uint64
}

func (s *sequentialIDs) NewUUID() uuid.UUID {
	s.next++
	var id uuid.UUID
	binary.BigEndian.PutUint64(id[8:], s.next)
	return id
}

func sequentialID(n uint64) uuid.UUID {
	var id uuid.UUID
	binary.BigEndian.PutUint64(id[8:], n)
	return id
}

// openMemoryDB opens an empty in-memory SQLite database through the same path
// production uses, with ids from `ids`.
func openMemoryDB(t *testing.T, ids database.IDSource) *gorm.DB {
	t.Helper()
	db, err := database.InitializeDB("sqlite:///:memory:", slog.New(slog.NewTextHandler(io.Discard, nil)), ids)
	if err != nil {
		t.Fatalf("InitializeDB: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			if err := sqlDB.Close(); err != nil {
				t.Errorf("close sqlite: %v", err)
			}
		}
	})
	return db
}

type uuidRow struct {
	ID   uuid.UUID `gorm:"type:uuid;primaryKey"`
	Name string
}

type stringUUIDRow struct {
	ID   string `gorm:"primaryKey;type:uuid"`
	Name string
}

type textKeyRow struct {
	ID   string `gorm:"primaryKey;type:varchar(255)"`
	Name string
}

type namedKeyRow struct {
	SessionID uuid.UUID `gorm:"column:session_id;type:uuid;primaryKey"`
	Name      string
}

type compositeKeyRow struct {
	ID      uuid.UUID `gorm:"type:uuid;primaryKey"`
	GroupID uuid.UUID `gorm:"type:uuid;primaryKey"`
}

func createTables(t *testing.T, db *gorm.DB) {
	t.Helper()
	stmts := []string{
		`CREATE TABLE uuid_row (id TEXT NOT NULL PRIMARY KEY, name TEXT)`,
		`CREATE TABLE string_uuid_row (id TEXT NOT NULL PRIMARY KEY, name TEXT)`,
		`CREATE TABLE text_key_row (id TEXT NOT NULL PRIMARY KEY, name TEXT)`,
		`CREATE TABLE named_key_row (session_id TEXT NOT NULL PRIMARY KEY, name TEXT)`,
		`CREATE TABLE composite_key_row (id TEXT NOT NULL, group_id TEXT NOT NULL, PRIMARY KEY (id, group_id))`,
	}
	for _, stmt := range stmts {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatalf("schema: %v", err)
		}
	}
}

func TestRegisterIDAssignment(t *testing.T) {
	supplied := uuid.MustParse("6f1d7c1e-3b0a-4c55-9d7e-2a4b8c0f1e23")
	tests := []struct {
		name  string
		check func(t *testing.T, db *gorm.DB)
	}{
		{
			name: "zero uuid id is assigned from the source",
			check: func(t *testing.T, db *gorm.DB) {
				row := uuidRow{Name: "a"}
				if err := db.Create(&row).Error; err != nil {
					t.Fatalf("create: %v", err)
				}
				if row.ID != sequentialID(1) {
					t.Fatalf("id = %s, want %s", row.ID, sequentialID(1))
				}
			},
		},
		{
			name: "caller-supplied id is kept",
			check: func(t *testing.T, db *gorm.DB) {
				row := uuidRow{ID: supplied, Name: "a"}
				if err := db.Create(&row).Error; err != nil {
					t.Fatalf("create: %v", err)
				}
				if row.ID != supplied {
					t.Fatalf("id = %s, want the supplied %s", row.ID, supplied)
				}
			},
		},
		{
			name: "string column tagged uuid is assigned",
			check: func(t *testing.T, db *gorm.DB) {
				row := stringUUIDRow{Name: "a"}
				if err := db.Create(&row).Error; err != nil {
					t.Fatalf("create: %v", err)
				}
				if row.ID != sequentialID(1).String() {
					t.Fatalf("id = %q, want %q", row.ID, sequentialID(1).String())
				}
			},
		},
		{
			name: "batch create assigns only the rows with no id",
			check: func(t *testing.T, db *gorm.DB) {
				rows := []*uuidRow{{Name: "a"}, {ID: supplied, Name: "b"}, {Name: "c"}}
				if err := db.Create(&rows).Error; err != nil {
					t.Fatalf("create: %v", err)
				}
				want := []uuid.UUID{sequentialID(1), supplied, sequentialID(2)}
				for i, row := range rows {
					if row.ID != want[i] {
						t.Fatalf("rows[%d].id = %s, want %s", i, row.ID, want[i])
					}
				}
			},
		},
		{
			name: "batch create of values assigns every row",
			check: func(t *testing.T, db *gorm.DB) {
				rows := []uuidRow{{Name: "a"}, {Name: "b"}}
				if err := db.Create(&rows).Error; err != nil {
					t.Fatalf("create: %v", err)
				}
				if rows[0].ID != sequentialID(1) || rows[1].ID != sequentialID(2) {
					t.Fatalf("ids = %s, %s", rows[0].ID, rows[1].ID)
				}
			},
		},
		{
			name: "text key that is not a uuid is left to the caller",
			check: func(t *testing.T, db *gorm.DB) {
				row := textKeyRow{Name: "a"}
				if err := db.Create(&row).Error; err != nil {
					t.Fatalf("create: %v", err)
				}
				if row.ID != "" {
					t.Fatalf("id = %q, want it left empty", row.ID)
				}
			},
		},
		{
			name: "uuid key under another name is left to the caller",
			check: func(t *testing.T, db *gorm.DB) {
				row := namedKeyRow{Name: "a"}
				if err := db.Create(&row).Error; err != nil {
					t.Fatalf("create: %v", err)
				}
				if row.SessionID != uuid.Nil {
					t.Fatalf("session_id = %s, want it left zero", row.SessionID)
				}
			},
		},
		{
			name: "composite key is left to the caller",
			check: func(t *testing.T, db *gorm.DB) {
				row := compositeKeyRow{GroupID: supplied}
				if err := db.Create(&row).Error; err != nil {
					t.Fatalf("create: %v", err)
				}
				if row.ID != uuid.Nil {
					t.Fatalf("id = %s, want it left zero", row.ID)
				}
			},
		},
		{
			name: "map create is untouched",
			check: func(t *testing.T, db *gorm.DB) {
				if err := db.Table("text_key_row").Create(map[string]interface{}{"id": "k", "name": "a"}).Error; err != nil {
					t.Fatalf("create: %v", err)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := openMemoryDB(t, &sequentialIDs{})
			createTables(t, db)
			tt.check(t, db)
		})
	}
}

func TestInitializeDBRefusesANilIDSource(t *testing.T) {
	_, err := database.InitializeDB("sqlite:///:memory:", slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	if err == nil {
		t.Fatal("InitializeDB accepted a nil id source")
	}
}
