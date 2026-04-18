package services

import (
	"context"
	"testing"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func TestUserService_FindOrCreateByWoofx3UIUserId_Creates(t *testing.T) {
	db := newTestDB(t)
	svc := NewUserService(repository.NewUserRepository(db), nil)
	resp, err := svc.FindOrCreateByWoofx3UIUserId(context.Background(), &client.FindOrCreateByWoofx3UIUserIdRequest{
		Woofx3UiUserId: "convex_user_42",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.User == nil {
		t.Fatalf("expected user, got nil")
	}
	if resp.User.Woofx3UiUserId != "convex_user_42" {
		t.Fatalf("expected woofx3_ui_user_id convex_user_42, got %q", resp.User.Woofx3UiUserId)
	}
}

func TestUserService_FindOrCreateByWoofx3UIUserId_ReturnsExisting(t *testing.T) {
	db := newTestDB(t)
	svc := NewUserService(repository.NewUserRepository(db), nil)
	first, err := svc.FindOrCreateByWoofx3UIUserId(context.Background(), &client.FindOrCreateByWoofx3UIUserIdRequest{
		Woofx3UiUserId: "convex_user_42",
	})
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := svc.FindOrCreateByWoofx3UIUserId(context.Background(), &client.FindOrCreateByWoofx3UIUserIdRequest{
		Woofx3UiUserId: "convex_user_42",
	})
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if first.User.Id != second.User.Id {
		t.Fatalf("expected same id, got %s vs %s", first.User.Id, second.User.Id)
	}
	var count int64
	if err := db.Table("users").Where("woofx3_ui_user_id = ?", "convex_user_42").Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 row, got %d", count)
	}
}

func TestUserService_FindOrCreateByWoofx3UIUserId_RejectsEmpty(t *testing.T) {
	db := newTestDB(t)
	svc := NewUserService(repository.NewUserRepository(db), nil)
	_, err := svc.FindOrCreateByWoofx3UIUserId(context.Background(), &client.FindOrCreateByWoofx3UIUserIdRequest{
		Woofx3UiUserId: "",
	})
	if err == nil {
		t.Fatalf("expected error on empty id, got nil")
	}
}
