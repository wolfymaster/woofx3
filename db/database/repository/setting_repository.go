package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

type SettingRepository struct {
	db *gorm.DB
}

func NewSettingRepository(db *gorm.DB) *SettingRepository {
	return &SettingRepository{db: db}
}

func (r *SettingRepository) DB() *gorm.DB {
	return r.db
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

func (r *SettingRepository) GetSettingsByKeys(appID uuid.UUID, keys []string) ([]models.Setting, error) {
	var settings []models.Setting
	err := r.db.Where("application_id = ? AND key IN ?", appID, keys).Find(&settings).Error
	return settings, err
}

func (r *SettingRepository) GetSettingsByKeyPrefix(appID uuid.UUID, prefix string) ([]models.Setting, error) {
	var settings []models.Setting
	err := r.db.Where("application_id = ? AND key LIKE ?", appID, prefix+"%").Find(&settings).Error
	return settings, err
}

func (r *SettingRepository) DeleteByKey(appID uuid.UUID, key string) error {
	return r.db.Where("application_id = ? AND key = ?", appID, key).Delete(&models.Setting{}).Error
}

// UpsertSetting writes (or updates) a setting row. `userID` is optional —
// pass nil for application-scoped settings; pass a non-nil pointer for
// settings that should be tied to a specific user (e.g., the Twitch
// broadcaster id stored alongside `twitch_token`). The user_id column is
// updated on every write so the row's user scope can be re-bound by a
// subsequent SetSetting call without a separate update path.
func (r *SettingRepository) UpsertSetting(appID uuid.UUID, key, value string, userID *uuid.UUID) error {
	setting := models.Setting{
		ApplicationID: appID,
		Key:           key,
		Value:         value,
		UserID:        userID,
	}
	return r.db.Where("application_id = ? AND key = ?", appID, key).
		Assign(models.Setting{Value: value, UserID: userID}).
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
