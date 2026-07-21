package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Group is the persisted, user-facing "user group" / role entity. It backs
// the Casbin `group:<id>` subject used in policy rows, but callers never
// need to know that - they only ever deal with Group rows and membership.
type Group struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ApplicationID uuid.UUID `gorm:"column:application_id;type:uuid;not null;index:idx_groups_application_id;constraint:OnDelete:CASCADE"`
	Name          string    `gorm:"column:name;type:varchar(100);not null"`
	Description   string    `gorm:"column:description;type:varchar(500);default:''"`
	CreatedAt     time.Time `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`
	UpdatedAt     time.Time `gorm:"column:updated_at;default:CURRENT_TIMESTAMP;not null"`
}

func (Group) TableName() string {
	return "groups"
}

func (g *Group) Create(db *gorm.DB) error {
	return db.Create(g).Error
}

func (g *Group) Update(db *gorm.DB) error {
	return db.Save(g).Error
}

func (g *Group) Delete(db *gorm.DB) error {
	return db.Delete(g).Error
}

func GetGroupByID(db *gorm.DB, id uuid.UUID) (*Group, error) {
	var group Group
	err := db.First(&group, "id = ?", id).Error
	return &group, err
}

func GetGroupsByApplicationID(db *gorm.DB, appID uuid.UUID) ([]Group, error) {
	var groups []Group
	err := db.Where("application_id = ?", appID).Order("name ASC").Find(&groups).Error
	return groups, err
}

// UserGroup records that a chat username belongs to a group. Membership is
// keyed by username (not a users.id foreign key) - see the migration
// comment in 0021_command_groups.go for why.
type UserGroup struct {
	Username  string    `gorm:"column:username;type:varchar(50);not null;primaryKey"`
	GroupID   uuid.UUID `gorm:"column:group_id;type:uuid;not null;primaryKey;index:idx_user_groups_group_id;constraint:OnDelete:CASCADE"`
	CreatedAt time.Time `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`
}

func (UserGroup) TableName() string {
	return "user_groups"
}
