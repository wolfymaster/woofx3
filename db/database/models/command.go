package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Command struct {
	ID      uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	Command string    `gorm:"column:command;type:varchar(255);not null"`
	// Actions is the JSON array of steps this command runs, in order. Same
	// shape as workflow_definitions.steps, because it is the same thing -- see
	// command.proto's actions_json comment. "[]" is a command that only
	// announces itself on chat.command.<slug>.
	Actions       string    `gorm:"column:actions;type:jsonb;not null;default:'[]'"`
	Cooldown      int       `gorm:"column:cooldown;default:0"`
	Priority      int       `gorm:"column:priority;default:0"`
	Enabled       bool      `gorm:"column:enabled;default:true"`
	CreatedByType string    `gorm:"column:created_by_type;type:text;not null;default:'USER'"`
	CreatedByRef  string    `gorm:"column:created_by_ref;type:text;not null;default:''"`
	CreatedAt     time.Time `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`
	// Visibility is "public" (always allowed, Casbin is never consulted) or
	// "restricted" (the invoking user must belong to one of this command's
	// groups or be listed as one of its users).
	Visibility string `gorm:"column:visibility;type:varchar(20);not null;default:'restricted'"`
	// ArgumentPattern declares "{variable}" placeholders (e.g. "{songTitle}"
	// or "{userA} {userB}") the command accepts as named arguments. Never
	// contains the bare command word itself - see command.proto's field
	// comment for the extraction rule.
	ArgumentPattern string `gorm:"column:argument_pattern;type:varchar(255);not null;default:''"`
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

func GetCommandByName(db *gorm.DB, command string) (*Command, error) {
	var cmd Command
	err := db.Where("command = ?", command).First(&cmd).Error
	return &cmd, err
}

func GetCommandsByType(db *gorm.DB, cmdType string) ([]Command, error) {
	var commands []Command
	err := db.Where("type = ?", cmdType).
		Order("priority DESC, created_at ASC").Find(&commands).Error
	return commands, err
}
