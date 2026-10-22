package repository

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

func TestSceneEventAcksAreLoggedOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		r := NewSceneEventRepository(db)
		scene := &models.Scene{Name: "Main"}
		if err := db.Create(scene).Error; err != nil {
			t.Fatalf("create scene: %v", err)
		}
		event, err := r.RecordSceneEvent(&models.SceneEvent{
			ID: uuid.New(), SceneID: scene.ID, Type: "alert", Key: "follow", Value: "{}",
			OccurredAt: time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC),
		}, []string{"overlay-1"})
		if err != nil {
			t.Fatalf("RecordSceneEvent: %v", err)
		}

		if err := r.RecordDelivery(event.ID, "overlay-1"); err != nil {
			t.Fatalf("RecordDelivery: %v", err)
		}
		open, err := r.ListOpenDeliveries(nil)
		if err != nil {
			t.Fatalf("ListOpenDeliveries: %v", err)
		}
		if len(open) != 1 || open[0].DeliveredAt == nil || open[0].DeliveredAt.IsZero() {
			t.Fatalf("open deliveries = %+v, want one stamped delivered", open)
		}
		if err := r.RecordCompletion(event.ID, "overlay-1"); err != nil {
			t.Fatalf("RecordCompletion: %v", err)
		}

		var log []models.SceneEventLogEntry
		if err := db.Where("scene_event_id = ?", event.ID).Order("kind").Find(&log).Error; err != nil {
			t.Fatalf("read log: %v", err)
		}
		if len(log) != 2 || log[0].Kind != "completed" || log[1].Kind != "delivered" || log[0].ID == log[1].ID || log[0].OccurredAt.IsZero() {
			t.Fatalf("log = %+v, want a completed and a delivered entry with ids and times", log)
		}
		if open, err := r.ListOpenDeliveries(nil); err != nil || len(open) != 0 {
			t.Fatalf("open deliveries after completion = %+v, %v; want none", open, err)
		}
	})
}
