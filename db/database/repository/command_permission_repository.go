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

// WithDB returns a repository that runs on `db`, typically a transaction.
func (r *CommandPermissionRepository) WithDB(db *gorm.DB) *CommandPermissionRepository {
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

// GroupIDsByCommand is the groups granted each of commandIDs, in one query,
// keyed by command id. A command with no group has no entry.
func (r *CommandPermissionRepository) GroupIDsByCommand(commandIDs []uuid.UUID) (map[uuid.UUID][]uuid.UUID, error) {
	out := make(map[uuid.UUID][]uuid.UUID)
	if len(commandIDs) == 0 {
		return out, nil
	}
	var rows []models.CommandGroup
	if err := r.db.Where("command_id IN ?", commandIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.CommandID] = append(out[row.CommandID], row.GroupID)
	}
	return out, nil
}

// UsernamesByCommand is the users granted each of commandIDs, in one query,
// keyed by command id, each list sorted by username. A command with no user
// has no entry.
func (r *CommandPermissionRepository) UsernamesByCommand(commandIDs []uuid.UUID) (map[uuid.UUID][]string, error) {
	out := make(map[uuid.UUID][]string)
	if len(commandIDs) == 0 {
		return out, nil
	}
	var rows []models.CommandUser
	if err := r.db.Where("command_id IN ?", commandIDs).Order("username ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.CommandID] = append(out[row.CommandID], row.Username)
	}
	return out, nil
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
