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

// ClientSecretErasePendingKey is the setting that records, on SQLite, that a
// plain-text client secret was cleared and the database file has not been
// rewritten since. It is written in the same transaction as the clear and
// removed only after a VACUUM succeeds, so an interrupted or failed VACUUM
// is retried on the next start.
const ClientSecretErasePendingKey = "db.client_secrets.erase_pending"

func (r *ClientRepository) isSQLite() bool {
	return r.db.Dialector.Name() == "sqlite"
}

// ErasePending reports whether cleared plain-text secrets are owed an erase
// from the database file (ClientSecretErasePendingKey is set). Always false
// on Postgres, where the setting is never written.
func (r *ClientRepository) ErasePending() (bool, error) {
	if !r.isSQLite() {
		return false, nil
	}
	var pending int64
	if err := r.db.Model(&models.Setting{}).Where("key = ?", ClientSecretErasePendingKey).Count(&pending).Error; err != nil {
		return false, fmt.Errorf("reading %s: %w", ClientSecretErasePendingKey, err)
	}
	return pending > 0, nil
}

// EraseFreedSpace rewrites a SQLite database file with VACUUM, which copies
// only live content, and then removes ClientSecretErasePendingKey. An UPDATE
// or a table rebuild frees the old row's bytes without overwriting them, so
// this is what takes cleared plain-text secrets out of the file. VACUUM cannot
// run inside a transaction; if it fails, the setting stays and the erase is
// owed on the next start. On Postgres old row versions stay until the
// server's vacuum reclaims them, so this does nothing there.
func (r *ClientRepository) EraseFreedSpace() error {
	if !r.isSQLite() {
		return nil
	}
	if err := r.db.Exec("VACUUM").Error; err != nil {
		return fmt.Errorf("vacuum: %w", err)
	}
	if err := r.db.Where("key = ?", ClientSecretErasePendingKey).Delete(&models.Setting{}).Error; err != nil {
		return fmt.Errorf("clearing %s: %w", ClientSecretErasePendingKey, err)
	}
	return nil
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
//
// On SQLite the same transaction sets ClientSecretErasePendingKey, so the
// freed bytes are owed an erase (EraseFreedSpace) however the start ends.
func (r *ClientRepository) ReplacePlaintextSecret(id int, plaintext string, expectedHash *string, hash string) (bool, error) {
	swapped := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&models.Client{}).Where("id = ? AND client_secret = ?", id, plaintext)
		if expectedHash == nil {
			query = query.Where("client_secret_hash IS NULL")
		} else {
			query = query.Where("client_secret_hash = ?", *expectedHash)
		}
		res := query.Updates(map[string]interface{}{"client_secret": nil, "client_secret_hash": hash})
		if res.Error != nil {
			return res.Error
		}
		swapped = res.RowsAffected == 1
		if !swapped || !r.isSQLite() {
			return nil
		}
		marker := models.Setting{Key: ClientSecretErasePendingKey, Value: "true"}
		return tx.Where("key = ?", ClientSecretErasePendingKey).FirstOrCreate(&marker).Error
	})
	if err != nil {
		return false, err
	}
	return swapped, nil
}
