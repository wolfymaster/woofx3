package services

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

// newOverlayTokenTestDB extends the in-memory SQLite pattern from
// common_service_test.go with the tables the overlay-token service
// touches. Hand DDL, same reason: production gorm tags rely on
// Postgres-only uuid_generate_v4().
func newOverlayTokenTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := newTestDB(t)
	stmts := []string{
		`CREATE TABLE scenes (
			id TEXT PRIMARY KEY,
			application_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			widgets_json TEXT NOT NULL DEFAULT '[]',
			layout_json TEXT NOT NULL DEFAULT '{}',
			created_by_type TEXT NOT NULL DEFAULT 'USER',
			created_by_ref TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE overlay_tokens (
			id TEXT PRIMARY KEY,
			token TEXT NOT NULL UNIQUE,
			scene_id TEXT NOT NULL,
			application_id TEXT NOT NULL,
			label TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'active',
			created_at DATETIME,
			revoked_at DATETIME,
			last_used_at DATETIME
		)`,
	}
	for _, s := range stmts {
		if err := db.Exec(s).Error; err != nil {
			t.Fatalf("exec ddl: %v", err)
		}
	}
	return db
}

func newOverlayTokenSvc(t *testing.T) (client.OverlayTokenService, *repository.OverlayTokenRepository, *gorm.DB) {
	t.Helper()
	db := newOverlayTokenTestDB(t)
	tokenRepo := repository.NewOverlayTokenRepository(db)
	sceneRepo := repository.NewSceneRepository(db)
	return NewOverlayTokenService(tokenRepo, sceneRepo, nil), tokenRepo, db
}

func seedScene(t *testing.T, db *gorm.DB, applicationID uuid.UUID, name string) uuid.UUID {
	t.Helper()
	sceneID := uuid.New()
	err := db.Exec(
		`INSERT INTO scenes (id, application_id, name) VALUES (?, ?, ?)`,
		sceneID.String(), applicationID.String(), name,
	).Error
	if err != nil {
		t.Fatalf("seed scene: %v", err)
	}
	return sceneID
}

func mintToken(t *testing.T, svc client.OverlayTokenService, sceneID, applicationID uuid.UUID, label string) *client.OverlayToken {
	t.Helper()
	resp, err := svc.MintOverlayToken(context.Background(), &client.MintOverlayTokenRequest{
		SceneId:       sceneID.String(),
		ApplicationId: applicationID.String(),
		Label:         label,
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if resp.OverlayToken == nil {
		t.Fatalf("mint returned nil token: %+v", resp)
	}
	return resp.OverlayToken
}

func TestOverlayTokenService_Mint_FormatAndUniqueness(t *testing.T) {
	svc, _, db := newOverlayTokenSvc(t)
	appID := uuid.New()
	sceneID := seedScene(t, db, appID, "main")

	first := mintToken(t, svc, sceneID, appID, "OBS main PC")
	second := mintToken(t, svc, sceneID, appID, "OBS laptop")

	for _, tok := range []*client.OverlayToken{first, second} {
		if !strings.HasPrefix(tok.Token, "ovl_") {
			t.Fatalf("expected ovl_ prefix, got %q", tok.Token)
		}
		body := strings.TrimPrefix(tok.Token, "ovl_")
		// 32 bytes encode to ~43-44 base58 digits; anything shorter
		// means the entropy got truncated somewhere.
		if len(body) < 40 {
			t.Fatalf("token body too short (%d): %q", len(body), tok.Token)
		}
		for _, c := range body {
			if !strings.ContainsRune(overlayTokenAlphabet, c) {
				t.Fatalf("token %q contains non-base58 char %q", tok.Token, c)
			}
		}
		if tok.Status != models.OverlayTokenStatusActive {
			t.Fatalf("expected active status, got %q", tok.Status)
		}
		if tok.SceneId != sceneID.String() || tok.ApplicationId != appID.String() {
			t.Fatalf("scene/application mismatch: %+v", tok)
		}
	}
	if first.Token == second.Token {
		t.Fatalf("expected unique tokens, both were %q", first.Token)
	}
	if first.Label != "OBS main PC" {
		t.Fatalf("expected label persisted, got %q", first.Label)
	}
}

func TestOverlayTokenService_Mint_SceneNotFound(t *testing.T) {
	svc, _, _ := newOverlayTokenSvc(t)
	_, err := svc.MintOverlayToken(context.Background(), &client.MintOverlayTokenRequest{
		SceneId:       uuid.New().String(),
		ApplicationId: uuid.New().String(),
	})
	assertTwirpCode(t, err, twirp.NotFound)
}

func TestOverlayTokenService_Mint_SceneWrongApplication(t *testing.T) {
	svc, _, db := newOverlayTokenSvc(t)
	sceneID := seedScene(t, db, uuid.New(), "main")

	_, err := svc.MintOverlayToken(context.Background(), &client.MintOverlayTokenRequest{
		SceneId:       sceneID.String(),
		ApplicationId: uuid.New().String(),
	})
	// Ownership mismatch is indistinguishable from missing — a caller
	// holding the wrong application id must not learn the scene exists.
	assertTwirpCode(t, err, twirp.NotFound)
}

func TestOverlayTokenService_Resolve_Active(t *testing.T) {
	svc, tokenRepo, db := newOverlayTokenSvc(t)
	appID := uuid.New()
	sceneID := seedScene(t, db, appID, "main")
	minted := mintToken(t, svc, sceneID, appID, "")

	resp, err := svc.ResolveOverlayToken(context.Background(), &client.ResolveOverlayTokenRequest{Token: minted.Token})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if resp.Status.Code != client.ResponseStatus_OK {
		t.Fatalf("expected OK, got %v", resp.Status.Code)
	}
	if resp.SceneId != sceneID.String() || resp.ApplicationId != appID.String() {
		t.Fatalf("resolve mismatch: %+v", resp)
	}

	// First resolve stamps last_used_at; an immediate second resolve is
	// inside the 60s throttle window and must not rewrite it.
	row, err := tokenRepo.GetByID(uuid.MustParse(minted.Id))
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if row.LastUsedAt == nil {
		t.Fatalf("expected last_used_at stamped after resolve")
	}
	firstTouch := *row.LastUsedAt

	if _, err := svc.ResolveOverlayToken(context.Background(), &client.ResolveOverlayTokenRequest{Token: minted.Token}); err != nil {
		t.Fatalf("second resolve: %v", err)
	}
	row, err = tokenRepo.GetByID(uuid.MustParse(minted.Id))
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !row.LastUsedAt.Equal(firstTouch) {
		t.Fatalf("expected throttled touch, got %v then %v", firstTouch, *row.LastUsedAt)
	}
}

func TestOverlayTokenService_Resolve_RevokedEqualsUnknown(t *testing.T) {
	svc, _, db := newOverlayTokenSvc(t)
	appID := uuid.New()
	sceneID := seedScene(t, db, appID, "main")
	minted := mintToken(t, svc, sceneID, appID, "")

	if _, err := svc.RevokeOverlayToken(context.Background(), &client.RevokeOverlayTokenRequest{Id: minted.Id}); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	revokedResp, err := svc.ResolveOverlayToken(context.Background(), &client.ResolveOverlayTokenRequest{Token: minted.Token})
	if err != nil {
		t.Fatalf("resolve revoked: %v", err)
	}
	unknownResp, err := svc.ResolveOverlayToken(context.Background(), &client.ResolveOverlayTokenRequest{Token: "ovl_definitelyNotMinted"})
	if err != nil {
		t.Fatalf("resolve unknown: %v", err)
	}

	if revokedResp.Status.Code != client.ResponseStatus_NOT_FOUND {
		t.Fatalf("expected NOT_FOUND for revoked, got %v", revokedResp.Status.Code)
	}
	// No enumeration oracle: the two miss responses must be identical.
	if !proto.Equal(revokedResp, unknownResp) {
		t.Fatalf("revoked and unknown responses differ:\nrevoked: %+v\nunknown: %+v", revokedResp, unknownResp)
	}
}

func TestOverlayTokenService_Revoke_Idempotent(t *testing.T) {
	svc, tokenRepo, db := newOverlayTokenSvc(t)
	appID := uuid.New()
	sceneID := seedScene(t, db, appID, "main")
	minted := mintToken(t, svc, sceneID, appID, "")

	first, err := svc.RevokeOverlayToken(context.Background(), &client.RevokeOverlayTokenRequest{Id: minted.Id})
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if first.OverlayToken.Status != models.OverlayTokenStatusRevoked {
		t.Fatalf("expected revoked status, got %q", first.OverlayToken.Status)
	}
	row, err := tokenRepo.GetByID(uuid.MustParse(minted.Id))
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if row.RevokedAt == nil {
		t.Fatalf("expected revoked_at set")
	}
	firstRevokedAt := *row.RevokedAt

	second, err := svc.RevokeOverlayToken(context.Background(), &client.RevokeOverlayTokenRequest{Id: minted.Id})
	if err != nil {
		t.Fatalf("second revoke: %v", err)
	}
	if second.Status.Code != client.ResponseStatus_OK {
		t.Fatalf("expected idempotent OK, got %v", second.Status.Code)
	}
	row, err = tokenRepo.GetByID(uuid.MustParse(minted.Id))
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !row.RevokedAt.Equal(firstRevokedAt) {
		t.Fatalf("second revoke rewrote revoked_at: %v then %v", firstRevokedAt, *row.RevokedAt)
	}
}

func TestOverlayTokenService_Rotate_Atomicity(t *testing.T) {
	svc, tokenRepo, db := newOverlayTokenSvc(t)
	appID := uuid.New()
	sceneID := seedScene(t, db, appID, "main")
	minted := mintToken(t, svc, sceneID, appID, "OBS main PC")

	resp, err := svc.RotateOverlayToken(context.Background(), &client.RotateOverlayTokenRequest{Id: minted.Id})
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	rotated := resp.OverlayToken
	if rotated == nil {
		t.Fatalf("rotate returned nil token: %+v", resp)
	}
	// Response carries the NEW row.
	if rotated.Id == minted.Id || rotated.Token == minted.Token {
		t.Fatalf("expected fresh token, got old back: %+v", rotated)
	}
	if rotated.Status != models.OverlayTokenStatusActive {
		t.Fatalf("expected new token active, got %q", rotated.Status)
	}
	if rotated.SceneId != minted.SceneId || rotated.ApplicationId != minted.ApplicationId || rotated.Label != minted.Label {
		t.Fatalf("expected scene/application/label carried over, got %+v", rotated)
	}

	oldRow, err := tokenRepo.GetByID(uuid.MustParse(minted.Id))
	if err != nil {
		t.Fatalf("reload old: %v", err)
	}
	if oldRow.Status != models.OverlayTokenStatusRevoked || oldRow.RevokedAt == nil {
		t.Fatalf("expected old token tombstoned, got %+v", oldRow)
	}
	newRow, err := tokenRepo.GetByID(uuid.MustParse(rotated.Id))
	if err != nil {
		t.Fatalf("reload new: %v", err)
	}
	if newRow.Status != models.OverlayTokenStatusActive || newRow.SceneID != sceneID {
		t.Fatalf("expected new token active on same scene, got %+v", newRow)
	}
}

func TestOverlayTokenService_Rotate_RevokedFails(t *testing.T) {
	svc, _, db := newOverlayTokenSvc(t)
	appID := uuid.New()
	sceneID := seedScene(t, db, appID, "main")
	minted := mintToken(t, svc, sceneID, appID, "")

	if _, err := svc.RevokeOverlayToken(context.Background(), &client.RevokeOverlayTokenRequest{Id: minted.Id}); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	_, err := svc.RotateOverlayToken(context.Background(), &client.RotateOverlayTokenRequest{Id: minted.Id})
	assertTwirpCode(t, err, twirp.FailedPrecondition)
}

func TestOverlayTokenService_List_Filtering(t *testing.T) {
	svc, _, db := newOverlayTokenSvc(t)
	appID := uuid.New()
	sceneA := seedScene(t, db, appID, "scene-a")
	sceneB := seedScene(t, db, appID, "scene-b")

	active := mintToken(t, svc, sceneA, appID, "keep")
	revoked := mintToken(t, svc, sceneA, appID, "drop")
	other := mintToken(t, svc, sceneB, appID, "other")

	if _, err := svc.RevokeOverlayToken(context.Background(), &client.RevokeOverlayTokenRequest{Id: revoked.Id}); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	// Default: revoked tombstones are hidden.
	resp, err := svc.ListOverlayTokens(context.Background(), &client.ListOverlayTokensRequest{SceneId: sceneA.String()})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(resp.OverlayTokens) != 1 || resp.OverlayTokens[0].Id != active.Id {
		t.Fatalf("expected only active token for scene A, got %+v", resp.OverlayTokens)
	}

	// include_revoked surfaces the tombstone too.
	resp, err = svc.ListOverlayTokens(context.Background(), &client.ListOverlayTokensRequest{SceneId: sceneA.String(), IncludeRevoked: true})
	if err != nil {
		t.Fatalf("list include_revoked: %v", err)
	}
	if len(resp.OverlayTokens) != 2 {
		t.Fatalf("expected 2 tokens for scene A with include_revoked, got %d", len(resp.OverlayTokens))
	}

	// Application-wide listing spans scenes.
	resp, err = svc.ListOverlayTokens(context.Background(), &client.ListOverlayTokensRequest{ApplicationId: appID.String()})
	if err != nil {
		t.Fatalf("list by application: %v", err)
	}
	if len(resp.OverlayTokens) != 2 {
		t.Fatalf("expected 2 active tokens application-wide, got %d", len(resp.OverlayTokens))
	}
	seen := map[string]bool{}
	for _, tok := range resp.OverlayTokens {
		seen[tok.Id] = true
	}
	if !seen[active.Id] || !seen[other.Id] {
		t.Fatalf("expected active+other application-wide, got %+v", resp.OverlayTokens)
	}
	if resp.TotalCount != 2 {
		t.Fatalf("expected total_count 2, got %d", resp.TotalCount)
	}
}

func assertTwirpCode(t *testing.T, err error, code twirp.ErrorCode) {
	t.Helper()
	var twerr twirp.Error
	if !errors.As(err, &twerr) {
		t.Fatalf("expected twirp error, got %v", err)
	}
	if twerr.Code() != code {
		t.Fatalf("expected %s, got %s (%v)", code, twerr.Code(), twerr)
	}
}
