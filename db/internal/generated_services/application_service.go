package services

// import (
// 	"context"
// 	"crypto/rand"
// 	"encoding/base64"
// 	"fmt"
// 	"time"

// 	"gorm.io/gorm"
// 	"github.com/google/uuid"
	
// 	"github.com/wolfymaster/woofx3/db/models"
// )

// type applicationService struct {
// 	baseService[models.Application]
// }

// // NewApplicationService creates a new instance of ApplicationService
// func NewApplicationService() ApplicationService {
// 	return &applicationService{
// 		baseService: baseService[models.Application]{},
// 	}
// }

// // CreateClient creates a new client for an application
// func (s *applicationService) CreateClient(db *gorm.DB, appID uuid.UUID, description string) (*models.Client, error) {
// 	client := &models.Client{
// 		ApplicationID: appID,
// 		ClientID:      uuid.New(),
// 		ClientSecret:  generateClientSecret(),
// 		Description:   description,
// 	}

// 	if err := client.Create(db); err != nil {
// 		return nil, fmt.Errorf("failed to create client: %w", err)
// 	}

// 	return client, nil
// }

// // GetClients retrieves all clients for an application
// func (s *applicationService) GetClients(db *gorm.DB, appID uuid.UUID) ([]models.Client, error) {
// 	return models.GetClientsByApplicationID(db, appID)
// }

// // DeleteClient removes a client by ID
// func (s *applicationService) DeleteClient(db *gorm.DB, clientID int) error {
// 	client, err := models.GetClientByID(db, clientID)
// 	if err != nil {
// 		return fmt.Errorf("failed to find client: %w", err)
// 	}

// 	if err := client.Delete(db); err != nil {
// 		return fmt.Errorf("failed to delete client: %w", err)
// 	}

// 	return nil
// }

// // generateClientSecret generates a secure random client secret
// func generateClientSecret() string {
// 	key := make([]byte, 32) // 256 bits
// 	if _, err := rand.Read(key); err != nil {
// 		panic(fmt.Errorf("failed to generate random bytes: %w", err))
// 	}
// 	return base64.URLEncoding.EncodeToString(key)
// }

// // Create creates a new application
// func (s *applicationService) Create(db *gorm.DB, app *models.Application) error {
// 	return s.baseService.Create(db, app)
// }

// // Update updates an existing application
// func (s *applicationService) Update(db *gorm.DB, app *models.Application) error {
// 	return s.baseService.Update(db, app)
// }

// // GetApplicationUsers returns all users associated with an application
// func (s *applicationService) GetApplicationUsers(db *gorm.DB, appID uuid.UUID) ([]models.User, error) {
// 	userApps, err := models.GetApplicationUsers(db, appID)
// 	if err != nil {
// 		return nil, fmt.Errorf("failed to get application users: %w", err)
// 	}

// 	users := make([]models.User, len(userApps))
// 	for i, ua := range userApps {
// 		users[i] = ua.User
// 	}

// 	return users, nil
// }

// // AddUserToApplication associates a user with an application
// func (s *applicationService) AddUserToApplication(db *gorm.DB, appID uuid.UUID, userID int, role string) error {
// 	// Check if the user is already associated with the application
// 	exists, err := models.GetUserApplication(db, userID, appID)
// 	if err == nil && exists != nil {
// 		return fmt.Errorf("user is already associated with this application")
// 	}

// 	// Create the association
// 	userApp := &models.UserApplication{
// 		ID:            uuid.New(),
// 		ApplicationID: appID,
// 		UserID:        userID,
// 		Role:          role,
// 		CreatedAt:     time.Now(),
// 	}

// 	if err := userApp.Create(db); err != nil {
// 		return fmt.Errorf("failed to add user to application: %w", err)
// 	}

// 	return nil
// }

// // RemoveUserFromApplication removes a user's association with an application
// func (s *applicationService) RemoveUserFromApplication(db *gorm.DB, appID uuid.UUID, userID int) error {
// 	userApp, err := models.GetUserApplication(db, userID, appID)
// 	if err != nil {
// 		if err == gorm.ErrRecordNotFound {
// 			return fmt.Errorf("user is not associated with this application")
// 		}
// 		return fmt.Errorf("failed to check user application association: %w", err)
// 	}

// 	if err := userApp.Delete(db); err != nil {
// 		return fmt.Errorf("failed to remove user from application: %w", err)
// 	}

// 	return nil
// }
