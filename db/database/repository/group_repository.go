package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// GroupRepository represents the db functions for Groups and group membership.
type GroupRepository struct {
	db *gorm.DB
}

func NewGroupRepository(db *gorm.DB) *GroupRepository {
	return &GroupRepository{db: db}
}

func (r *GroupRepository) Create(group *models.Group) error {
	return r.db.Create(group).Error
}

func (r *GroupRepository) Update(group *models.Group) error {
	return r.db.Save(group).Error
}

func (r *GroupRepository) Delete(group *models.Group) error {
	return r.db.Delete(group).Error
}

func (r *GroupRepository) GetByID(id uuid.UUID) (*models.Group, error) {
	var group models.Group
	err := r.db.Where("id = ?", id).First(&group).Error
	return &group, err
}

func (r *GroupRepository) List() ([]models.Group, error) {
	var groups []models.Group
	err := r.db.Order("name ASC").Find(&groups).Error
	return groups, err
}

// AddMember records that username belongs to groupID. Idempotent.
func (r *GroupRepository) AddMember(groupID uuid.UUID, username string) error {
	var membership models.UserGroup
	return r.db.Where(&models.UserGroup{Username: username, GroupID: groupID}).
		FirstOrCreate(&membership, models.UserGroup{Username: username, GroupID: groupID}).Error
}

// RemoveMember deletes the membership row, if present.
func (r *GroupRepository) RemoveMember(groupID uuid.UUID, username string) error {
	return r.db.Where("username = ? AND group_id = ?", username, groupID).
		Delete(&models.UserGroup{}).Error
}

// ListMembers returns the usernames belonging to groupID.
func (r *GroupRepository) ListMembers(groupID uuid.UUID) ([]string, error) {
	var usernames []string
	err := r.db.Model(&models.UserGroup{}).
		Where("group_id = ?", groupID).
		Order("username ASC").
		Pluck("username", &usernames).Error
	return usernames, err
}

// ListGroupsForUser returns every group that username belongs to.
func (r *GroupRepository) ListGroupsForUser(username string) ([]models.Group, error) {
	var groups []models.Group
	err := r.db.
		Joins("JOIN user_groups ON user_groups.group_id = groups.id").
		Where("user_groups.username = ?", username).
		Order("groups.name ASC").
		Find(&groups).Error
	return groups, err
}

// GetByIDs returns the groups matching ids, in no particular order. Used to
// resolve a command's grants to their names/built-in flags in one round trip.
func (r *GroupRepository) GetByIDs(ids []uuid.UUID) ([]models.Group, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var groups []models.Group
	err := r.db.Where("id IN ?", ids).Find(&groups).Error
	return groups, err
}

// GetByName looks up one group by its unique name.
func (r *GroupRepository) GetByName(name string) (*models.Group, error) {
	var group models.Group
	err := r.db.Where("name = ?", name).First(&group).Error
	return &group, err
}
