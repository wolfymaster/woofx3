package models

import (
	"time"

	"github.com/google/uuid"
)

// DatabaseRecord is one row of a `woofx3:database` resource instance. Its
// columns are defined by the instance's `columns` setting; Values holds the
// row's cells as a JSON object keyed by column id, and an absent key is an
// empty cell. Values may hold viewer-written text, so it is never logged.
type DatabaseRecord struct {
	ID                 uuid.UUID `gorm:"type:uuid;primaryKey"`
	DatabaseInstanceID uuid.UUID `gorm:"column:database_instance_id;type:uuid;not null"`
	Values             string    `gorm:"column:record_values;type:jsonb;not null"`
	// InsertKey is the writer's idempotency key, unique per database.
	InsertKey *string `gorm:"column:insert_key;type:varchar(255)"`
	// Revision starts at 1 and grows by one per update, so readers of the
	// record's change events can drop one older than what they hold.
	Revision  int64     `gorm:"column:revision;not null"`
	CreatedAt time.Time `gorm:"column:created_at;not null;autoCreateTime:false"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;autoUpdateTime:false"`
}

func (DatabaseRecord) TableName() string {
	return "database_records"
}
