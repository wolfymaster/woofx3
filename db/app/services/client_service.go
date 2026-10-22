package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// clientService owns the clients table. Creating and deleting a client
// writes `db.client.created.system` or `db.client.deleted.system` to the
// outbox in the same transaction, carrying clientChangeData: never the
// secret or the callback token.
type clientService struct {
	repo      *repository.ClientRepository
	publisher *workers.EventPublisher
	now       func() time.Time
}

func NewClientService(
	repo *repository.ClientRepository,
	publisher *workers.EventPublisher,
	now func() time.Time,
) (client.ClientService, error) {
	if publisher == nil {
		return nil, errors.New("client service needs an event publisher")
	}
	if now == nil {
		return nil, errors.New("client service needs a clock")
	}
	return &clientService{repo: repo, publisher: publisher, now: now}, nil
}

func generateSecret() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func (s *clientService) CreateClient(ctx context.Context, req *client.CreateClientRequest) (*client.ClientResponse, error) {
	kind, origin, err := clientKindFromRequest(req.Kind, req.Origin)
	if err != nil {
		return nil, err
	}
	clientID := uuid.New()
	clientSecret, err := generateSecret()
	if err != nil {
		return nil, err
	}

	m := &models.Client{
		ClientID:      clientID,
		ClientSecret:  clientSecret,
		Description:   req.Description,
		CallbackUrl:   req.CallbackUrl,
		CallbackToken: req.CallbackToken,
		Kind:          kind,
		Origin:        origin,
		CreatedAt:     s.now(),
	}

	if err := s.repo.Create(m, s.recordChange("created")); err != nil {
		return nil, fmt.Errorf("creating client: %w", err)
	}

	return &client.ClientResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Client: clientModelToProto(m, true),
	}, nil
}

// clientKindFromRequest checks a requested kind and origin against each
// other: a paired client is bound to an origin, a registered one has none.
func clientKindFromRequest(kind client.ClientKind, origin string) (models.ClientKind, *string, error) {
	switch kind {
	case client.ClientKind_CLIENT_KIND_REGISTERED:
		if origin != "" {
			return "", nil, twirp.InvalidArgumentError("origin", "a registered client has no origin")
		}
		return models.ClientKindRegistered, nil, nil
	case client.ClientKind_CLIENT_KIND_PAIRED:
		if origin == "" {
			return "", nil, twirp.RequiredArgumentError("origin")
		}
		return models.ClientKindPaired, &origin, nil
	default:
		return "", nil, twirp.InvalidArgumentError("kind", fmt.Sprintf("must be registered or paired, got %s", kind))
	}
}

func clientKindToProto(kind models.ClientKind) client.ClientKind {
	switch kind {
	case models.ClientKindRegistered:
		return client.ClientKind_CLIENT_KIND_REGISTERED
	case models.ClientKindPaired:
		return client.ClientKind_CLIENT_KIND_PAIRED
	default:
		return client.ClientKind_CLIENT_KIND_UNSPECIFIED
	}
}

// clientChangeData is the payload of a `db.client.*` outbox event.
type clientChangeData struct {
	ID          string            `json:"id"`
	ClientID    string            `json:"client_id"`
	Description string            `json:"description"`
	Kind        models.ClientKind `json:"kind"`
	// Origin is null for a registered client.
	Origin *string `json:"origin"`
}

// recordChange writes the `op` outbox event for a client inside the write's
// transaction (see repository.RecordClientChange).
func (s *clientService) recordChange(op string) repository.RecordClientChange {
	return func(tx *gorm.DB, row *models.Client) error {
		return s.publisher.PublishIn(tx, workers.PublishOptions{
			EntityType: "client",
			EntityID:   strconv.Itoa(row.ID),
			Operation:  op,
			Data: clientChangeData{
				ID:          strconv.Itoa(row.ID),
				ClientID:    row.ClientID.String(),
				Description: row.Description,
				Kind:        row.Kind,
				Origin:      row.Origin,
			},
			AutoAcknowledge: true,
		})
	}
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
	models, err := s.repo.List()
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

	if err := s.repo.Delete(id, s.recordChange("deleted")); err != nil {
		return nil, fmt.Errorf("deleting client %d: %w", id, err)
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

// RecordClientAuthentication stamps the client's last authentication with
// the service's clock. How often the api calls it is the api's choice.
func (s *clientService) RecordClientAuthentication(ctx context.Context, req *client.RecordClientAuthenticationRequest) (*client.ResponseStatus, error) {
	clientID, err := uuid.Parse(req.ClientId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("client_id", "invalid UUID format")
	}
	found, err := s.repo.RecordAuthentication(clientID, s.now())
	if err != nil {
		return nil, fmt.Errorf("recording authentication of client %s: %w", clientID, err)
	}
	if !found {
		return &client.ResponseStatus{Code: client.ResponseStatus_NOT_FOUND, Message: "Client not found"}, nil
	}
	return &client.ResponseStatus{Code: client.ResponseStatus_OK}, nil
}

func clientModelToProto(m *models.Client, includeSecret bool) *client.Client {
	secret := ""
	if includeSecret {
		secret = m.ClientSecret
	}
	origin := ""
	if m.Origin != nil {
		origin = *m.Origin
	}
	var lastAuthenticatedAt *timestamppb.Timestamp
	if m.LastAuthenticatedAt != nil {
		lastAuthenticatedAt = timestamppb.New(*m.LastAuthenticatedAt)
	}
	return &client.Client{
		Id:                  strconv.Itoa(m.ID),
		Description:         m.Description,
		ClientId:            m.ClientID.String(),
		ClientSecret:        secret,
		CallbackUrl:         m.CallbackUrl,
		CallbackToken:       m.CallbackToken,
		Kind:                clientKindToProto(m.Kind),
		Origin:              origin,
		CreatedAt:           timestamppb.New(m.CreatedAt),
		LastAuthenticatedAt: lastAuthenticatedAt,
	}
}
