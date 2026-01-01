package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Treat struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ApplicationID uuid.UUID `gorm:"column:application_id;type:uuid;not null;index:idx_treats_application_id;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Name          string    `gorm:"type:varchar(100);not null"`
	ActivationMin int       `gorm:"column:activation_min;default:0"`
	ActivationMax int       `gorm:"column:activation_max;default:0"`
	Type          string    `gorm:"type:varchar(20);not null"`
	TypeValue     string    `gorm:"column:type_value;type:json"`
	CreatedAt     time.Time `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`

	// Relationships
	// Application Application `gorm:"foreignKey:ApplicationID;references:ID"`
}

func (Treat) TableName() string {
	return "treats"
}

// CRUD Operations
func (t *Treat) Create(db *gorm.DB) error {
	return db.Create(t).Error
}

func (t *Treat) Update(db *gorm.DB) error {
	return db.Save(t).Error
}

func (t *Treat) Delete(db *gorm.DB) error {
	return db.Delete(t).Error
}

func GetTreatByID(db *gorm.DB, id uuid.UUID) (*Treat, error) {
	var treat Treat
	err := db.First(&treat, "id = ?", id).Error
	return &treat, err
}

func GetTreatsByApplicationID(db *gorm.DB, appID uuid.UUID) ([]Treat, error) {
	var treats []Treat
	err := db.Where("application_id = ?", appID).Order("created_at DESC").Find(&treats).Error
	return treats, err
}

func GetTreatByName(db *gorm.DB, appID uuid.UUID, name string) (*Treat, error) {
	var treat Treat
	err := db.Where("application_id = ? AND name = ?", appID, name).First(&treat).Error
	return &treat, err
}

func GetTreatsByType(db *gorm.DB, appID uuid.UUID, treatType string) ([]Treat, error) {
	var treats []Treat
	err := db.Where("application_id = ? AND type = ?", appID, treatType).
		Order("created_at DESC").Find(&treats).Error
	return treats, err
}

func GetActiveTreats(db *gorm.DB, appID uuid.UUID, currentValue int) ([]Treat, error) {
	var treats []Treat
	err := db.Where("application_id = ? AND activation_min <= ? AND (activation_max = 0 OR activation_max >= ?)",
		appID, currentValue, currentValue).
		Order("created_at DESC").Find(&treats).Error
	return treats, err
}
