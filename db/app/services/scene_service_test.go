package services

import (
	"context"
	"testing"

	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// Reuses the overlay-token harness: the cascade is only meaningful against
// tokens minted the ordinary way, and that fixture already builds both tables.
func newSceneSvc(t *testing.T) (client.SceneService, client.OverlayTokenService, *repository.OverlayTokenRepository, *gorm.DB) {
	t.Helper()
	db := newOverlayTokenTestDB(t)
	tokenRepo := repository.NewOverlayTokenRepository(db)
	sceneRepo := repository.NewSceneRepository(db)
	return NewSceneService(sceneRepo, tokenRepo, nil),
		NewOverlayTokenService(tokenRepo, sceneRepo, nil),
		tokenRepo,
		db
}

func deleteScene(t *testing.T, svc client.SceneService, sceneID uuid.UUID) *client.ResponseStatus {
	t.Helper()
	status, err := svc.DeleteScene(context.Background(), &client.DeleteSceneRequest{Id: sceneID.String()})
	if err != nil {
		t.Fatalf("delete scene: %v", err)
	}
	return status
}

func reloadToken(t *testing.T, tokenRepo *repository.OverlayTokenRepository, id string) *models.OverlayToken {
	t.Helper()
	parsed, err := uuid.Parse(id)
	if err != nil {
		t.Fatalf("parse token id %q: %v", id, err)
	}
	token, err := tokenRepo.GetByID(parsed)
	if err != nil {
		t.Fatalf("reload token %s: %v", id, err)
	}
	return token
}

// A token that outlives its scene still resolves, and the overlay it addresses
// renders empty -- which from a browser source is indistinguishable from a
// scene with nothing to show.
func TestSceneService_Delete_RevokesTokensAndStopsResolving(t *testing.T) {
	sceneSvc, tokenSvc, tokenRepo, db := newSceneSvc(t)
	appID := uuid.New()
	sceneID := seedScene(t, db, appID, "alerts")
	first := mintToken(t, tokenSvc, sceneID, appID, "OBS main PC")
	second := mintToken(t, tokenSvc, sceneID, appID, "OBS laptop")

	resolved, err := tokenSvc.ResolveOverlayToken(context.Background(),
		&client.ResolveOverlayTokenRequest{Token: first.Token})
	if err != nil {
		t.Fatalf("resolve before delete: %v", err)
	}
	if resolved.Status.Code != client.ResponseStatus_OK {
		t.Fatalf("token did not resolve before the delete: %v", resolved.Status)
	}

	deleteScene(t, sceneSvc, sceneID)

	for _, tok := range []*client.OverlayToken{first, second} {
		reloaded := reloadToken(t, tokenRepo, tok.Id)
		if reloaded.Status != models.OverlayTokenStatusRevoked {
			t.Errorf("token %q status = %q, want revoked", tok.Label, reloaded.Status)
		}
		if reloaded.RevokedAt == nil {
			t.Errorf("token %q was revoked with no revoked_at", tok.Label)
		}
		after, err := tokenSvc.ResolveOverlayToken(context.Background(),
			&client.ResolveOverlayTokenRequest{Token: tok.Token})
		if err != nil {
			t.Fatalf("resolve after delete: %v", err)
		}
		if after.Status.Code != client.ResponseStatus_NOT_FOUND {
			t.Errorf("token %q still resolves after its scene was deleted: %v", tok.Label, after.Status)
		}
	}
}

// The cascade is scoped by scene id, not by application: another scene's
// overlays keep working.
func TestSceneService_Delete_LeavesOtherScenesTokensAlone(t *testing.T) {
	sceneSvc, tokenSvc, tokenRepo, db := newSceneSvc(t)
	appID := uuid.New()
	doomed := seedScene(t, db, appID, "alerts")
	kept := seedScene(t, db, appID, "chat")
	doomedToken := mintToken(t, tokenSvc, doomed, appID, "OBS alerts")
	keptToken := mintToken(t, tokenSvc, kept, appID, "OBS chat")

	deleteScene(t, sceneSvc, doomed)

	if got := reloadToken(t, tokenRepo, doomedToken.Id).Status; got != models.OverlayTokenStatusRevoked {
		t.Errorf("deleted scene's token status = %q, want revoked", got)
	}
	if got := reloadToken(t, tokenRepo, keptToken.Id).Status; got != models.OverlayTokenStatusActive {
		t.Errorf("surviving scene's token status = %q, want active", got)
	}
}

// An already-revoked token keeps the timestamp of its real retirement, and the
// reported count is what this delete actually retired -- an operator reading it
// is not told two tokens were revoked when one already had been.
func TestSceneService_Delete_DoesNotRestampAlreadyRevokedTokens(t *testing.T) {
	sceneSvc, tokenSvc, tokenRepo, db := newSceneSvc(t)
	appID := uuid.New()
	sceneID := seedScene(t, db, appID, "alerts")
	active := mintToken(t, tokenSvc, sceneID, appID, "OBS main PC")
	stale := mintToken(t, tokenSvc, sceneID, appID, "retired PC")

	if _, err := tokenSvc.RevokeOverlayToken(context.Background(),
		&client.RevokeOverlayTokenRequest{Id: stale.Id}); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	revokedAt := reloadToken(t, tokenRepo, stale.Id).RevokedAt
	if revokedAt == nil {
		t.Fatal("hand-revoked token has no revoked_at to preserve")
	}

	status := deleteScene(t, sceneSvc, sceneID)

	if got := reloadToken(t, tokenRepo, active.Id).Status; got != models.OverlayTokenStatusRevoked {
		t.Errorf("active token status = %q, want revoked", got)
	}
	if got := reloadToken(t, tokenRepo, stale.Id).RevokedAt; !got.Equal(*revokedAt) {
		t.Errorf("already-revoked token was restamped: %v, want %v", got, *revokedAt)
	}
	if want := "Scene deleted successfully; revoked 1 overlay token(s)"; status.Message != want {
		t.Errorf("message = %q, want %q", status.Message, want)
	}
}

// Revoking is a tombstone everywhere else in this service; the cascade must not
// become the one path that destroys the operator's rotation history.
func TestSceneService_Delete_KeepsTombstones(t *testing.T) {
	sceneSvc, tokenSvc, tokenRepo, db := newSceneSvc(t)
	appID := uuid.New()
	sceneID := seedScene(t, db, appID, "alerts")
	minted := mintToken(t, tokenSvc, sceneID, appID, "OBS main PC")

	deleteScene(t, sceneSvc, sceneID)

	survivor := reloadToken(t, tokenRepo, minted.Id)
	if survivor.Label != "OBS main PC" {
		t.Errorf("label = %q, want %q", survivor.Label, "OBS main PC")
	}
	if survivor.SceneID.String() != sceneID.String() {
		t.Errorf("scene_id = %s, want %s", survivor.SceneID, sceneID)
	}
}

// Revocation runs before the delete so a failure leaves the operation
// retryable; a scene that never existed must not report a successful cascade.
func TestSceneService_Delete_UnknownSceneIsNotFound(t *testing.T) {
	sceneSvc, _, _, _ := newSceneSvc(t)
	if _, err := sceneSvc.DeleteScene(context.Background(),
		&client.DeleteSceneRequest{Id: uuid.NewString()}); err == nil {
		t.Fatal("deleting an unknown scene returned no error")
	}
}
