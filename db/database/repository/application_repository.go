package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

type ApplicationRepository struct {
	db *gorm.DB
}

func NewApplicationRepository(db *gorm.DB) *ApplicationRepository {
	return &ApplicationRepository{db: db}
}

func (r *ApplicationRepository) DB() *gorm.DB {
	return r.db
}

func (r *ApplicationRepository) Create(app *models.Application) error {
	return r.db.Create(app).Error
}

func (r *ApplicationRepository) GetByID(id uuid.UUID) (*models.Application, error) {
	var app models.Application
	err := r.db.First(&app, "id = ?", id).Error
	return &app, err
}

func (r *ApplicationRepository) GetDefault() (*models.Application, error) {
	var app models.Application
	err := r.db.Where("is_default = ?", true).First(&app).Error
	return &app, err
}

func (r *ApplicationRepository) List() ([]models.Application, error) {
	var apps []models.Application
	err := r.db.Find(&apps).Error
	return apps, err
}

func (r *ApplicationRepository) Update(app *models.Application) error {
	return r.db.Save(app).Error
}

func (r *ApplicationRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&models.Application{}, "id = ?", id).Error
}
