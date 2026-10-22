package services

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
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
//
// A secret is stored only as its hash (hashClientSecret). CreateClient
// returns the plain text once; no other response carries it.
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

// hashClientSecret is how a client secret is stored: the lowercase hex
// SHA-256 of the secret as the client presents it. A fast hash is enough
// because every secret is 32 random bytes, so there is nothing to guess.
func hashClientSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
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

	secretHash := hashClientSecret(clientSecret)
	m := &models.Client{
		ClientID:         clientID,
		ClientSecretHash: &secretHash,
		Description:      req.Description,
		CallbackUrl:      req.CallbackUrl,
		CallbackToken:    req.CallbackToken,
		Kind:             kind,
		Origin:           origin,
		CreatedAt:        s.now(),
	}

	if err := s.repo.Create(m, s.recordChange("created")); err != nil {
		return nil, fmt.Errorf("creating client: %w", err)
	}

	created := clientModelToProto(m)
	created.ClientSecret = clientSecret
	return &client.ClientResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Client: created,
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
		Client: clientModelToProto(model),
	}, nil
}

func (s *clientService) ListClients(ctx context.Context, req *client.ListClientsRequest) (*client.ListClientsResponse, error) {
	models, err := s.repo.List()
	if err != nil {
		return nil, err
	}

	var clients []*client.Client
	for i := range models {
		clients = append(clients, clientModelToProto(&models[i]))
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
		Client: clientModelToProto(model),
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

	refused := &client.ClientResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_NOT_FOUND, Message: "Invalid credentials"},
	}
	model, err := s.repo.GetByClientID(clientID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return refused, nil
	}
	if err != nil {
		return nil, fmt.Errorf("validating client %s: %w", clientID, err)
	}
	// HashStoredClientSecrets runs before db-proxy serves, so a client with
	// no hash means the stored secrets are not in the state this code
	// assumes. That is an error, not a refusal: the client's credentials
	// may be right.
	if model.ClientSecretHash == nil {
		return nil, twirp.InternalError(fmt.Sprintf("client %s has no secret hash", clientID))
	}
	presented := hashClientSecret(req.ClientSecret)
	if subtle.ConstantTimeCompare([]byte(presented), []byte(*model.ClientSecretHash)) != 1 {
		return refused, nil
	}

	return &client.ClientResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Client: clientModelToProto(model),
	}, nil
}

// clientSecretSettleAttempts bounds how often HashStoredClientSecrets re-reads
// a client whose row changed between its read and its write.
const clientSecretSettleAttempts = 3

// clientSecretStore is what HashStoredClientSecrets needs of the clients
// table.
type clientSecretStore interface {
	ListPlaintextSecretIDs() ([]int, error)
	EraseFreedSpace() error
	GetByID(id int) (*models.Client, error)
	ReplacePlaintextSecret(id int, plaintext string, expectedHash *string, hash string) (bool, error)
}

// HashStoredClientSecrets leaves every client with a hash and no plain-text
// secret, and returns how many clients it changed. Plain text comes from
// secrets issued before secrets were hashed, and from an older release run on
// this schema after a rollback. Each row is swapped only while it still holds
// the values read, so running it again, or beside a write, changes nothing it
// should not. When it changed any client, the space the plain text occupied is
// erased from the database file (EraseFreedSpace).
func HashStoredClientSecrets(store clientSecretStore) (int, error) {
	ids, err := store.ListPlaintextSecretIDs()
	if err != nil {
		return 0, fmt.Errorf("reading clients with plain-text secrets: %w", err)
	}
	settled := 0
	for _, id := range ids {
		changed, err := settleClientSecret(store, id)
		if err != nil {
			return settled, err
		}
		if changed {
			settled++
		}
	}
	if settled > 0 {
		if err := store.EraseFreedSpace(); err != nil {
			return settled, fmt.Errorf("erasing cleared client secrets from the database file: %w", err)
		}
	}
	return settled, nil
}

// settleClientSecret hashes and clears the plain-text secret of client `id`.
// A row that changed since it was read is read again, so a lost race never
// leaves a client without a hash, which ValidateClient treats as an error.
//
// A hash already stored wins over the plain text beside it: an older release
// saving a client created by this one writes an empty plain-text secret into
// it, and no release issues a new secret to an existing client.
func settleClientSecret(store clientSecretStore, id int) (bool, error) {
	for attempt := 0; attempt < clientSecretSettleAttempts; attempt++ {
		row, err := store.GetByID(id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		if err != nil {
			return false, fmt.Errorf("reading client %d: %w", id, err)
		}
		if row.ClientSecret == nil {
			return false, nil
		}
		// No release issues an empty secret, so an empty one with no hash
		// beside it is not a credential: hashing it would admit the empty
		// secret.
		if *row.ClientSecret == "" && row.ClientSecretHash == nil {
			return false, fmt.Errorf("client %d has an empty plain-text secret and no hash", id)
		}
		hash := hashClientSecret(*row.ClientSecret)
		if row.ClientSecretHash != nil {
			hash = *row.ClientSecretHash
		}
		swapped, err := store.ReplacePlaintextSecret(id, *row.ClientSecret, row.ClientSecretHash, hash)
		if err != nil {
			return false, fmt.Errorf("hashing the secret of client %d: %w", id, err)
		}
		if swapped {
			return true, nil
		}
	}
	return false, fmt.Errorf("the secret of client %d changed on every one of %d attempts to hash it", id, clientSecretSettleAttempts)
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

// clientModelToProto never carries the secret, in either form.
func clientModelToProto(m *models.Client) *client.Client {
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
		CallbackUrl:         m.CallbackUrl,
		CallbackToken:       m.CallbackToken,
		Kind:                clientKindToProto(m.Kind),
		Origin:              origin,
		CreatedAt:           timestamppb.New(m.CreatedAt),
		LastAuthenticatedAt: lastAuthenticatedAt,
	}
}
