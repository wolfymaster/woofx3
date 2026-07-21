package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// CommandPermissionRepository owns the command_groups/command_users join
// tables that record which groups/users may invoke a "restricted" command.
type CommandPermissionRepository struct {
	db *gorm.DB
}

func NewCommandPermissionRepository(db *gorm.DB) *CommandPermissionRepository {
	return &CommandPermissionRepository{db: db}
}

// ReplaceGroups deletes every existing command_groups row for commandID and
// inserts one row per groupID, in a single transaction.
func (r *CommandPermissionRepository) ReplaceGroups(commandID uuid.UUID, groupIDs []uuid.UUID) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("command_id = ?", commandID).Delete(&models.CommandGroup{}).Error; err != nil {
			return err
		}
		if len(groupIDs) == 0 {
			return nil
		}
		rows := make([]models.CommandGroup, len(groupIDs))
		for i, groupID := range groupIDs {
			rows[i] = models.CommandGroup{CommandID: commandID, GroupID: groupID}
		}
		return tx.Create(&rows).Error
	})
}

// ReplaceUsers deletes every existing command_users row for commandID and
// inserts one row per username, in a single transaction.
func (r *CommandPermissionRepository) ReplaceUsers(commandID uuid.UUID, usernames []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("command_id = ?", commandID).Delete(&models.CommandUser{}).Error; err != nil {
			return err
		}
		if len(usernames) == 0 {
			return nil
		}
		rows := make([]models.CommandUser, len(usernames))
		for i, username := range usernames {
			rows[i] = models.CommandUser{CommandID: commandID, Username: username}
		}
		return tx.Create(&rows).Error
	})
}

func (r *CommandPermissionRepository) ListGroupIDs(commandID uuid.UUID) ([]uuid.UUID, error) {
	var groupIDs []uuid.UUID
	err := r.db.Model(&models.CommandGroup{}).
		Where("command_id = ?", commandID).
		Pluck("group_id", &groupIDs).Error
	return groupIDs, err
}

func (r *CommandPermissionRepository) ListUsernames(commandID uuid.UUID) ([]string, error) {
	var usernames []string
	err := r.db.Model(&models.CommandUser{}).
		Where("command_id = ?", commandID).
		Order("username ASC").
		Pluck("username", &usernames).Error
	return usernames, err
}

// DeleteBySourceCommand removes every command_groups/command_users row for a
// deleted command.
func (r *CommandPermissionRepository) DeleteBySourceCommand(commandID uuid.UUID) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("command_id = ?", commandID).Delete(&models.CommandGroup{}).Error; err != nil {
			return err
		}
		return tx.Where("command_id = ?", commandID).Delete(&models.CommandUser{}).Error
	})
}
