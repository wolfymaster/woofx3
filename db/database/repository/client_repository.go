package repository

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
// already gone, including one a concurrent delete removed first, is not an
// error and records nothing: the row comes back from the DELETE itself, so
// only the delete that removed it records it.
func (r *ClientRepository) Delete(id int, record RecordClientChange) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var deleted []models.Client
		res := tx.Clauses(clause.Returning{}).Where("id = ?", id).Delete(&deleted)
		if res.Error != nil {
			return res.Error
		}
		switch len(deleted) {
		case 0:
			return nil
		case 1:
			return record(tx, &deleted[0])
		default:
			return fmt.Errorf("delete client %d removed %d rows", id, len(deleted))
		}
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

// EraseFreedSpace makes sure values the clients table no longer holds are not
// left in the database file. On SQLite an UPDATE or a table rebuild frees the
// old row's bytes without overwriting them, so the file is rewritten with
// VACUUM, which copies only live content. VACUUM cannot run inside a
// transaction. On Postgres old row versions stay until vacuum reclaims them,
// which is the server's to schedule; nothing is done here.
func (r *ClientRepository) EraseFreedSpace() error {
	if r.db.Dialector.Name() != "sqlite" {
		return nil
	}
	return r.db.Exec("VACUUM").Error
}

// ListPlaintextSecretIDs returns the ids of the clients that still have a
// plain-text secret.
func (r *ClientRepository) ListPlaintextSecretIDs() ([]int, error) {
	var ids []int
	err := r.db.Model(&models.Client{}).Where("client_secret IS NOT NULL").Order("id").Pluck("id", &ids).Error
	return ids, err
}

// ReplacePlaintextSecret stores `hash` and clears the plain-text secret of
// the client with `id`, only while the row still holds `plaintext` and
// `expectedHash` (nil for no hash), and reports whether it did. A write
// landing between the caller's read and this one is kept.
func (r *ClientRepository) ReplacePlaintextSecret(id int, plaintext string, expectedHash *string, hash string) (bool, error) {
	query := r.db.Model(&models.Client{}).Where("id = ? AND client_secret = ?", id, plaintext)
	if expectedHash == nil {
		query = query.Where("client_secret_hash IS NULL")
	} else {
		query = query.Where("client_secret_hash = ?", *expectedHash)
	}
	res := query.Updates(map[string]interface{}{"client_secret": nil, "client_secret_hash": hash})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}
