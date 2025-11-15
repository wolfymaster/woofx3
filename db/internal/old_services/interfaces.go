package services

import (
	"time"
	"gorm.io/gorm"
	"github.com/google/uuid"
	"github.com/golang-jwt/jwt/v5"

	"github.com/wolfymaster/woofx3/db/models"
)

// Service provides common database operations for models
type Service[T any] interface {
	Create(db *gorm.DB, entity *T) error
	Update(db *gorm.DB, entity *T) error
	Delete(db *gorm.DB, id interface{}) error
	GetByID(db *gorm.DB, id interface{}) (*T, error)
}

// ServiceFactory is the central factory for all services
type ServiceFactory interface {
	// User() UserService
	Permission() PermissionService
	Command() CommandService
	// Application() ApplicationService
	// Event() EventService
	// Workflow() WorkflowService
	// Auth() AuthService
	// Setting() SettingService
	// Treat() TreatService
}

// TreatService handles treat-related operations
type TreatService interface {
	Service[models.Treat]
	
	// ListTreats retrieves a list of treats with optional filtering
	ListTreats(
		db *gorm.DB,
		userID *uuid.UUID,
		treatType *string,
		startTime *time.Time,
		endTime *time.Time,
		page, pageSize int,
	) ([]models.Treat, int64, error)
	
	// GetUserTreatsSummary gets a summary of treats for a user
	GetUserTreatsSummary(
		db *gorm.DB,
		userID uuid.UUID,
		startTime, endTime *time.Time,
	) (*models.TreatsSummary, error)
}

// AuthService handles authentication and authorization
type AuthService interface {
	Service[models.User]
	
	// User Authentication
	// Login(db *gorm.DB, username, password string) (string, *models.User, error)
	ValidateToken(tokenString string) (*jwt.Token, error)
	RefreshToken(db *gorm.DB, refreshToken string) (string, *models.User, error)
	Logout(db *gorm.DB, userID uuid.UUID) error
	GetUserFromToken(token *jwt.Token) (*models.User, error)

	// Client Authentication
	AuthenticateClient(db *gorm.DB, clientID, clientSecret string) (*models.Client, error)
	GenerateClientToken(client *models.Client) (string, error)
	ValidateClientToken(tokenString string) (*jwt.Token, error)
}

// UserService handles user-related operations
type UserService interface {
	Service[models.User]
	GetByUsername(db *gorm.DB, username string) (*models.User, error)
	UpdatePassword(db *gorm.DB, userID uuid.UUID, newPassword string) error
	ListUsers(db *gorm.DB, page, pageSize int) ([]models.User, int64, error)
}

// CommandService handles command execution and management
type CommandService interface {
	Service[models.Command]
	ExecuteCommand(db *gorm.DB, userID uuid.UUID, command string, args ...interface{}) (interface{}, error)
	ListCommands(db *gorm.DB, applicationID uuid.UUID) ([]models.Command, error)
}

// EventService handles event processing
type EventService interface {
	Service[models.UserEvent]
	LogEvent(db *gorm.DB, event *models.UserEvent) error
	GetUserEvents(db *gorm.DB, userID uuid.UUID, limit int) ([]models.UserEvent, error)
}

// WorkflowService manages workflow definitions and execution
type WorkflowService interface {
	Service[models.WorkflowExecution]
	
	StartWorkflow(db *gorm.DB, workflowDefID uuid.UUID, input map[string]interface{}) (string, error)
	GetWorkflowStatus(db *gorm.DB, workflowID string) (string, error)
	CancelWorkflow(db *gorm.DB, workflowID string) error
}

// ApplicationService manages application settings and metadata
type ApplicationService interface {
	Service[models.Application]
	// Client Management
	CreateClient(db *gorm.DB, appID uuid.UUID, description string) (*models.Client, error)
	GetClients(db *gorm.DB, appID uuid.UUID) ([]models.Client, error)
	DeleteClient(db *gorm.DB, clientID int) error
	// User Management
	GetApplicationUsers(db *gorm.DB, appID uuid.UUID) ([]models.User, error)
	AddUserToApplication(db *gorm.DB, appID uuid.UUID, userID int, role string) error
	RemoveUserFromApplication(db *gorm.DB, appID uuid.UUID, userID int) error
}

// PermissionService handles permission management
type PermissionService interface {
	Service[models.Permission]
	
	AddPolicy(db *gorm.DB, appID uuid.UUID, subject, object, action string) error
	RemovePolicy(db *gorm.DB, appID uuid.UUID, subject, object, action string) error
	AddRoleForUser(db *gorm.DB, appID uuid.UUID, user, role string) error
	RemoveRoleForUser(db *gorm.DB, appID uuid.UUID, user, role string) error
	GetUserRoles(db *gorm.DB, appID uuid.UUID, user string) ([]string, error)
	GetPolicies(db *gorm.DB, appID uuid.UUID) ([]string, error)
}

// SettingService manages application and user settings
type SettingService interface {
	Service[models.Setting]
	// GetSetting retrieves a setting by key for a specific application and user
	GetSetting(db *gorm.DB, appID, userID uuid.UUID, key string) (*models.Setting, error)
	// GetSettings retrieves all settings for a specific application and user
	GetSettings(db *gorm.DB, appID, userID uuid.UUID) ([]models.Setting, error)
	// SetSetting creates or updates a setting
	SetSetting(db *gorm.DB, setting *models.Setting) error
	// DeleteSetting removes a setting
	DeleteSetting(db *gorm.DB, appID, userID uuid.UUID, key string) error
	// GetSettingValue retrieves and unmarshals a setting value into the provided interface
	GetSettingValue(db *gorm.DB, appID, userID uuid.UUID, key string, out interface{}) error
}
