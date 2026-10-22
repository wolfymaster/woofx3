package services

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

var clientClock = time.Date(2026, 10, 22, 9, 30, 0, 0, time.UTC)

const pairedOrigin = "http://localhost:5173"

func newClientSvc(t *testing.T, db *gorm.DB) client.ClientService {
	t.Helper()
	publisher := workers.NewEventPublisher(repo.NewDbEventRepository(db), slog.New(slog.DiscardHandler))
	svc, err := NewClientService(repo.NewClientRepository(db), publisher, func() time.Time { return clientClock })
	if err != nil {
		t.Fatalf("NewClientService: %v", err)
	}
	return svc
}

func clientEvents(t *testing.T, db *gorm.DB) []models.WorkerEvent {
	t.Helper()
	var events []models.WorkerEvent
	if err := db.Where("entity_type = ?", "client").Order("created_at, nats_subject").Find(&events).Error; err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	return events
}

func createClient(t *testing.T, svc client.ClientService, req *client.CreateClientRequest) *client.Client {
	t.Helper()
	resp, err := svc.CreateClient(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateClient: %v", err)
	}
	return resp.Client
}

func TestClientServiceCreatesEachKind(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)

		registered := createClient(t, svc, &client.CreateClientRequest{
			Description: "desktop", Kind: client.ClientKind_CLIENT_KIND_REGISTERED,
			CallbackUrl: "http://cb", CallbackToken: "callback-token",
		})
		paired := createClient(t, svc, &client.CreateClientRequest{
			Description: "Chrome on Windows", Kind: client.ClientKind_CLIENT_KIND_PAIRED, Origin: pairedOrigin,
		})

		if registered.ClientSecret == "" || paired.ClientSecret == "" {
			t.Fatal("a created client came back without its secret")
		}
		if registered.Kind != client.ClientKind_CLIENT_KIND_REGISTERED || registered.Origin != "" {
			t.Errorf("registered client = %v %q", registered.Kind, registered.Origin)
		}
		if paired.Kind != client.ClientKind_CLIENT_KIND_PAIRED || paired.Origin != pairedOrigin {
			t.Errorf("paired client = %v %q", paired.Kind, paired.Origin)
		}
		if !registered.CreatedAt.AsTime().Equal(clientClock) {
			t.Errorf("created_at = %v, want %v", registered.CreatedAt.AsTime(), clientClock)
		}

		listed, err := svc.ListClients(context.Background(), &client.ListClientsRequest{})
		if err != nil {
			t.Fatalf("ListClients: %v", err)
		}
		if len(listed.Clients) != 2 {
			t.Fatalf("listed %d clients, want 2", len(listed.Clients))
		}
		for _, c := range listed.Clients {
			if c.Kind == client.ClientKind_CLIENT_KIND_UNSPECIFIED || !c.CreatedAt.AsTime().Equal(clientClock) {
				t.Errorf("listed client %s lost its kind or created_at: %v %v", c.ClientId, c.Kind, c.CreatedAt.AsTime())
			}
			if c.LastAuthenticatedAt != nil {
				t.Errorf("client %s has a last authentication before any was recorded", c.ClientId)
			}
		}
	})
}

func TestClientServiceRefusesAKindThatDoesNotMatchItsOrigin(t *testing.T) {
	cases := []struct {
		name   string
		kind   client.ClientKind
		origin string
	}{
		{"no kind", client.ClientKind_CLIENT_KIND_UNSPECIFIED, ""},
		{"a paired client without an origin", client.ClientKind_CLIENT_KIND_PAIRED, ""},
		{"a registered client with an origin", client.ClientKind_CLIENT_KIND_REGISTERED, pairedOrigin},
	}
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				_, err := svc.CreateClient(context.Background(), &client.CreateClientRequest{
					Description: "x", Kind: tc.kind, Origin: tc.origin,
				})
				var twerr twirp.Error
				if !errors.As(err, &twerr) || (twerr.Code() != twirp.InvalidArgument && twerr.Code() != twirp.Malformed) {
					t.Fatalf("err = %v, want an invalid argument", err)
				}
			})
		}
		var rows int64
		if err := db.Model(&models.Client{}).Count(&rows).Error; err != nil {
			t.Fatalf("count clients: %v", err)
		}
		if rows != 0 || len(clientEvents(t, db)) != 0 {
			t.Errorf("a refused client left %d rows and %d events", rows, len(clientEvents(t, db)))
		}
	})
}

func TestClientServiceWritesOutboxEventsWithoutSecrets(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		created := createClient(t, svc, &client.CreateClientRequest{
			Description: "Chrome on Windows", Kind: client.ClientKind_CLIENT_KIND_PAIRED, Origin: pairedOrigin,
			CallbackToken: "callback-token",
		})
		if _, err := svc.DeleteClient(context.Background(), &client.DeleteClientRequest{Id: created.Id}); err != nil {
			t.Fatalf("DeleteClient: %v", err)
		}

		events := clientEvents(t, db)
		subjects := make([]string, 0, len(events))
		for _, event := range events {
			subjects = append(subjects, event.NATSSubject)
		}
		if strings.Join(subjects, ",") != "db.client.created.system,db.client.deleted.system" {
			t.Fatalf("subjects = %v", subjects)
		}
		for _, event := range events {
			if strings.Contains(event.Payload, created.ClientSecret) || strings.Contains(event.Payload, "callback-token") {
				t.Errorf("%s carries a secret: %s", event.NATSSubject, event.Payload)
			}
			var data clientChangeData
			if err := json.Unmarshal([]byte(event.Payload), &data); err != nil {
				t.Fatalf("payload: %v", err)
			}
			want := clientChangeData{
				ID: created.Id, ClientID: created.ClientId, Description: "Chrome on Windows",
				Kind: models.ClientKindPaired, Origin: data.Origin,
			}
			if data != want || data.Origin == nil || *data.Origin != pairedOrigin {
				t.Errorf("%s payload = %+v", event.NATSSubject, data)
			}
		}
	})
}

func TestClientServiceDeletingAMissingClientRecordsNothing(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)

		status, err := svc.DeleteClient(context.Background(), &client.DeleteClientRequest{Id: "999"})
		if err != nil {
			t.Fatalf("DeleteClient: %v", err)
		}
		if status.Code != client.ResponseStatus_OK || len(clientEvents(t, db)) != 0 {
			t.Errorf("status = %v, events = %d", status.Code, len(clientEvents(t, db)))
		}
	})
}

func TestClientServiceRecordsAuthentication(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		ctx := context.Background()
		created := createClient(t, svc, &client.CreateClientRequest{
			Description: "desktop", Kind: client.ClientKind_CLIENT_KIND_REGISTERED,
		})

		status, err := svc.RecordClientAuthentication(ctx, &client.RecordClientAuthenticationRequest{ClientId: created.ClientId})
		if err != nil || status.Code != client.ResponseStatus_OK {
			t.Fatalf("RecordClientAuthentication = %v, %v", status, err)
		}
		got, err := svc.GetClient(ctx, &client.GetClientRequest{ClientId: created.ClientId})
		if err != nil {
			t.Fatalf("GetClient: %v", err)
		}
		if got.Client.LastAuthenticatedAt == nil || !got.Client.LastAuthenticatedAt.AsTime().Equal(clientClock) {
			t.Errorf("last_authenticated_at = %v, want %v", got.Client.LastAuthenticatedAt, clientClock)
		}

		missing, err := svc.RecordClientAuthentication(ctx, &client.RecordClientAuthenticationRequest{
			ClientId: "00000000-0000-0000-0000-000000000000",
		})
		if err != nil || missing.Code != client.ResponseStatus_NOT_FOUND {
			t.Errorf("unknown client = %v, %v; want NOT_FOUND", missing, err)
		}
		if _, err := svc.RecordClientAuthentication(ctx, &client.RecordClientAuthenticationRequest{ClientId: "nope"}); err == nil {
			t.Error("a client id that is not a UUID was accepted")
		}
	})
}

func TestNewClientServiceNeedsItsDependencies(t *testing.T) {
	publisher := workers.NewEventPublisher(nil, slog.New(slog.DiscardHandler))
	if _, err := NewClientService(nil, nil, time.Now); err == nil {
		t.Error("no publisher was accepted")
	}
	if _, err := NewClientService(nil, publisher, nil); err == nil {
		t.Error("no clock was accepted")
	}
}

func TestClientServiceConcurrentDeletesOfOneClientBothSucceedAndRecordOnce(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newClientSvc(t, db)
		created := createClient(t, svc, &client.CreateClientRequest{
			Description: "desktop", Kind: client.ClientKind_CLIENT_KIND_REGISTERED,
		})

		var wg sync.WaitGroup
		statuses := make([]*client.ResponseStatus, 2)
		errs := make([]error, 2)
		for i := range statuses {
			wg.Add(1)
			go func() {
				defer wg.Done()
				statuses[i], errs[i] = svc.DeleteClient(context.Background(), &client.DeleteClientRequest{Id: created.Id})
			}()
		}
		wg.Wait()

		for i := range statuses {
			if errs[i] != nil || statuses[i].Code != client.ResponseStatus_OK {
				t.Errorf("delete %d = %v, %v; want OK", i, statuses[i], errs[i])
			}
		}
		deletes := 0
		for _, event := range clientEvents(t, db) {
			if event.Operation == "deleted" {
				deletes++
			}
		}
		if deletes != 1 {
			t.Errorf("recorded %d deletions, want 1", deletes)
		}
	})
}
