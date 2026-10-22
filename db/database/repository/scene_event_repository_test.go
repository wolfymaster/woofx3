package repository

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// The clock is frozen, so both acks carry the same time and the timeline
// order rests on the tiebreak alone, as it does on SQLite when two acks land
// within its timestamp precision.
func TestSceneEventAcksAreLoggedInOrderOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		ackedAt := time.Date(2026, 10, 22, 12, 0, 1, 500000000, time.UTC)
		r := NewSceneEventRepository(db, func() time.Time { return ackedAt })
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
		if len(open) != 1 || open[0].DeliveredAt == nil || !open[0].DeliveredAt.Equal(ackedAt) {
			t.Fatalf("open deliveries = %+v, want one delivered at %v", open, ackedAt)
		}
		if err := r.RecordCompletion(event.ID, "overlay-1"); err != nil {
			t.Fatalf("RecordCompletion: %v", err)
		}

		log, total, err := r.ListSceneEventLog(&event.ID, nil, 0, 0)
		if err != nil {
			t.Fatalf("ListSceneEventLog: %v", err)
		}
		if total != 2 || len(log) != 2 || log[0].Kind != "delivered" || log[1].Kind != "completed" {
			t.Fatalf("timeline = %+v (total %d), want delivered then completed", log, total)
		}
		for _, entry := range log {
			if !entry.OccurredAt.Equal(ackedAt) {
				t.Errorf("%s occurred at %v, want the clock's %v", entry.Kind, entry.OccurredAt, ackedAt)
			}
		}
		if open, err := r.ListOpenDeliveries(nil); err != nil || len(open) != 0 {
			t.Fatalf("open deliveries after completion = %+v, %v; want none", open, err)
		}
	})
}

// Entries stamped with the same time list by id, not by where the database
// happened to store them: the later-written one here is stored first.
func TestSceneEventLogBreaksTimeTiesByIDOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		r := NewSceneEventRepository(db, time.Now)
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
		at := time.Date(2026, 10, 22, 12, 0, 1, 0, time.UTC)
		earlier := uuid.MustParse("01900000-0000-7000-8000-000000000001")
		later := uuid.MustParse("01900000-0000-7000-8000-000000000002")
		for _, entry := range []*models.SceneEventLogEntry{
			{ID: later, SceneEventID: event.ID, SceneID: scene.ID, InstanceID: "overlay-1", Kind: "completed", OccurredAt: at},
			{ID: earlier, SceneEventID: event.ID, SceneID: scene.ID, InstanceID: "overlay-1", Kind: "delivered", OccurredAt: at},
		} {
			if err := db.Create(entry).Error; err != nil {
				t.Fatalf("insert %s: %v", entry.Kind, err)
			}
		}

		log, _, err := r.ListSceneEventLog(&event.ID, nil, 0, 0)
		if err != nil {
			t.Fatalf("ListSceneEventLog: %v", err)
		}
		if len(log) != 2 || log[0].ID != earlier || log[1].ID != later {
			t.Fatalf("timeline = %+v, want %s then %s", log, earlier, later)
		}
	})
}
