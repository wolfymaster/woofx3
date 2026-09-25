package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// CommandRepository represents the db functions for Commands
type CommandRepository struct {
	db *gorm.DB
}

// NewCommandRepository returns a new instance of CommandRepository
func NewCommandRepository(db *gorm.DB) *CommandRepository {
	return &CommandRepository{db: db}
}

// Create creates a new Command
func (r *CommandRepository) Create(cmd *models.Command) error {
	return r.db.Create(cmd).Error
}

// Update updates a Command
func (r *CommandRepository) Update(cmd *models.Command) error {
	return r.db.Save(cmd).Error
}

// Delete deletes a Command
func (r *CommandRepository) Delete(cmd *models.Command) error {
	return r.db.Delete(cmd).Error
}

// GetByID retrieves a Command by ID
func (r *CommandRepository) GetByID(id uuid.UUID) (*models.Command, error) {
	var cmd models.Command
	err := r.db.Where("id = ?", id).First(&cmd).Error
	return &cmd, err
}

func (r *CommandRepository) GetByCommand(command string) (*models.Command, error) {
	var cmd models.Command
	err := r.db.Where("command = ?", command).First(&cmd).Error
	return &cmd, err
}

// GetAll retrieves all Commands
func (r *CommandRepository) GetAll() ([]*models.Command, error) {
	var cmds []*models.Command
	err := r.db.Find(&cmds).Error
	return cmds, err
}
