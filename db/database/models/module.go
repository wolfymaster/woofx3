package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Module struct {
	ID            uuid.UUID        `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ModuleKey     string           `gorm:"column:module_key;type:text;not null;uniqueIndex"`
	Name          string           `gorm:"column:name;type:text;not null;uniqueIndex"`
	Version       string           `gorm:"column:version;type:text;not null"`
	Manifest      string           `gorm:"column:manifest;type:text"`
	State         string           `gorm:"column:state;type:text;default:'active';not null"`
	ArchiveKey    string           `gorm:"column:archive_key;type:text"`
	CreatedByType string           `gorm:"column:created_by_type;type:text;not null;default:'USER'"`
	CreatedByRef  string           `gorm:"column:created_by_ref;type:text;not null;default:''"`
	InstalledAt   time.Time        `gorm:"column:installed_at;default:CURRENT_TIMESTAMP;not null"`
	UpdatedAt     time.Time        `gorm:"column:updated_at;default:CURRENT_TIMESTAMP;not null"`
	Functions []ModuleFunction `gorm:"foreignKey:ModuleID;references:ID"`
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
	ID         uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ModuleID   uuid.UUID `gorm:"column:module_id;type:uuid;not null;index"`
	// Stable manifest-local function id (e.g. "play_alert"). Forms the
	// canonical id `{moduleId}:function:{manifest_id}`. Used by every
	// reference and lookup; symmetric with `triggers.manifest_id` and
	// `actions.manifest_id`.
	ManifestID string `gorm:"column:manifest_id;type:text;not null;default:''"`
	// Display name for UI presentation; never used as an identifier.
	Name       string `gorm:"column:name;type:text;not null;default:''"`
	FileName   string `gorm:"column:file_name;type:text;not null"`
	FileKey    string `gorm:"column:file_key;type:text;not null"`
	EntryPoint string `gorm:"column:entry_point;type:text;default:'main'"`
	Runtime    string `gorm:"column:runtime;type:text;not null"`
}

func (ModuleFunction) TableName() string { return "functions" }

type Trigger struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	Category      string    `gorm:"column:category;type:text;not null"`
	Name          string    `gorm:"column:name;type:text;not null"`
	Description   string    `gorm:"column:description;type:text;not null"`
	Event         string    `gorm:"column:event;type:text;not null"`
	ConfigSchema  string    `gorm:"column:config_schema;type:jsonb;not null;default:'[]'"`
	AllowVariants bool      `gorm:"column:allow_variants;default:false"`
	CreatedByType string    `gorm:"column:created_by_type;type:text;not null;default:'MODULE'"`
	CreatedByRef  string    `gorm:"column:created_by_ref;type:text;not null;default:''"`
	ManifestID    string    `gorm:"column:manifest_id;type:text;not null;default:''"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (Trigger) TableName() string { return "triggers" }

type Action struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	Name          string    `gorm:"column:name;type:text;not null"`
	Description   string    `gorm:"column:description;type:text;not null"`
	Call          string    `gorm:"column:call;type:text;not null"`
	ParamsSchema  string    `gorm:"column:params_schema;type:jsonb;not null;default:'{}'"`
	CreatedByType string    `gorm:"column:created_by_type;type:text;not null;default:'MODULE'"`
	CreatedByRef  string    `gorm:"column:created_by_ref;type:text;not null;default:''"`
	ManifestID    string    `gorm:"column:manifest_id;type:text;not null;default:''"`
	// Type names the engine action handler this action dispatches to
	// (`function`, `alert`, `print`, …). For function-type actions
	// `Call` holds the canonical function id; for non-function
	// built-ins (e.g. `alert`) `Call` is empty and `Type` IS the
	// dispatch.
	Type      string `gorm:"column:type;type:text;not null;default:'function'"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Action) TableName() string { return "actions" }

// Asset is the engine's record of a static media file bundled with a
// module. Mirrors `Trigger` and `Action` in shape — decoupled from
// `modules` (no FK), idempotent registration via
// `(created_by_type, created_by_ref, manifest_id)`.
//
// `RepositoryKey` is the path the engine wrote the bytes to in its
// configured repository (file / S3 / future Convex storage). The URL
// the editor / overlay actually fetches from comes from the
// deployer's URL pipeline — the engine doesn't carry one on the row.
type Asset struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	Name          string    `gorm:"column:name;type:text;not null"`
	Description   string    `gorm:"column:description;type:text;not null;default:''"`
	ManifestPath  string    `gorm:"column:manifest_path;type:text;not null"`
	RepositoryKey string    `gorm:"column:repository_key;type:text;not null"`
	Kind          string    `gorm:"column:kind;type:text;not null;default:''"`
	ContentType   string    `gorm:"column:content_type;type:text;not null;default:''"`
	CreatedByType string    `gorm:"column:created_by_type;type:text;not null;default:'MODULE'"`
	CreatedByRef  string    `gorm:"column:created_by_ref;type:text;not null;default:''"`
	ManifestID    string    `gorm:"column:manifest_id;type:text;not null;default:''"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (Asset) TableName() string { return "assets" }

type ModuleResource struct {
	ID              uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ModuleID        uuid.UUID `gorm:"column:module_id;type:uuid;not null;index"`
	ResourceType    string    `gorm:"column:resource_type;type:text;not null"`
	ResourceID      *uuid.UUID `gorm:"column:resource_id;type:uuid"`
	ManifestID      string    `gorm:"column:manifest_id;type:text;not null"`
	ResourceName    string    `gorm:"column:resource_name;type:text;not null"`
	OriginalVersion string    `gorm:"column:original_version;type:text;not null"`
	CurrentVersion  string    `gorm:"column:current_version;type:text;not null"`
	InstalledAt     time.Time `gorm:"column:installed_at;default:CURRENT_TIMESTAMP;not null"`
	UpdatedAt       time.Time `gorm:"column:updated_at;default:CURRENT_TIMESTAMP;not null"`
}

func (ModuleResource) TableName() string { return "module_resources" }
