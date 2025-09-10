package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Application struct {
	ID     uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	Name   string    `gorm:"type:varchar(50);not null"`
	UserID uuid.UUID `gorm:"column:user_id;type:uuid;not null;index:idx_applications_user_id"`

	// Relationships
	Settings            []Setting            `gorm:"foreignKey:ApplicationID;references:ID"`
	Commands            []Command            `gorm:"foreignKey:ApplicationID;references:ID"`
	Clients             []Client             `gorm:"foreignKey:ApplicationID;references:ID"`
	WorkflowDefinitions []WorkflowDefinition `gorm:"foreignKey:ApplicationID;references:ID"`
	Treats              []Treat              `gorm:"foreignKey:ApplicationID;references:ID"`
	UserApplications    []UserApplication    `gorm:"foreignKey:ApplicationID;references:ID"`
}

func (Application) TableName() string {
	return "applications"
}

// CRUD Operations
func (a *Application) Create(db *gorm.DB) error {
	return db.Create(a).Error
}

func (a *Application) Update(db *gorm.DB) error {
	return db.Save(a).Error
}

func (a *Application) Delete(db *gorm.DB) error {
	return db.Delete(a).Error
}

func GetApplicationByID(db *gorm.DB, id uuid.UUID) (*Application, error) {
	var app Application
	err := db.First(&app, "id = ?", id).Error
	return &app, err
}

func GetApplicationsByUserID(db *gorm.DB, userID uuid.UUID) ([]Application, error) {
	var apps []Application
	err := db.Where("user_id = ?", userID).Find(&apps).Error
	return apps, err
}

func GetApplicationWithAllRelations(db *gorm.DB, appID uuid.UUID) (*Application, error) {
	var app Application
	err := db.Preload("Settings").
		Preload("Commands").
		Preload("Clients").
		Preload("WorkflowDefinitions").
		Preload("Treats").
		First(&app, "id = ?", appID).Error
	return &app, err
}