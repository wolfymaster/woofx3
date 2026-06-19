package models

import (
	"time"

	"github.com/google/uuid"
)

type ModuleSetting struct {
	ID        uuid.UUID `gorm:"column:id;type:uuid;default:uuid_generate_v4();primaryKey"`
	ModuleID  string    `gorm:"column:module_id;type:text;not null;index"`
	Key       string    `gorm:"column:key;type:text;not null"`
	Value     string    `gorm:"column:value;type:text;not null;default:''"`
	ValueType string    `gorm:"column:value_type;type:text;not null;default:'string'"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (ModuleSetting) TableName() string { return "module_settings" }

type WidgetSetting struct {
	ID         uuid.UUID `gorm:"column:id;type:uuid;default:uuid_generate_v4();primaryKey"`
	ModuleID   string    `gorm:"column:module_id;type:text;not null;index"`
	WidgetID   string    `gorm:"column:widget_id;type:text;not null"`
	InstanceID string    `gorm:"column:instance_id;type:text;not null"`
	Key        string    `gorm:"column:key;type:text;not null"`
	Value      string    `gorm:"column:value;type:text;not null;default:''"`
	ValueType  string    `gorm:"column:value_type;type:text;not null;default:'string'"`
	CreatedAt  time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt  time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (WidgetSetting) TableName() string { return "widget_settings" }
