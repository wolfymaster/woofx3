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
	return NewSceneService(sceneRepo, tokenRepo, nil, nil),
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
	sceneID := seedScene(t, db, "alerts")
	first := mintToken(t, tokenSvc, sceneID, "OBS main PC")
	second := mintToken(t, tokenSvc, sceneID, "OBS laptop")

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

// The cascade is scoped by scene id: another scene's overlays keep working.
func TestSceneService_Delete_LeavesOtherScenesTokensAlone(t *testing.T) {
	sceneSvc, tokenSvc, tokenRepo, db := newSceneSvc(t)
	doomed := seedScene(t, db, "alerts")
	kept := seedScene(t, db, "chat")
	doomedToken := mintToken(t, tokenSvc, doomed, "OBS alerts")
	keptToken := mintToken(t, tokenSvc, kept, "OBS chat")

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
	sceneID := seedScene(t, db, "alerts")
	active := mintToken(t, tokenSvc, sceneID, "OBS main PC")
	stale := mintToken(t, tokenSvc, sceneID, "retired PC")

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
	sceneID := seedScene(t, db, "alerts")
	minted := mintToken(t, tokenSvc, sceneID, "OBS main PC")

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

func TestSceneService_Update_KeepsADraftBesideThePublishedScene(t *testing.T) {
	sceneSvc, _, _, db := newSceneSvc(t)
	sceneID := seedScene(t, db, "main")
	ctx := context.Background()
	get := func() *client.Scene {
		t.Helper()
		resp, err := sceneSvc.GetScene(ctx, &client.GetSceneRequest{Id: sceneID.String()})
		if err != nil {
			t.Fatalf("get scene: %v", err)
		}
		return resp.Scene
	}

	if get().HasDraft {
		t.Fatalf("a new scene has a draft")
	}

	_, err := sceneSvc.UpdateScene(ctx, &client.UpdateSceneRequest{
		Id:               sceneID.String(),
		DraftWidgetsJson: `[{"id":"w1"}]`,
		DraftLayoutJson:  `{}`,
	})
	if err != nil {
		t.Fatalf("store draft: %v", err)
	}
	scene := get()
	if !scene.HasDraft || scene.DraftWidgetsJson != `[{"id":"w1"}]` || scene.DraftLayoutJson != `{}` {
		t.Fatalf("draft not stored: %+v", scene)
	}
	if scene.WidgetsJson != "[]" {
		t.Fatalf("storing a draft changed the published widgets: %q", scene.WidgetsJson)
	}

	// An update that names no draft leaves it alone.
	if _, err := sceneSvc.UpdateScene(ctx, &client.UpdateSceneRequest{Id: sceneID.String(), Name: "renamed"}); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if !get().HasDraft {
		t.Fatalf("a rename dropped the draft")
	}

	// Clearing wins over a draft set in the same request.
	_, err = sceneSvc.UpdateScene(ctx, &client.UpdateSceneRequest{
		Id:               sceneID.String(),
		WidgetsJson:      `[{"id":"w1"}]`,
		DraftWidgetsJson: `[{"id":"w2"}]`,
		DraftLayoutJson:  `{}`,
		ClearDraft:       true,
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	scene = get()
	if scene.HasDraft || scene.DraftWidgetsJson != "" {
		t.Fatalf("draft not cleared: %+v", scene)
	}
	if scene.WidgetsJson != `[{"id":"w1"}]` {
		t.Fatalf("published widgets = %q", scene.WidgetsJson)
	}
}

func TestSceneService_Update_StoresEditorStateWithTheDocuments(t *testing.T) {
	sceneSvc, _, _, db := newSceneSvc(t)
	sceneID := seedScene(t, db, "main")
	ctx := context.Background()
	get := func() *client.Scene {
		t.Helper()
		resp, err := sceneSvc.GetScene(ctx, &client.GetSceneRequest{Id: sceneID.String()})
		if err != nil {
			t.Fatalf("get scene: %v", err)
		}
		return resp.Scene
	}

	if state := get().EditorStateJson; state != "" {
		t.Fatalf("a new scene has editor state %q", state)
	}

	const first = `{"v":1,"headId":"e.1","clients":{}}`
	resp, err := sceneSvc.UpdateScene(ctx, &client.UpdateSceneRequest{
		Id:               sceneID.String(),
		WidgetsJson:      `[{"id":"w1"}]`,
		DraftWidgetsJson: `[{"id":"w2"}]`,
		DraftLayoutJson:  `{}`,
		EditorStateJson:  first,
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if resp.Scene.EditorStateJson != first {
		t.Fatalf("update replied with editor state %q", resp.Scene.EditorStateJson)
	}
	scene := get()
	if scene.EditorStateJson != first || scene.WidgetsJson != `[{"id":"w1"}]` || scene.DraftWidgetsJson != `[{"id":"w2"}]` {
		t.Fatalf("documents and editor state not stored together: %+v", scene)
	}

	// An update that names no editor state leaves it alone.
	if _, err := sceneSvc.UpdateScene(ctx, &client.UpdateSceneRequest{Id: sceneID.String(), Name: "renamed"}); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if state := get().EditorStateJson; state != first {
		t.Fatalf("a rename changed the editor state to %q", state)
	}

	// Clearing the draft and storing editor state in one request does both.
	const second = `{"v":2,"headId":"e.2","clients":{}}`
	_, err = sceneSvc.UpdateScene(ctx, &client.UpdateSceneRequest{
		Id:              sceneID.String(),
		WidgetsJson:     `[{"id":"w2"}]`,
		ClearDraft:      true,
		EditorStateJson: second,
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	scene = get()
	if scene.HasDraft || scene.WidgetsJson != `[{"id":"w2"}]` || scene.EditorStateJson != second {
		t.Fatalf("publish with editor state: %+v", scene)
	}
}

// Editor state describes the documents stored beside it: a document write
// that carries none (an external save) clears it, a rename keeps it.
func TestSceneService_Update_DocumentWriteWithoutEditorStateClearsIt(t *testing.T) {
	sceneSvc, _, _, db := newSceneSvc(t)
	sceneID := seedScene(t, db, "main")
	ctx := context.Background()
	const state = `{"v":3,"headId":"e.3","clients":{}}`
	store := func() {
		t.Helper()
		_, err := sceneSvc.UpdateScene(ctx, &client.UpdateSceneRequest{Id: sceneID.String(), EditorStateJson: state})
		if err != nil {
			t.Fatalf("store editor state: %v", err)
		}
	}
	update := func(req *client.UpdateSceneRequest) *client.Scene {
		t.Helper()
		req.Id = sceneID.String()
		resp, err := sceneSvc.UpdateScene(ctx, req)
		if err != nil {
			t.Fatalf("update: %v", err)
		}
		return resp.Scene
	}

	store()
	if scene := update(&client.UpdateSceneRequest{Name: "renamed", Description: "described"}); scene.EditorStateJson != state {
		t.Fatalf("a rename changed the editor state to %q", scene.EditorStateJson)
	}

	documentWrites := map[string]*client.UpdateSceneRequest{
		"widgets":     {WidgetsJson: `[{"id":"w1"}]`},
		"layout":      {LayoutJson: `{"width":1920}`},
		"draft":       {DraftWidgetsJson: `[]`, DraftLayoutJson: `{}`},
		"clear draft": {ClearDraft: true},
	}
	for name, req := range documentWrites {
		store()
		if scene := update(req); scene.EditorStateJson != "" {
			t.Fatalf("%s write kept editor state %q", name, scene.EditorStateJson)
		}
	}
}

// An update writes only the columns it names. A writer that lands between
// this update's read and its write keeps its columns.
func TestSceneService_Update_KeepsAConcurrentWritersColumns(t *testing.T) {
	sceneSvc, _, _, db := newSceneSvc(t)
	sceneID := seedScene(t, db, "main")
	ctx := context.Background()

	const state = `{"v":1,"headId":"e.1","clients":{}}`
	interleaved := false
	err := db.Callback().Update().Before("gorm:update").Register("test:concurrent_writer", func(tx *gorm.DB) {
		if interleaved {
			return
		}
		interleaved = true
		err := tx.Session(&gorm.Session{NewDB: true}).Exec(
			`UPDATE scenes SET widgets_json = ?, editor_state_json = ? WHERE id = ?`,
			`[{"id":"w1"}]`, state, sceneID.String(),
		).Error
		if err != nil {
			t.Errorf("concurrent write: %v", err)
		}
	})
	if err != nil {
		t.Fatalf("register callback: %v", err)
	}

	if _, err := sceneSvc.UpdateScene(ctx, &client.UpdateSceneRequest{Id: sceneID.String(), Name: "renamed"}); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if !interleaved {
		t.Fatalf("the concurrent write never ran")
	}

	resp, err := sceneSvc.GetScene(ctx, &client.GetSceneRequest{Id: sceneID.String()})
	if err != nil {
		t.Fatalf("get scene: %v", err)
	}
	scene := resp.Scene
	if scene.Name != "renamed" || scene.WidgetsJson != `[{"id":"w1"}]` || scene.EditorStateJson != state {
		t.Fatalf("an update overwrote a concurrent writer's columns: %+v", scene)
	}
}
