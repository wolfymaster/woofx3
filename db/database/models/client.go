package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ClientKind is how a client came to exist. The values are stored as is and
// must match the clients_kind_known constraint.
type ClientKind string

const (
	// ClientKindRegistered called registerClient: a desktop shell, a cloud
	// dashboard, a CLI.
	ClientKindRegistered ClientKind = "registered"
	// ClientKindPaired was obtained by a browser through pairing, and is bound
	// to the origin it paired from.
	ClientKindPaired ClientKind = "paired"
)

type Client struct {
	ID          int       `gorm:"primaryKey;autoIncrement"`
	Description string    `gorm:"type:varchar(100)"`
	ClientID    uuid.UUID `gorm:"column:client_id;type:uuid;not null;uniqueIndex"`
	// ClientSecret is the plain text of a secret issued before secrets were
	// hashed, kept only so the previous release can still validate it; nil
	// for every client created since. Nothing in this release reads it but
	// the startup pass that hashes it.
	ClientSecret *string `gorm:"column:client_secret;type:varchar(100)"`
	// ClientSecretHash is the lowercase hex SHA-256 of the secret.
	ClientSecretHash *string    `gorm:"column:client_secret_hash"`
	CallbackUrl      string     `gorm:"column:callback_url;type:varchar(255)"`
	CallbackToken    string     `gorm:"column:callback_token;type:varchar(255)"`
	Kind             ClientKind `gorm:"column:kind;not null"`
	// Origin is set for a paired client and nil for a registered one.
	Origin              *string    `gorm:"column:origin"`
	CreatedAt           time.Time  `gorm:"column:created_at;not null"`
	LastAuthenticatedAt *time.Time `gorm:"column:last_authenticated_at"`
}

func (Client) TableName() string {
	return "clients"
}

// CRUD Operations
func (c *Client) Create(db *gorm.DB) error {
	return db.Create(c).Error
}

func (c *Client) Update(db *gorm.DB) error {
	return db.Save(c).Error
}

func (c *Client) Delete(db *gorm.DB) error {
	return db.Delete(c).Error
}

func GetClientByID(db *gorm.DB, id int) (*Client, error) {
	var client Client
	err := db.First(&client, id).Error
	return &client, err
}

func GetClientByClientID(db *gorm.DB, clientID uuid.UUID) (*Client, error) {
	var client Client
	err := db.Where("client_id = ?", clientID).First(&client).Error
	return &client, err
}
