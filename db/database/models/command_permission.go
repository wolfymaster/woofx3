package models

import "github.com/google/uuid"

// CommandGroup records that a group may invoke a command. Only consulted
// when the command's visibility is "restricted" - see command.go.
type CommandGroup struct {
	CommandID uuid.UUID `gorm:"column:command_id;type:uuid;not null;primaryKey;constraint:OnDelete:CASCADE"`
	GroupID   uuid.UUID `gorm:"column:group_id;type:uuid;not null;primaryKey;index:idx_command_groups_group_id;constraint:OnDelete:CASCADE"`
}

func (CommandGroup) TableName() string {
	return "command_groups"
}

// CommandUser records that a specific chat username may invoke a command,
// independent of any group membership. Only consulted when the command's
// visibility is "restricted".
type CommandUser struct {
	CommandID uuid.UUID `gorm:"column:command_id;type:uuid;not null;primaryKey;constraint:OnDelete:CASCADE"`
	Username  string    `gorm:"column:username;type:varchar(50);not null;primaryKey;index:idx_command_users_username"`
}

func (CommandUser) TableName() string {
	return "command_users"
}
