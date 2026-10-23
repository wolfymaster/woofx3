package models

import (
	"fmt"
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
	Actions       string            `gorm:"column:actions;type:jsonb;not null;default:'[]'"`
	Cooldown      int               `gorm:"column:cooldown;default:0"`
	Priority      int               `gorm:"column:priority;default:0"`
	Enabled       bool              `gorm:"column:enabled;default:true"`
	CreatedByType string            `gorm:"column:created_by_type;type:text;not null;default:'USER'"`
	CreatedByRef  string            `gorm:"column:created_by_ref;type:text;not null;default:''"`
	CreatedAt     time.Time         `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`
	Visibility    CommandVisibility `gorm:"column:visibility;type:varchar(20);not null;default:'restricted'"`
	// ArgumentPattern declares "{variable}" placeholders (e.g. "{songTitle}"
	// or "{userA} {userB}") the command accepts as named arguments. Never
	// contains the bare command word itself - see command.proto's field
	// comment for the extraction rule.
	ArgumentPattern string `gorm:"column:argument_pattern;type:varchar(255);not null;default:''"`
	// WorkflowID is the stored workflow this command runs, nil when it has
	// none. A linked command's steps live in that workflow, and Actions is
	// "[]"; see command.proto's workflow_id comment.
	WorkflowID *uuid.UUID `gorm:"column:workflow_id;type:uuid"`
	// WorkflowError is why the command's actions could not become a workflow
	// when db-proxy converted it, and "" otherwise; see command.proto's
	// workflow_error comment.
	WorkflowError string `gorm:"column:workflow_error;type:text;not null;default:''"`
}

// CommandVisibility says who may invoke a command.
type CommandVisibility string

const (
	// CommandVisibilityPublic is always allowed; Casbin is never consulted.
	CommandVisibilityPublic CommandVisibility = "public"
	// CommandVisibilityRestricted allows only users in one of the command's
	// groups or listed as one of its users. With neither, nobody may invoke
	// it until the streamer grants access.
	CommandVisibilityRestricted CommandVisibility = "restricted"
)

// ParseCommandVisibility reads a visibility off the wire. Anything other
// than the two known values is an error, never a silent restricted.
func ParseCommandVisibility(value string) (CommandVisibility, error) {
	switch CommandVisibility(value) {
	case CommandVisibilityPublic, CommandVisibilityRestricted:
		return CommandVisibility(value), nil
	default:
		return "", fmt.Errorf("unknown visibility %q: want %q or %q",
			value, CommandVisibilityPublic, CommandVisibilityRestricted)
	}
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
