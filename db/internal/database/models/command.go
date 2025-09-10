package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Command struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ApplicationID uuid.UUID `gorm:"column:application_id;type:uuid;not null;index:idx_commands_application_id;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Command       string    `gorm:"column:command;type:varchar(255);not null"`
	Type          string    `gorm:"column:type;type:varchar(50);not null"`
	TypeValue     string    `gorm:"column:type_value;type:varchar(500)"`
	Cooldown      int       `gorm:"column:cooldown;default:0"`
	CreatedBy     uuid.UUID `gorm:"column:created_by;type:uuid"`
	Priority      int       `gorm:"column:priority;default:0"`
	Enabled       bool      `gorm:"column:enabled;default:true"`
	CreatedAt     time.Time `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`

	// Relationships
	Application Application `gorm:"foreignKey:ApplicationID;references:ID"`
}

func (Command) TableName() string {
	return "commands"
}

func (c *Command) Create(db *gorm.DB) error {
	return db.Create(c).Error
}

func (c *Command) Update(db *gorm.DB) error {
	return db.Save(c).Error
}

func (c *Command) Delete(db *gorm.DB) error {
	return db.Delete(c).Error
}

func GetCommandByID(db *gorm.DB, id uuid.UUID) (*Command, error) {
	var cmd Command
	err := db.First(&cmd, "id = ?", id).Error
	return &cmd, err
}

func GetCommandsByApplicationID(db *gorm.DB, appID uuid.UUID) ([]Command, error) {
	var commands []Command
	err := db.Where("application_id = ?", appID).Order("priority DESC, created_at ASC").Find(&commands).Error
	return commands, err
}

func GetCommandByName(db *gorm.DB, appID uuid.UUID, command string) (*Command, error) {
	var cmd Command
	err := db.Where("application_id = ? AND command = ?", appID, command).First(&cmd).Error
	return &cmd, err
}

func GetCommandsByType(db *gorm.DB, appID uuid.UUID, cmdType string) ([]Command, error) {
	var commands []Command
	err := db.Where("application_id = ? AND type = ?", appID, cmdType).
		Order("priority DESC, created_at ASC").Find(&commands).Error
	return commands, err
}
