package services

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// storedSecret is a client's secret columns as stored.
type storedSecret struct {
	ClientSecret     *string
	ClientSecretHash *string
}

func readStoredSecret(t *testing.T, db *gorm.DB, clientID string) storedSecret {
	t.Helper()
	var row storedSecret
	if err := db.Raw(`SELECT client_secret, client_secret_hash FROM clients WHERE client_id = ?`, clientID).
		Scan(&row).Error; err != nil {
		t.Fatalf("read stored secret: %v", err)
	}
	return row
}

// insertLegacyClient writes a client the way a release before hashed secrets
// does: plain text only.
func insertLegacyClient(t *testing.T, db *gorm.DB, secret string) string {
	t.Helper()
	clientID := uuid.NewString()
	if err := db.Exec(`INSERT INTO clients (description, client_id, client_secret) VALUES ('legacy', ?, ?)`,
		clientID, secret).Error; err != nil {
		t.Fatalf("insert legacy client: %v", err)
	}
	return clientID
}

func validate(t *testing.T, svc client.ClientService, clientID, secret string) *client.ClientResponse {
	t.Helper()
	resp, err := svc.ValidateClient(context.Background(), &client.ValidateClientRequest{ClientId: clientID, ClientSecret: secret})
	if err != nil {
		t.Fatalf("ValidateClient: %v", err)
	}
	return resp
}

func TestClientServiceStoresOnlyTheHashOfANewSecret(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		created := createClient(t, svc, &client.CreateClientRequest{
			Description: "desktop", Kind: client.ClientKind_CLIENT_KIND_REGISTERED,
		})

		stored := readStoredSecret(t, db, created.ClientId)
		if stored.ClientSecret != nil {
			t.Errorf("the plain-text secret was stored: %q", *stored.ClientSecret)
		}
		if stored.ClientSecretHash == nil || *stored.ClientSecretHash != hashClientSecret(created.ClientSecret) {
			t.Errorf("stored hash = %v, want the secret's SHA-256", stored.ClientSecretHash)
		}
	})
}

func TestClientServiceValidatesAgainstTheHash(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		created := createClient(t, svc, &client.CreateClientRequest{
			Description: "desktop", Kind: client.ClientKind_CLIENT_KIND_REGISTERED,
		})

		accepted := validate(t, svc, created.ClientId, created.ClientSecret)
		if accepted.Status.Code != client.ResponseStatus_OK || accepted.Client.Description != "desktop" {
			t.Fatalf("the right secret was not accepted: %v", accepted.Status)
		}
		if accepted.Client.ClientSecret != "" {
			t.Error("ValidateClient returned the secret")
		}

		refusals := []struct {
			name, clientID, secret string
		}{
			{"a wrong secret", created.ClientId, created.ClientSecret[1:] + "0"},
			{"the stored hash as the secret", created.ClientId, hashClientSecret(created.ClientSecret)},
			{"an empty secret", created.ClientId, ""},
			{"an unknown client", uuid.NewString(), created.ClientSecret},
			{"a client id that is not a UUID", "nope", created.ClientSecret},
		}
		for _, tc := range refusals {
			if resp := validate(t, svc, tc.clientID, tc.secret); resp.Status.Code != client.ResponseStatus_NOT_FOUND {
				t.Errorf("%s: status = %v, want NOT_FOUND", tc.name, resp.Status.Code)
			}
		}
	})
}

func TestClientServiceNeverReturnsAStoredSecret(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		ctx := context.Background()
		created := createClient(t, svc, &client.CreateClientRequest{
			Description: "desktop", Kind: client.ClientKind_CLIENT_KIND_REGISTERED,
		})
		insertLegacyClient(t, db, "legacy-plain-text")

		listed, err := svc.ListClients(ctx, &client.ListClientsRequest{})
		if err != nil {
			t.Fatalf("ListClients: %v", err)
		}
		got, err := svc.GetClient(ctx, &client.GetClientRequest{ClientId: created.ClientId})
		if err != nil {
			t.Fatalf("GetClient: %v", err)
		}
		for _, c := range append(listed.Clients, got.Client) {
			if c.ClientSecret != "" {
				t.Errorf("client %s came back with a secret", c.ClientId)
			}
		}
	})
}

func TestHashStoredClientSecretsHashesPlainTextOnce(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		clients := repo.NewClientRepository(db)
		legacy := insertLegacyClient(t, db, "legacy-plain-text")
		createClient(t, svc, &client.CreateClientRequest{Description: "new", Kind: client.ClientKind_CLIENT_KIND_REGISTERED})

		first, err := HashStoredClientSecrets(clients)
		if err != nil {
			t.Fatalf("HashStoredClientSecrets: %v", err)
		}
		second, err := HashStoredClientSecrets(clients)
		if err != nil {
			t.Fatalf("HashStoredClientSecrets again: %v", err)
		}

		if first != 1 || second != 0 {
			t.Errorf("hashed %d then %d, want 1 then 0", first, second)
		}
		stored := readStoredSecret(t, db, legacy)
		if stored.ClientSecret == nil || *stored.ClientSecret != "legacy-plain-text" {
			t.Error("the plain text the previous release validates against was not kept")
		}
		if stored.ClientSecretHash == nil || *stored.ClientSecretHash != hashClientSecret("legacy-plain-text") {
			t.Errorf("stored hash = %v", stored.ClientSecretHash)
		}
		if resp := validate(t, svc, legacy, "legacy-plain-text"); resp.Status.Code != client.ResponseStatus_OK {
			t.Errorf("an existing client was locked out: %v", resp.Status.Code)
		}
	})
}

func TestSetSecretHashKeepsAWriteThatLandedSinceTheRead(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		clients := repo.NewClientRepository(db)
		legacy := insertLegacyClient(t, db, "read-earlier")
		rows, err := clients.ListUnhashed()
		if err != nil || len(rows) != 1 {
			t.Fatalf("ListUnhashed = %d rows, %v", len(rows), err)
		}
		if err := db.Exec(`UPDATE clients SET client_secret = 'written-since' WHERE client_id = ?`, legacy).Error; err != nil {
			t.Fatalf("concurrent write: %v", err)
		}

		swapped, err := clients.SetSecretHash(rows[0].ID, "read-earlier", hashClientSecret("read-earlier"))
		if err != nil {
			t.Fatalf("SetSecretHash: %v", err)
		}
		if swapped || readStoredSecret(t, db, legacy).ClientSecretHash != nil {
			t.Error("a hash of a stale secret was stored")
		}
	})
}

func TestValidateClientWithoutAHashIsAnErrorNotARefusal(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		legacy := insertLegacyClient(t, db, "never-hashed")

		_, err := svc.ValidateClient(context.Background(), &client.ValidateClientRequest{
			ClientId: legacy, ClientSecret: "never-hashed",
		})
		var twerr twirp.Error
		if !errors.As(err, &twerr) || twerr.Code() != twirp.Internal {
			t.Errorf("err = %v, want an internal error", err)
		}
	})
}
