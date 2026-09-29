package repository

import (
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserEventRepository wraps gorm.DB with the platform event log.
type UserEventRepository struct {
	db *gorm.DB
}

func NewUserEventRepository(db *gorm.DB) *UserEventRepository {
	return &UserEventRepository{db: db}
}

// Record inserts an event unless one with the same (source, event_id) is
// already stored, and returns the stored row either way. The bool reports
// whether this call wrote it.
//
// The conflict is resolved by the unique constraint rather than a lookup
// first, so two deliveries of one event racing each other still produce a
// single row.
func (r *UserEventRepository) Record(event *models.UserEvent) (*models.UserEvent, bool, error) {
	result := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "source"}, {Name: "event_id"}},
		DoNothing: true,
	}).Create(event)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 1 {
		return event, true, nil
	}

	var stored models.UserEvent
	if err := r.db.Where("source = ? AND event_id = ?", event.Source, event.EventID).
		First(&stored).Error; err != nil {
		return nil, false, err
	}
	return &stored, false, nil
}
