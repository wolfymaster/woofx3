package repository

import (
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ModuleSettingRepository interface {
	ListByModule(moduleID string) ([]models.ModuleSetting, error)
	Upsert(s models.ModuleSetting) error
	// UpsertDefault inserts a setting only when no row exists for (module_id, key).
	// Existing values are left untouched — preserves user-configured values on upgrade.
	UpsertDefault(moduleID, key, value, valueType string) error
}

type WidgetSettingRepository interface {
	ListByWidget(moduleID, widgetID, instanceID string) ([]models.WidgetSetting, error)
	Upsert(s models.WidgetSetting) error
}

type moduleSettingRepository struct {
	db *gorm.DB
}

func NewModuleSettingRepository(db *gorm.DB) ModuleSettingRepository {
	return &moduleSettingRepository{db: db}
}

func (r *moduleSettingRepository) ListByModule(moduleID string) ([]models.ModuleSetting, error) {
	var rows []models.ModuleSetting
	err := r.db.Where("module_id = ?", moduleID).Find(&rows).Error
	return rows, err
}

func (r *moduleSettingRepository) Upsert(s models.ModuleSetting) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "module_id"}, {Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "value_type", "updated_at"}),
	}).Create(&s).Error
}

func (r *moduleSettingRepository) UpsertDefault(moduleID, key, value, valueType string) error {
	s := models.ModuleSetting{
		ModuleID:  moduleID,
		Key:       key,
		Value:     value,
		ValueType: valueType,
	}
	// ON CONFLICT DO NOTHING — preserves the existing value on upgrade.
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "module_id"}, {Name: "key"}},
		DoNothing: true,
	}).Create(&s).Error
}

type widgetSettingRepository struct {
	db *gorm.DB
}

func NewWidgetSettingRepository(db *gorm.DB) WidgetSettingRepository {
	return &widgetSettingRepository{db: db}
}

func (r *widgetSettingRepository) ListByWidget(moduleID, widgetID, instanceID string) ([]models.WidgetSetting, error) {
	var rows []models.WidgetSetting
	err := r.db.Where("module_id = ? AND widget_id = ? AND instance_id = ?", moduleID, widgetID, instanceID).Find(&rows).Error
	return rows, err
}

func (r *widgetSettingRepository) Upsert(s models.WidgetSetting) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "module_id"}, {Name: "widget_id"}, {Name: "instance_id"}, {Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "value_type", "updated_at"}),
	}).Create(&s).Error
}
