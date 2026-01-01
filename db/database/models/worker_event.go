package models

import (
	"time"

	"gorm.io/gorm"
)

type WorkerEventStatus string

const (
	WorkerEventStatusPending      WorkerEventStatus = "pending"
	WorkerEventStatusPublished    WorkerEventStatus = "published"
	WorkerEventStatusPublishing   WorkerEventStatus = "publishing"
	WorkerEventStatusAcknowledged WorkerEventStatus = "acknowledged"
	WorkerEventStatusFailed       WorkerEventStatus = "failed"
)

type WorkerEvent struct {
	ID string `gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`

	EventType     string `gorm:"type:varchar(255);not null;index"`
	ApplicationID string `gorm:"type:uuid;not null;index"`
	EntityType    string `gorm:"type:varchar(100);not null;index"`
	EntityID      string `gorm:"type:uuid;not null;index"`
	Operation     string `gorm:"type:varchar(50);not null"`

	Payload []byte `gorm:"type:jsonb;not null"`

	Status          WorkerEventStatus `gorm:"type:varchar(50);not null;default:'pending';index"`
	AutoAcknowledge bool              `gorm:"not null;default:true"`

	PublishedAt    *time.Time `gorm:"column:published_at"`
	AcknowledgedAt *time.Time `gorm:"column:acknowledged_at"`

	Attempts    int     `gorm:"not null;default:0"`
	MaxAttempts int     `gorm:"not null;default:3"`
	LastError   *string `gorm:"type:text"`

	NATSSubject string  `gorm:"type:varchar(500);not null"`
	AckSubject  *string `gorm:"type:varchar(500)"`

	CreatedAt time.Time `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;default:CURRENT_TIMESTAMP;not null"`
}

func (WorkerEvent) TableName() string {
	return "worker_events"
}

func (e *WorkerEvent) BeforeUpdate(tx *gorm.DB) error {
	e.UpdatedAt = time.Now()
	return nil
}

func (e *WorkerEvent) CanRetry() bool {
	return e.Attempts < e.MaxAttempts
}
