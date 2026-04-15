package repository

import (
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

func (r *ClientRepository) Create(client *models.Client) error {
	return r.db.Create(client).Error
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

func (r *ClientRepository) GetByApplicationID(appID uuid.UUID) ([]models.Client, error) {
	var clients []models.Client
	err := r.db.Where("application_id = ?", appID).Find(&clients).Error
	return clients, err
}

func (r *ClientRepository) Update(client *models.Client) error {
	return r.db.Save(client).Error
}

func (r *ClientRepository) Delete(id int) error {
	return r.db.Delete(&models.Client{}, id).Error
}

func (r *ClientRepository) ValidateClient(clientID uuid.UUID, clientSecret string) (*models.Client, error) {
	var client models.Client
	err := r.db.Where("client_id = ? AND client_secret = ?", clientID, clientSecret).First(&client).Error
	return &client, err
}
