package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/internal/database/models"
	"gorm.io/gorm"
)

type SettingRepository struct {
	db *gorm.DB
}

func NewSettingRepository(db *gorm.DB) *SettingRepository {
	return &SettingRepository{db: db}
}

func (r *SettingRepository) GetSettingByKey(appID uuid.UUID, key string) (*models.Setting, error) {
	var setting models.Setting
	err := r.db.Where("application_id = ? AND key = ?", appID, key).First(&setting).Error
	return &setting, err
}

func (r *SettingRepository) GetSettingByID(id int) (*models.Setting, error) {
	var setting models.Setting
	err := r.db.First(&setting, id).Error
	return &setting, err
}

func (r *SettingRepository) GetSettingsByApplicationID(appID uuid.UUID) ([]models.Setting, error) {
	var settings []models.Setting
	err := r.db.Where("application_id = ?", appID).Find(&settings).Error
	return settings, err
}

func (r *SettingRepository) UpsertSetting(appID uuid.UUID, key, value string) error {
	setting := models.Setting{
		ApplicationID: appID,
		Key:           key,
		Value:         value,
	}
	return r.db.Where("application_id = ? AND key = ?", appID, key).
		Assign(models.Setting{Value: value}).
		FirstOrCreate(&setting).Error
}

func (r *SettingRepository) Create(setting *models.Setting) error {
	return r.db.Create(setting).Error
}

func (r *SettingRepository) Update(settings *models.Setting) error {
	return r.db.Save(settings).Error
}

func (r *SettingRepository) Delete(settings *models.Setting) error {
	return r.db.Delete(settings).Error
}
