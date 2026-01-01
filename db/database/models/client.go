package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Client struct {
	ID            int       `gorm:"primaryKey;autoIncrement"`
	Description   string    `gorm:"type:varchar(100)"`
	ApplicationID uuid.UUID `gorm:"column:application_id;type:uuid;not null;index:idx_clients_application_id;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	ClientID      uuid.UUID `gorm:"column:client_id;type:uuid;not null;uniqueIndex"`
	ClientSecret  string    `gorm:"column:client_secret;type:varchar(100);not null"`

	// Relationships
	Application Application `gorm:"foreignKey:ApplicationID;references:ID"`
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

func GetClientsByApplicationID(db *gorm.DB, appID uuid.UUID) ([]Client, error) {
	var clients []Client
	err := db.Where("application_id = ?", appID).Find(&clients).Error
	return clients, err
}

func GetClientByClientID(db *gorm.DB, clientID uuid.UUID) (*Client, error) {
	var client Client
	err := db.Where("client_id = ?", clientID).First(&client).Error
	return &client, err
}

func ValidateClient(db *gorm.DB, clientID uuid.UUID, clientSecret string) (*Client, error) {
	var client Client
	err := db.Where("client_id = ? AND client_secret = ?", clientID, clientSecret).First(&client).Error
	return &client, err
}
