package services

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// A scene service on a migrated, empty Postgres (see dbtest.OpenPostgres).
func newScenePostgresSvc(t *testing.T) (client.SceneService, *gorm.DB) {
	t.Helper()
	db := dbtest.OpenPostgres(t)
	return NewSceneService(repository.NewSceneRepository(db), nil, nil, nil), db
}

func TestSceneService_EditorState_SQLite(t *testing.T) {
	sceneSvc, _, _, db := newSceneSvc(t)
	testSceneEditorState(t, sceneSvc, seedScene(t, db, "main"))
}

func TestSceneService_EditorState_Postgres(t *testing.T) {
	sceneSvc, db := newScenePostgresSvc(t)
	testSceneEditorState(t, sceneSvc, seedScene(t, db, "main"))
}

// The editor state round-trips byte for byte, is cleared by a document write
// that carries none or by the clear flag, and a request with an invalid state
// writes nothing.
func testSceneEditorState(t *testing.T, sceneSvc client.SceneService, sceneID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	get := func() *client.Scene {
		t.Helper()
		resp, err := sceneSvc.GetScene(ctx, &client.GetSceneRequest{Id: sceneID.String()})
		if err != nil {
			t.Fatalf("get scene: %v", err)
		}
		return resp.Scene
	}
	update := func(req *client.UpdateSceneRequest) error {
		t.Helper()
		req.Id = sceneID.String()
		_, err := sceneSvc.UpdateScene(ctx, req)
		return err
	}
	mustUpdate := func(req *client.UpdateSceneRequest) {
		t.Helper()
		if err := update(req); err != nil {
			t.Fatalf("update: %v", err)
		}
	}

	// Spacing and key order a JSON column would rewrite.
	const state = `{ "v": 2,  "headId": "e.2", "clients": {}, "digest": "x" }`
	mustUpdate(&client.UpdateSceneRequest{WidgetsJson: `[{"id":"w1"}]`, EditorStateJson: state})
	if got := get().EditorStateJson; got != state {
		t.Fatalf("editor state read back as %q, want %q", got, state)
	}

	mustUpdate(&client.UpdateSceneRequest{Name: "renamed"})
	if got := get().EditorStateJson; got != state {
		t.Fatalf("a rename changed the editor state to %q", got)
	}

	mustUpdate(&client.UpdateSceneRequest{WidgetsJson: `[{"id":"w2"}]`})
	if got := get().EditorStateJson; got != "" {
		t.Fatalf("a document write without editor state kept %q", got)
	}

	mustUpdate(&client.UpdateSceneRequest{EditorStateJson: state})
	mustUpdate(&client.UpdateSceneRequest{ClearEditorState: true})
	if got := get().EditorStateJson; got != "" {
		t.Fatalf("clear_editor_state kept %q", got)
	}

	mustUpdate(&client.UpdateSceneRequest{EditorStateJson: state})
	stored := get()
	refused := map[string]*client.UpdateSceneRequest{
		"both state and clear": {EditorStateJson: state, ClearEditorState: true, Name: "refused"},
		"not JSON":             {EditorStateJson: `{"v":`, WidgetsJson: `[{"id":"w3"}]`},
		"not an object":        {EditorStateJson: `[1, 2]`, WidgetsJson: `[{"id":"w3"}]`},
		"a JSON string":        {EditorStateJson: `"state"`, Name: "refused"},
	}
	for name, req := range refused {
		err := update(req)
		var twerr twirp.Error
		if !errors.As(err, &twerr) || twerr.Code() != twirp.InvalidArgument {
			t.Fatalf("%s: got %v, want invalid argument", name, err)
		}
		// Compared with the scene as read before: widgets_json is a JSON column
		// on postgres, which reformats it.
		scene := get()
		if scene.EditorStateJson != state || scene.WidgetsJson != stored.WidgetsJson || scene.Name != stored.Name {
			t.Fatalf("%s: a refused request wrote something: %+v", name, scene)
		}
	}
}
