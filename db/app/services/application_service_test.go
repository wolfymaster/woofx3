package services

import (
	"context"
	"testing"

	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func newAppSvc(t *testing.T) (*applicationService, *repository.ApplicationRepository) {
	t.Helper()
	db := newTestDB(t)
	repo := repository.NewApplicationRepository(db)
	return NewApplicationService(repo), repo
}

func TestApplicationService_GetDefault_NotFound(t *testing.T) {
	svc, _ := newAppSvc(t)
	resp, err := svc.GetDefaultApplication(context.Background(), &client.GetDefaultApplicationRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Status.Code != client.ResponseStatus_NOT_FOUND {
		t.Fatalf("expected NOT_FOUND, got %v", resp.Status.Code)
	}
}

func TestApplicationService_CreateDefault_Then_GetDefault(t *testing.T) {
	svc, _ := newAppSvc(t)
	ownerID := uuid.New().String()

	create, err := svc.CreateApplication(context.Background(), &client.CreateApplicationRequest{
		Name:      "default",
		OwnerId:   ownerID,
		IsDefault: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !create.Application.IsDefault {
		t.Fatalf("expected IsDefault=true on response, got %+v", create.Application)
	}

	got, err := svc.GetDefaultApplication(context.Background(), &client.GetDefaultApplicationRequest{})
	if err != nil {
		t.Fatalf("get default: %v", err)
	}
	if got.Application == nil || got.Application.Id != create.Application.Id {
		t.Fatalf("expected %s, got %+v", create.Application.Id, got.Application)
	}
}

func TestApplicationService_CreateSecondDefault_ReturnsExisting(t *testing.T) {
	svc, repo := newAppSvc(t)
	first := &models.Application{ID: uuid.New(), Name: "default", IsDefault: true, UserID: uuid.New()}
	if err := repo.Create(first); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Pure SQLite doesn't emit the partial unique index from the hand-DDL,
	// so this test exercises the handler's "default already exists" recovery
	// path by seeding a default and then attempting a second create. The
	// handler should notice a default already exists and return it rather
	// than creating a duplicate.
	resp, err := svc.CreateApplication(context.Background(), &client.CreateApplicationRequest{
		Name:      "default",
		OwnerId:   uuid.New().String(),
		IsDefault: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if resp.Application.Id != first.ID.String() {
		t.Fatalf("expected handler to return existing default %s, got %s", first.ID, resp.Application.Id)
	}
}
