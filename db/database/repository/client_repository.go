package repository

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

type ClientRepository struct {
	db *gorm.DB
}

func NewClientRepository(db *gorm.DB) *ClientRepository {
	return &ClientRepository{db: db}
}

// RecordClientChange records a client a write changed, in the same
// transaction as the write: the service writes the client's outbox entry
// with it, so the write and its event commit or roll back together.
// Returning an error rolls the write back.
type RecordClientChange func(tx *gorm.DB, row *models.Client) error

// Create inserts `client` and records it.
func (r *ClientRepository) Create(client *models.Client, record RecordClientChange) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(client).Error; err != nil {
			return err
		}
		return record(tx, client)
	})
}

func (r *ClientRepository) GetByID(id int) (*models.Client, error) {
	var client models.Client
	err := r.db.First(&client, id).Error
	return &client, err
}

func (r *ClientRepository) GetByClientID(clientID uuid.UUID) (*models.Client, error) {
	var client models.Client
	err := r.db.Where("client_id = ?", clientID).First(&client).Error
	return &client, err
}

func (r *ClientRepository) List() ([]models.Client, error) {
	var clients []models.Client
	err := r.db.Find(&clients).Error
	return clients, err
}

func (r *ClientRepository) Update(client *models.Client) error {
	return r.db.Save(client).Error
}

// Delete removes the client with `id` and records it as it stood. A client
// already gone is not an error and records nothing.
func (r *ClientRepository) Delete(id int, record RecordClientChange) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var client models.Client
		err := tx.First(&client, id).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		res := tx.Delete(&models.Client{}, id)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return fmt.Errorf("delete client %d removed %d rows", id, res.RowsAffected)
		}
		return record(tx, &client)
	})
}

// RecordAuthentication stamps `at` as the client's last authentication, and
// reports whether the client exists.
func (r *ClientRepository) RecordAuthentication(clientID uuid.UUID, at time.Time) (bool, error) {
	res := r.db.Model(&models.Client{}).Where("client_id = ?", clientID).Update("last_authenticated_at", at)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// ListUnhashed returns the clients that have a plain-text secret and no hash.
func (r *ClientRepository) ListUnhashed() ([]models.Client, error) {
	var clients []models.Client
	err := r.db.Where("client_secret_hash IS NULL AND client_secret IS NOT NULL").Find(&clients).Error
	return clients, err
}

// SetSecretHash stores `hash` for the client with `id`, only while it still
// has no hash and its plain-text secret is still `plaintext`, and reports
// whether it did. A write landing between the read and this one is kept.
func (r *ClientRepository) SetSecretHash(id int, plaintext, hash string) (bool, error) {
	res := r.db.Model(&models.Client{}).
		Where("id = ? AND client_secret_hash IS NULL AND client_secret = ?", id, plaintext).
		Update("client_secret_hash", hash)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}
