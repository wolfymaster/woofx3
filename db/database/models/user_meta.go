package models

import (
	"time"

	"gorm.io/gorm"
	"github.com/google/uuid"
)

type UserMeta struct {
	ID        uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	UserID    int       `gorm:"column:userid;not null;index:idx_user_meta_userid;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Name      string    `gorm:"type:varchar(50);not null"`
	Type      string    `gorm:"type:varchar(50);not null"`
	Value     string    `gorm:"type:varchar(500)"`
	CreatedAt time.Time `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`

	// Relationships
	User User `gorm:"foreignKey:UserID;references:ID"`
}

func (UserMeta) TableName() string {
	return "user_meta"
}

func (um *UserMeta) Create(db *gorm.DB) error {
	return db.Create(um).Error
}

func (um *UserMeta) Update(db *gorm.DB) error {
	return db.Save(um).Error
}

func (um *UserMeta) Delete(db *gorm.DB) error {
	return db.Delete(um).Error
}

func GetUserMetaByID(db *gorm.DB, id uuid.UUID) (*UserMeta, error) {
	var meta UserMeta
	err := db.First(&meta, "id = ?", id).Error
	return &meta, err
}

func GetUserMetaByUserID(db *gorm.DB, userID int) ([]UserMeta, error) {
	var meta []UserMeta
	err := db.Where("userid = ?", userID).Find(&meta).Error
	return meta, err
}

func GetUserMetaByName(db *gorm.DB, userID int, name string) (*UserMeta, error) {
	var meta UserMeta
	err := db.Where("userid = ? AND name = ?", userID, name).First(&meta).Error
	return &meta, err
}

func GetUserMetaByType(db *gorm.DB, userID int, metaType string) ([]UserMeta, error) {
	var meta []UserMeta
	err := db.Where("userid = ? AND type = ?", userID, metaType).Find(&meta).Error
	return meta, err
}
