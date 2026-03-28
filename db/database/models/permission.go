package models

import (
	"github.com/google/uuid"
)

type Permission struct {
	ID            int       `gorm:"primaryKey;autoIncrement"`
	ApplicationID uuid.UUID `gorm:"column:application_id;type:uuid;not null;index:idx_permission_application_id;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Ptype         string    `gorm:"column:ptype;type:varchar(100);not null;index:idx_permission_ptype"`
	V0            string    `gorm:"column:v0;type:varchar(100);index:idx_permission_v0"`
	V1            string    `gorm:"column:v1;type:varchar(100);index:idx_permission_v1"`
	V2            string    `gorm:"column:v2;type:varchar(100);index:idx_permission_v2"`
	V3            string    `gorm:"column:v3;type:varchar(100)"`
	V4            string    `gorm:"column:v4;type:varchar(100)"`
	V5            string    `gorm:"column:v5;type:varchar(100)"`

	// Relationships
	Application Application `gorm:"foreignKey:ApplicationID;references:ID"`
}

func (Permission) TableName() string {
	return "permissions"
}
