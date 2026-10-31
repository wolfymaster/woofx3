package moduleworkflows

import (
	"encoding/json"
	"testing"

	"github.com/libtnb/sqlite"
	"gorm.io/gorm"
)

func openWorkflows(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := db.Exec(`CREATE TABLE workflow_definitions (id TEXT PRIMARY KEY, trigger TEXT,
		created_by_type TEXT, manifest_id TEXT, created_at INTEGER, updated_at TEXT)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	return db
}

func TestApply(t *testing.T) {
	seed := []struct {
		id, trigger, createdBy, manifestID string
		want                               *int
	}{
		{"mine", `{"type":"event","event":"channel.cheer","order":2}`, "USER", "", intp(2)},
		{"loose", `{"type":"event","event":"channel.cheer"}`, "USER", "", nil},
		{"first", `{"type":"event","event":"channel.cheer"}`, "MODULE", "a", intp(3)},
		{"second", `{"type":"event","event":"channel.cheer"}`, "MODULE", "b", intp(4)},
		{"other", `{"type":"event","event":"user.message"}`, "MODULE", "c", intp(0)},
		{"done", `{"type":"event","event":"stream.online","order":7}`, "MODULE", "d", intp(7)},
		{"command", `{"type":"command","event":"chat.command.x"}`, "MODULE", "e", nil},
		{"broken", `{`, "MODULE", "f", nil},
	}
	db := openWorkflows(t)
	for index, row := range seed {
		if err := db.Exec(`INSERT INTO workflow_definitions VALUES (?, ?, ?, ?, ?, '')`,
			row.id, row.trigger, row.createdBy, row.manifestID, index).Error; err != nil {
			t.Fatalf("seed %s: %v", row.id, err)
		}
	}
	dialect := Dialect{Workflows: "workflow_definitions", JSON: "?"}

	ordered, err := Apply(db, dialect)
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if ordered != 3 {
		t.Fatalf("ordered = %d, want 3", ordered)
	}
	again, err := Apply(db, dialect)
	if err != nil {
		t.Fatalf("second Apply: %v", err)
	}
	if again != 0 {
		t.Fatalf("second Apply ordered %d, want 0", again)
	}

	for _, row := range seed {
		t.Run(row.id, func(t *testing.T) {
			var stored string
			if err := db.Raw(`SELECT trigger FROM workflow_definitions WHERE id = ?`, row.id).Scan(&stored).Error; err != nil {
				t.Fatalf("read: %v", err)
			}
			if row.id == "broken" {
				if stored != row.trigger {
					t.Fatalf("broken trigger rewritten: %s", stored)
				}
				return
			}
			var trigger orderedTrigger
			if err := json.Unmarshal([]byte(stored), &trigger); err != nil {
				t.Fatalf("parse: %v", err)
			}
			switch {
			case row.want == nil && trigger.Order != nil:
				t.Fatalf("order = %d, want none", *trigger.Order)
			case row.want != nil && (trigger.Order == nil || *trigger.Order != *row.want):
				t.Fatalf("order = %v, want %d", trigger.Order, *row.want)
			}
		})
	}
}

func intp(value int) *int {
	return &value
}
