package services

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	gsqlite "github.com/libtnb/sqlite"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
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

func TestHashStoredClientSecretsHashesAndClearsPlainTextOnce(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		clients := repo.NewClientRepository(db)
		legacy := insertLegacyClient(t, db, "legacy-plain-text")
		createClient(t, svc, &client.CreateClientRequest{Description: "new", Kind: client.ClientKind_CLIENT_KIND_REGISTERED})

		first, err := HashStoredClientSecrets(clients, discardLogger())
		if err != nil {
			t.Fatalf("HashStoredClientSecrets: %v", err)
		}
		second, err := HashStoredClientSecrets(clients, discardLogger())
		if err != nil {
			t.Fatalf("HashStoredClientSecrets again: %v", err)
		}

		if first != 1 || second != 0 {
			t.Errorf("settled %d then %d, want 1 then 0", first, second)
		}
		stored := readStoredSecret(t, db, legacy)
		if stored.ClientSecret != nil {
			t.Errorf("the plain-text secret is still stored: %q", *stored.ClientSecret)
		}
		if stored.ClientSecretHash == nil || *stored.ClientSecretHash != hashClientSecret("legacy-plain-text") {
			t.Errorf("stored hash = %v", stored.ClientSecretHash)
		}
		if resp := validate(t, svc, legacy, "legacy-plain-text"); resp.Status.Code != client.ResponseStatus_OK {
			t.Errorf("an existing client was locked out: %v", resp.Status.Code)
		}
	})
}

func TestHashStoredClientSecretsKeepsAStoredHashOverPlainTextBesideIt(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		created := createClient(t, svc, &client.CreateClientRequest{
			Description: "desktop", Kind: client.ClientKind_CLIENT_KIND_REGISTERED,
		})
		// What an older release's UpdateClient writes into a client it did
		// not create: an empty plain-text secret.
		if err := db.Exec(`UPDATE clients SET client_secret = '' WHERE client_id = ?`, created.ClientId).Error; err != nil {
			t.Fatalf("older release's save: %v", err)
		}

		settled, err := HashStoredClientSecrets(repo.NewClientRepository(db), discardLogger())
		if err != nil {
			t.Fatalf("HashStoredClientSecrets: %v", err)
		}

		stored := readStoredSecret(t, db, created.ClientId)
		if settled != 1 || stored.ClientSecret != nil {
			t.Errorf("settled %d, plain text %v; want 1 and none", settled, stored.ClientSecret)
		}
		if resp := validate(t, svc, created.ClientId, created.ClientSecret); resp.Status.Code != client.ResponseStatus_OK {
			t.Errorf("the client lost its secret: %v", resp.Status.Code)
		}
	})
}

func TestReplacePlaintextSecretKeepsAWriteThatLandedSinceTheRead(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		clients := repo.NewClientRepository(db)
		legacy := insertLegacyClient(t, db, "read-earlier")
		ids, err := clients.ListPlaintextSecretIDs()
		if err != nil || len(ids) != 1 {
			t.Fatalf("ListPlaintextSecretIDs = %v, %v", ids, err)
		}
		if err := db.Exec(`UPDATE clients SET client_secret = 'written-since' WHERE client_id = ?`, legacy).Error; err != nil {
			t.Fatalf("concurrent write: %v", err)
		}

		swapped, err := clients.ReplacePlaintextSecret(ids[0], "read-earlier", nil, hashClientSecret("read-earlier"))
		if err != nil {
			t.Fatalf("ReplacePlaintextSecret: %v", err)
		}
		if swapped || readStoredSecret(t, db, legacy).ClientSecretHash != nil {
			t.Error("a hash of a stale secret was stored")
		}
	})
}

// racingStore is the real clients table, with a write that lands between
// the pass's read and its swap the first `races` times.
type racingStore struct {
	*repo.ClientRepository
	db    *gorm.DB
	races int
}

func (s *racingStore) ReplacePlaintextSecret(id int, plaintext string, expectedHash *string, hash string) (bool, error) {
	if s.races > 0 {
		s.races--
		if err := s.db.Exec(`UPDATE clients SET client_secret = ? WHERE id = ?`, plaintext+"-changed", id).Error; err != nil {
			return false, err
		}
	}
	return s.ClientRepository.ReplacePlaintextSecret(id, plaintext, expectedHash, hash)
}

func TestHashStoredClientSecretsRereadsARowThatChangedMeanwhile(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		legacy := insertLegacyClient(t, db, "first")
		store := &racingStore{ClientRepository: repo.NewClientRepository(db), db: db, races: 1}

		settled, err := HashStoredClientSecrets(store, discardLogger())
		if err != nil {
			t.Fatalf("HashStoredClientSecrets: %v", err)
		}

		if settled != 1 {
			t.Errorf("settled %d, want 1", settled)
		}
		if resp := validate(t, svc, legacy, "first-changed"); resp.Status.Code != client.ResponseStatus_OK {
			t.Errorf("the client is not usable after a lost race: %v", resp.Status.Code)
		}
	})
}

func TestHashStoredClientSecretsGivesUpOnARowThatNeverSettles(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		insertLegacyClient(t, db, "moving")
		store := &racingStore{ClientRepository: repo.NewClientRepository(db), db: db, races: clientSecretSettleAttempts}

		if _, err := HashStoredClientSecrets(store, discardLogger()); err == nil {
			t.Error("a row that changed on every attempt was reported as settled")
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

func TestHashStoredClientSecretsRefusesAnEmptySecretWithNoHash(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		insertLegacyClient(t, db, "")

		if _, err := HashStoredClientSecrets(repo.NewClientRepository(db), discardLogger()); err == nil {
			t.Error("an empty plain-text secret was hashed into a credential")
		}
	})
}

// upgradedSQLiteFile is an engine's SQLite file that had a client with
// `secret` in plain text before migration 0071, migrated to the latest.
func upgradedSQLiteFile(t *testing.T, secret string) (*gorm.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "woofx3.db")
	db := openSQLiteFile(t, path)
	// The client exists before 0071, as on an engine upgrading to it: the
	// migration's table rebuild then leaves a freed copy of the row behind.
	migrator := gormigrate.New(db, gormigrate.DefaultOptions, sqliteChain(t))
	if err := migrator.MigrateTo("0070_client_kind_origin"); err != nil {
		t.Fatalf("migrate to 0070: %v", err)
	}
	insertLegacyClient(t, db, secret)
	if err := migrator.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db, path
}

func openSQLiteFile(t *testing.T, path string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(gsqlite.Open(path), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close sqlite: %v", err)
		}
	})
	return db
}

func fileContains(t *testing.T, path, secret string) bool {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read database file: %v", err)
	}
	return bytes.Contains(contents, []byte(secret))
}

func TestHashStoredClientSecretsLeavesNoPlainTextInTheSQLiteFile(t *testing.T) {
	const secret = "plain-text-secret-that-must-leave-the-file"
	db, path := upgradedSQLiteFile(t, secret)
	clients := repo.NewClientRepository(db)

	if _, err := HashStoredClientSecrets(clients, discardLogger()); err != nil {
		t.Fatalf("HashStoredClientSecrets: %v", err)
	}

	if fileContains(t, path, secret) {
		t.Error("the cleared plain-text secret is still in the database file")
	}
	if pending, err := clients.ErasePending(); err != nil || pending {
		t.Errorf("erase still pending after a successful VACUUM: %v, %v", pending, err)
	}
}

// failingErase is the real clients table whose file erase fails, as when the
// disk is full or the process is killed during the VACUUM.
type failingErase struct {
	*repo.ClientRepository
}

func (failingErase) EraseFreedSpace() error {
	return errors.New("database or disk is full")
}

func TestAFailedEraseIsRetriedOnTheNextStart(t *testing.T) {
	const secret = "plain-text-secret-whose-erase-fails-once"
	db, path := upgradedSQLiteFile(t, secret)
	clients := repo.NewClientRepository(db)

	if _, err := HashStoredClientSecrets(failingErase{clients}, discardLogger()); err == nil {
		t.Fatal("a failed erase did not stop startup")
	}
	if pending, err := clients.ErasePending(); err != nil || !pending {
		t.Fatalf("the failed erase is not recorded as owed: %v, %v", pending, err)
	}

	// The next start: nothing is left to clear, but the erase is still owed.
	settled, err := HashStoredClientSecrets(clients, discardLogger())
	if err != nil {
		t.Fatalf("HashStoredClientSecrets on the next start: %v", err)
	}

	if settled != 0 {
		t.Errorf("settled %d clients on the next start, want 0", settled)
	}
	if fileContains(t, path, secret) {
		t.Error("the cleared plain-text secret is still in the database file")
	}
	if pending, err := clients.ErasePending(); err != nil || pending {
		t.Errorf("erase still pending after the retry: %v, %v", pending, err)
	}
}

func TestPostgresNeverOwesAFileErase(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		clients := repo.NewClientRepository(db)
		insertLegacyClient(t, db, "cleared-on-either-dialect")

		if _, err := HashStoredClientSecrets(clients, discardLogger()); err != nil {
			t.Fatalf("HashStoredClientSecrets: %v", err)
		}

		var markers int64
		if err := db.Model(&models.Setting{}).Where("key = ?", repo.ClientSecretErasePendingKey).Count(&markers).Error; err != nil {
			t.Fatalf("count markers: %v", err)
		}
		if markers != 0 {
			t.Errorf("%d erase markers left after the pass", markers)
		}
	})
}
