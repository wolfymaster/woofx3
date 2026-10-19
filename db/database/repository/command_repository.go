package repository

import (
	"errors"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrCommandLinkChanged is returned when a command's workflow link is not the
// one the caller read: another writer linked or unlinked it in between.
var ErrCommandLinkChanged = errors.New("the command's workflow link changed while it was being written")

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

// WithDB returns a repository that runs on `db`, typically a transaction.
func (r *CommandRepository) WithDB(db *gorm.DB) *CommandRepository {
	return &CommandRepository{db: db}
}

// LockByID reads a Command by ID and, on postgres, locks its row until the
// transaction the repository runs on ends, so two writers of one command take
// turns. SQLite has a single writer and needs no lock.
func (r *CommandRepository) LockByID(id uuid.UUID) (*models.Command, error) {
	var cmd models.Command
	err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&cmd).Error
	return &cmd, err
}

// LinkWorkflow links the command with id to workflowID, provided it links to
// no workflow yet. ErrCommandLinkChanged when it already does.
func (r *CommandRepository) LinkWorkflow(id, workflowID uuid.UUID) error {
	result := r.db.Model(&models.Command{}).
		Where("id = ? AND workflow_id IS NULL", id).
		Update("workflow_id", workflowID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCommandLinkChanged
	}
	return nil
}

// UnlinkWorkflow clears the command's link to workflowID. ErrCommandLinkChanged
// when it links to some other workflow, or to none.
func (r *CommandRepository) UnlinkWorkflow(id, workflowID uuid.UUID) error {
	result := r.db.Model(&models.Command{}).
		Where("id = ? AND workflow_id = ?", id, workflowID).
		Update("workflow_id", nil)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCommandLinkChanged
	}
	return nil
}

// SetWorkflowError records why the command's actions could not become a
// workflow; "" clears it.
func (r *CommandRepository) SetWorkflowError(id uuid.UUID, reason string) error {
	return r.db.Model(&models.Command{}).Where("id = ?", id).Update("workflow_error", reason).Error
}

// GetByWorkflowID retrieves the Command linked to a workflow, or
// gorm.ErrRecordNotFound when no command runs it.
func (r *CommandRepository) GetByWorkflowID(workflowID uuid.UUID) (*models.Command, error) {
	var cmd models.Command
	err := r.db.Where("workflow_id = ?", workflowID).First(&cmd).Error
	return &cmd, err
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

// GetByOrigin retrieves the command a given creator registered under a name.
func (r *CommandRepository) GetByOrigin(createdByType, createdByRef, command string) (*models.Command, error) {
	var cmd models.Command
	err := r.db.
		Where("created_by_type = ? AND created_by_ref = ? AND command = ?", createdByType, createdByRef, command).
		First(&cmd).Error
	return &cmd, err
}

// Transaction runs fn in one database transaction, committing when it
// returns nil.
func (r *CommandRepository) Transaction(fn func(tx *gorm.DB) error) error {
	return r.db.Transaction(fn)
}

// DB is the connection the repository reads through, for a read that spans
// commands and the rows they link to.
func (r *CommandRepository) DB() *gorm.DB {
	return r.db
}

// GetUnlinked retrieves every Command that links to no workflow.
func (r *CommandRepository) GetUnlinked() ([]*models.Command, error) {
	var cmds []*models.Command
	err := r.db.Where("workflow_id IS NULL").Find(&cmds).Error
	return cmds, err
}

// GetAll retrieves all Commands
func (r *CommandRepository) GetAll() ([]*models.Command, error) {
	var cmds []*models.Command
	err := r.db.Find(&cmds).Error
	return cmds, err
}
