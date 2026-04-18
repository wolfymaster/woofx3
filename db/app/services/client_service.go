package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strconv"

	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

type clientService struct {
	repo *repository.ClientRepository
}

func NewClientService(repo *repository.ClientRepository) *clientService {
	return &clientService{repo: repo}
}

func generateSecret() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func (s *clientService) CreateClient(ctx context.Context, req *client.CreateClientRequest) (*client.ClientResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationId, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}

	clientID := uuid.New()
	clientSecret, err := generateSecret()
	if err != nil {
		return nil, err
	}

	m := &models.Client{
		ApplicationID: applicationId,
		ClientID:      clientID,
		ClientSecret:  clientSecret,
		Description:   req.Description,
		CallbackUrl:   req.CallbackUrl,
		CallbackToken: req.CallbackToken,
	}

	if err := s.repo.Create(m); err != nil {
		return nil, err
	}

	return &client.ClientResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Client: &client.Client{
			Id:            strconv.Itoa(m.ID),
			Description:   m.Description,
			ApplicationId: m.ApplicationID.String(),
			ClientId:      m.ClientID.String(),
			ClientSecret:  m.ClientSecret,
			CallbackUrl:   m.CallbackUrl,
			CallbackToken: m.CallbackToken,
		},
	}, nil
}

func (s *clientService) GetClient(ctx context.Context, req *client.GetClientRequest) (*client.ClientResponse, error) {
	clientID, err := uuid.Parse(req.ClientId)
	if err != nil {
		return nil, err
	}

	model, err := s.repo.GetByClientID(clientID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return &client.ClientResponse{
				Status: &client.ResponseStatus{Code: client.ResponseStatus_NOT_FOUND, Message: "Client not found"},
			}, nil
		}
		return nil, err
	}

	return &client.ClientResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Client: clientModelToProto(model, false),
	}, nil
}

func (s *clientService) ListClients(ctx context.Context, req *client.ListClientsRequest) (*client.ListClientsResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationId, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}

	models, err := s.repo.GetByApplicationID(applicationId)
	if err != nil {
		return nil, err
	}

	var clients []*client.Client
	for i := range models {
		clients = append(clients, clientModelToProto(&models[i], false))
	}

	return &client.ListClientsResponse{
		Status:  &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Clients: clients,
	}, nil
}

func (s *clientService) UpdateClient(ctx context.Context, req *client.UpdateClientRequest) (*client.ClientResponse, error) {
	id, err := strconv.Atoi(req.Id)
	if err != nil {
		return nil, err
	}

	model, err := s.repo.GetByID(id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return &client.ClientResponse{
				Status: &client.ResponseStatus{Code: client.ResponseStatus_NOT_FOUND, Message: "Client not found"},
			}, nil
		}
		return nil, err
	}

	model.Description = req.Description
	model.CallbackUrl = req.CallbackUrl
	model.CallbackToken = req.CallbackToken

	if err := s.repo.Update(model); err != nil {
		return nil, err
	}

	return &client.ClientResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Client: clientModelToProto(model, false),
	}, nil
}

func (s *clientService) DeleteClient(ctx context.Context, req *client.DeleteClientRequest) (*client.ResponseStatus, error) {
	id, err := strconv.Atoi(req.Id)
	if err != nil {
		return nil, err
	}

	if err := s.repo.Delete(id); err != nil {
		return nil, err
	}

	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Client deleted"}, nil
}

func (s *clientService) ValidateClient(ctx context.Context, req *client.ValidateClientRequest) (*client.ClientResponse, error) {
	clientID, err := uuid.Parse(req.ClientId)
	if err != nil {
		return &client.ClientResponse{
			Status: &client.ResponseStatus{Code: client.ResponseStatus_NOT_FOUND, Message: "Invalid credentials"},
		}, nil
	}

	model, err := s.repo.ValidateClient(clientID, req.ClientSecret)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return &client.ClientResponse{
				Status: &client.ResponseStatus{Code: client.ResponseStatus_NOT_FOUND, Message: "Invalid credentials"},
			}, nil
		}
		return nil, err
	}

	return &client.ClientResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Client: clientModelToProto(model, true),
	}, nil
}

func clientModelToProto(m *models.Client, includeSecret bool) *client.Client {
	secret := ""
	if includeSecret {
		secret = m.ClientSecret
	}
	return &client.Client{
		Id:            strconv.Itoa(m.ID),
		Description:   m.Description,
		ApplicationId: m.ApplicationID.String(),
		ClientId:      m.ClientID.String(),
		ClientSecret:  secret,
		CallbackUrl:   m.CallbackUrl,
		CallbackToken: m.CallbackToken,
	}
}
