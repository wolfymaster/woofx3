package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ModuleResourceInstance is a runtime-created row representing one
// instance of a kind that an installed module declares it provides.
// Distinct from `ModuleResource` (which tracks installed surfaces like
// triggers and actions) — instances are user-data, created via module
// commands at runtime, deleted via the same path or by FK cascade when
// the parent module is uninstalled.
//
// Identity: `(module_id, kind, instance_id)`, enforced by the unique
// index `idx_mri_module_kind_instance`. The canonical id form
// `{module.name}:{kind}:{instance_id}` is derived at the service layer
// and not persisted.
//
// `DisplayName` is the user-facing label and may drift across the
// instance's lifetime without affecting identity.
type ModuleResourceInstance struct {
	ID          uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ModuleID    uuid.UUID `gorm:"column:module_id;type:uuid;not null;index;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Kind        string    `gorm:"column:kind;type:text;not null;index"`
	InstanceID  string    `gorm:"column:instance_id;type:text;not null"`
	DisplayName string    `gorm:"column:display_name;type:text;not null;default:''"`
	CreatedAt   time.Time `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`
	UpdatedAt   time.Time `gorm:"column:updated_at;default:CURRENT_TIMESTAMP;not null"`
}

func (ModuleResourceInstance) TableName() string {
	return "module_resource_instances"
}

func (m *ModuleResourceInstance) BeforeUpdate(tx *gorm.DB) error {
	m.UpdatedAt = time.Now()
	return nil
}
