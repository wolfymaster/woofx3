package repository

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

func TestWidgetStatusUpsertInsertsThenReplacesOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		r := NewWidgetStatusRepository(db)
		at := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)

		first, err := r.Upsert(&models.WidgetStatus{InstanceID: "timer-1", Key: "remaining", Value: `5`, OccurredAt: at})
		if err != nil {
			t.Fatalf("first Upsert: %v", err)
		}
		if first.ID == uuid.Nil {
			t.Fatal("inserted row has no id")
		}
		second, err := r.Upsert(&models.WidgetStatus{InstanceID: "timer-1", Key: "remaining", Value: `4`, OccurredAt: at.Add(time.Second)})
		if err != nil {
			t.Fatalf("second Upsert: %v", err)
		}
		if second.ID != first.ID || second.Value != `4` {
			t.Fatalf("replaced row = %+v, want id %s with value 4", second, first.ID)
		}
	})
}
