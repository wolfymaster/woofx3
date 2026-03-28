package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Module struct {
	ID          uuid.UUID        `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	Name        string           `gorm:"column:name;type:text;not null;uniqueIndex"`
	Version     string           `gorm:"column:version;type:text;not null"`
	Manifest    string           `gorm:"column:manifest;type:text"`
	State       string           `gorm:"column:state;type:text;default:'active';not null"`
	ArchiveKey  string           `gorm:"column:archive_key;type:text"`
	InstalledAt time.Time        `gorm:"column:installed_at;default:CURRENT_TIMESTAMP;not null"`
	UpdatedAt   time.Time        `gorm:"column:updated_at;default:CURRENT_TIMESTAMP;not null"`
	Functions   []ModuleFunction `gorm:"foreignKey:ModuleID;references:ID"`
	Triggers    []ModuleTrigger  `gorm:"foreignKey:ModuleID"`
}

func (Module) TableName() string { return "modules" }

func (m *Module) BeforeUpdate(tx *gorm.DB) error {
	m.UpdatedAt = time.Now()
	return nil
}

func (m *Module) Create(db *gorm.DB) error {
	return db.Create(m).Error
}

func (m *Module) Update(db *gorm.DB) error {
	return db.Save(m).Error
}

func (m *Module) Delete(db *gorm.DB) error {
	return db.Delete(m).Error
}

func GetModuleByID(db *gorm.DB, id uuid.UUID) (*Module, error) {
	var mod Module
	err := db.Preload("Functions").First(&mod, "id = ?", id).Error
	return &mod, err
}

func GetModuleByName(db *gorm.DB, name string) (*Module, error) {
	var mod Module
	err := db.Preload("Functions").Where("name = ?", name).First(&mod).Error
	return &mod, err
}

func GetModulesByState(db *gorm.DB, state string) ([]*Module, error) {
	var modules []*Module
	err := db.Preload("Functions").Where("state = ?", state).Find(&modules).Error
	return modules, err
}

func GetAllModules(db *gorm.DB) ([]*Module, error) {
	var modules []*Module
	err := db.Preload("Functions").Find(&modules).Error
	return modules, err
}

type ModuleFunction struct {
	ID           uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ModuleID     uuid.UUID `gorm:"column:module_id;type:uuid;not null;index"`
	FunctionName string    `gorm:"column:function_name;type:text;not null"`
	FileName     string    `gorm:"column:file_name;type:text;not null"`
	FileKey      string    `gorm:"column:file_key;type:text;not null"`
	EntryPoint   string    `gorm:"column:entry_point;type:text;default:'main'"`
	Runtime      string    `gorm:"column:runtime;type:text;not null"`
}

func (ModuleFunction) TableName() string { return "module_functions" }

type ModuleTrigger struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ModuleID      uuid.UUID `gorm:"column:module_id;type:uuid;not null;index"`
	ModuleName    string    `gorm:"column:module_name;type:text;not null"`
	Category      string    `gorm:"column:category;type:text;not null"`
	Name          string    `gorm:"column:name;type:text;not null"`
	Description   string    `gorm:"column:description;type:text;not null"`
	Event         string    `gorm:"column:event;type:text;not null"`
	ConfigSchema  string    `gorm:"column:config_schema;type:jsonb;not null;default:'[]'"`
	AllowVariants bool      `gorm:"column:allow_variants;default:false"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (ModuleTrigger) TableName() string { return "module_triggers" }
