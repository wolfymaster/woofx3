package services

// import (
// 	"encoding/json"
// 	"errors"
// 	"fmt"
// 	"time"

// 	"gorm.io/gorm"
// 	"github.com/google/uuid"
	
// 	"github.com/wolfymaster/woofx3/db/models"
// )

// type settingService struct {
// 	baseService[models.Setting]
// }

// // NewSettingService creates a new instance of SettingService
// func NewSettingService() SettingService {
// 	return &settingService{
// 		baseService: baseService[models.Setting]{},
// 	}
// }

// // GetSetting retrieves a setting by key for a specific application and user
// func (s *settingService) GetSetting(db *gorm.DB, appID uuid.UUID, key string) (*models.Setting, error) {
// 	var setting models.Setting
// 	err := db.Where("application_id = ? AND key = ?", appID, key).
// 		First(&setting).Error

// 	if err != nil {
// 		if errors.Is(err, gorm.ErrRecordNotFound) {
// 			return nil, fmt.Errorf("setting not found")
// 		}
// 		return nil, fmt.Errorf("failed to get setting: %w", err)
// 	}

// 	return &setting, nil
// }

// // GetSettings retrieves all settings for a specific application and user
// func (s *settingService) GetSettings(db *gorm.DB, appID uuid.UUID) ([]models.Setting, error) {
// 	var settings []models.Setting
// 	err := db.Where("application_id = ?", appID).
// 		Find(&settings).Error

// 	if err != nil {
// 		return nil, fmt.Errorf("failed to get settings: %w", err)
// 	}

// 	return settings, nil
// }

// // SetSetting creates or updates a setting
// func (s *settingService) SetSetting(db *gorm.DB, setting *models.Setting) error {
// 	// Check if setting exists
// 	query := db.Where("application_id = ? AND key = ?", setting.ApplicationID, setting.Key)
// 	if setting.UserID != uuid.Nil {
// 		query = query.Where("user_id = ?", setting.UserID)
// 	} else {
// 		query = query.Where("user_id IS NULL")
// 	}

// 	var existing models.Setting
// 	err := query.First(&existing).Error
// 	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
// 		return fmt.Errorf("failed to check setting existence: %w", err)
// 	}

// 	now := time.Now()
// 	setting.UpdatedAt = now

// 	if errors.Is(err, gorm.ErrRecordNotFound) {
// 		setting.ID = uuid.New()
// 		setting.CreatedAt = now
// 		return s.Create(db, setting)
// 	}

// 	setting.ID = existing.ID
// 	setting.CreatedAt = existing.CreatedAt
// 	return s.Update(db, setting)
// }

// // DeleteSetting removes a setting
// func (s *settingService) DeleteSetting(db *gorm.DB, appID, userID uuid.UUID, key string) error {
// 	query := db.Where("application_id = ? AND key = ?", appID, key)
// 	if userID != uuid.Nil {
// 		query = query.Where("user_id = ?", userID)
// 	} else {
// 		query = query.Where("user_id IS NULL")
// 	}

// 	result := query.Delete(&models.Setting{})

// 	if result.Error != nil {
// 		return fmt.Errorf("failed to delete setting: %w", result.Error)
// 	}

// 	if result.RowsAffected == 0 {
// 		return fmt.Errorf("setting not found")
// 	}

// 	return nil
// }

// // GetSettingValue retrieves and unmarshals a setting value into the provided interface
// func (s *settingService) GetSettingValue(db *gorm.DB, appID, userID uuid.UUID, key string, out interface{}) error {
// 	setting, err := s.GetSetting(db, appID, key)
// 	if err != nil {
// 		return fmt.Errorf("failed to get setting: %w", err)
// 	}

// 	if setting.Value == "" {
// 		return nil
// 	}

// 	if err := json.Unmarshal([]byte(setting.Value), out); err != nil {
// 		return fmt.Errorf("failed to unmarshal setting value: %w", err)
// 	}

// 	return nil
// }
