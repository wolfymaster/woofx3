package services

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
)

func TestSceneService_Compositions_SQLite(t *testing.T) {
	sceneSvc, _, _, _ := newSceneSvc(t)
	testSceneCompositions(t, sceneSvc)
}

func TestSceneService_Compositions_Postgres(t *testing.T) {
	sceneSvc, _ := newScenePostgresSvc(t)
	testSceneCompositions(t, sceneSvc)
}

func createComposition(t *testing.T, svc client.SceneService, req *client.CreateSceneRequest) *client.Scene {
	t.Helper()
	resp, err := svc.CreateScene(context.Background(), req)
	if err != nil {
		t.Fatalf("create %s %q: %v", req.Kind, req.Name, err)
	}
	return resp.Scene
}

func getComposition(t *testing.T, svc client.SceneService, id string) *client.Scene {
	t.Helper()
	resp, err := svc.GetScene(context.Background(), &client.GetSceneRequest{Id: id})
	if err != nil {
		t.Fatalf("get %s: %v", id, err)
	}
	return resp.Scene
}

func twirpCode(err error) twirp.ErrorCode {
	var terr twirp.Error
	if errors.As(err, &terr) {
		return terr.Code()
	}
	return ""
}

// A row is a scene unless created as an alert; behaviors (published and
// draft) and inputs are stored and returned; listing returns one kind,
// scenes by default; names are unique per kind.
func testSceneCompositions(t *testing.T, svc client.SceneService) {
	ctx := context.Background()
	scene := createComposition(t, svc, &client.CreateSceneRequest{Name: "Main"})
	if scene.Kind != "scene" || scene.BehaviorsJson != "{}" || scene.InputsJson != "[]" {
		t.Fatalf("a plain create = kind %q, behaviors %q, inputs %q", scene.Kind, scene.BehaviorsJson, scene.InputsJson)
	}
	const behaviors = `{"b1":{"type":"transition","kind":"fade","target":"w1"}}`
	const inputs = `[{"id":"name","label":"Name","type":"text","defaultValue":"friend"}]`
	alert := createComposition(t, svc, &client.CreateSceneRequest{
		Name: "Main", Kind: "alert", BehaviorsJson: behaviors, InputsJson: inputs,
	})
	if alert.Kind != "alert" {
		t.Fatalf("alert kind = %q", alert.Kind)
	}
	stored := getComposition(t, svc, alert.Id)
	if !sameJSON(t, stored.BehaviorsJson, behaviors) || !sameJSON(t, stored.InputsJson, inputs) {
		t.Fatalf("alert stored behaviors %q, inputs %q", stored.BehaviorsJson, stored.InputsJson)
	}
	if _, err := svc.CreateScene(ctx, &client.CreateSceneRequest{Name: "Main", Kind: "alert"}); err == nil {
		t.Fatalf("two alerts share a name")
	}

	refused := map[string]*client.CreateSceneRequest{
		"unknown kind":        {Name: "x1", Kind: "widget"},
		"behaviors array":     {Name: "x2", BehaviorsJson: `[]`},
		"inputs object":       {Name: "x3", InputsJson: `{}`},
		"input without id":    {Name: "x4", InputsJson: `[{"label":"A","type":"text"}]`},
		"input id twice":      {Name: "x5", InputsJson: `[{"id":"a","label":"A","type":"text"},{"id":"a","label":"B","type":"text"}]`},
		"input without label": {Name: "x6", InputsJson: `[{"id":"a","type":"text"}]`},
	}
	for name, req := range refused {
		if _, err := svc.CreateScene(ctx, req); twirpCode(err) != twirp.InvalidArgument {
			t.Errorf("%s: create error = %v, want invalid_argument", name, err)
		}
	}

	scenes, err := svc.ListScenes(ctx, &client.ListScenesRequest{})
	if err != nil {
		t.Fatalf("list scenes: %v", err)
	}
	if len(scenes.Scenes) != 1 || scenes.Scenes[0].Id != scene.Id || scenes.TotalCount != 1 {
		t.Fatalf("default listing = %+v, want the scene alone", scenes.Scenes)
	}
	alerts, err := svc.ListScenes(ctx, &client.ListScenesRequest{Kind: "alert"})
	if err != nil {
		t.Fatalf("list alerts: %v", err)
	}
	if len(alerts.Scenes) != 1 || alerts.Scenes[0].Id != alert.Id {
		t.Fatalf("alert listing = %+v, want the alert alone", alerts.Scenes)
	}
	if _, err := svc.ListScenes(ctx, &client.ListScenesRequest{Kind: "widget"}); twirpCode(err) != twirp.InvalidArgument {
		t.Fatalf("listing an unknown kind: %v", err)
	}

	// A draft carries its own behaviors; a draft written without them has
	// none, and clearing the draft clears them.
	const draftBehaviors = `{"b2":{"type":"effect","kind":"pulse","target":"w1"}}`
	update := func(req *client.UpdateSceneRequest) *client.Scene {
		t.Helper()
		req.Id = alert.Id
		resp, err := svc.UpdateScene(ctx, req)
		if err != nil {
			t.Fatalf("update: %v", err)
		}
		return resp.Scene
	}
	got := update(&client.UpdateSceneRequest{DraftWidgetsJson: `[]`, DraftLayoutJson: `{}`, DraftBehaviorsJson: draftBehaviors})
	if !got.HasDraft || !sameJSON(t, got.DraftBehaviorsJson, draftBehaviors) || !sameJSON(t, got.BehaviorsJson, behaviors) {
		t.Fatalf("draft behaviors not stored beside the published ones: %+v", got)
	}
	got = update(&client.UpdateSceneRequest{DraftWidgetsJson: `[]`, DraftLayoutJson: `{}`})
	if got.DraftBehaviorsJson != "{}" {
		t.Fatalf("a draft written without behaviors kept %q", got.DraftBehaviorsJson)
	}
	got = update(&client.UpdateSceneRequest{BehaviorsJson: `{}`, InputsJson: `[]`, ClearDraft: true})
	if got.HasDraft || got.DraftBehaviorsJson != "" || got.BehaviorsJson != "{}" || got.InputsJson != "[]" {
		t.Fatalf("publishing with no behaviors or inputs: %+v", got)
	}

	refusedUpdates := map[string]*client.UpdateSceneRequest{
		"behaviors array":         {BehaviorsJson: `[]`},
		"draft behaviors alone":   {DraftBehaviorsJson: `{}`},
		"draft behaviors cleared": {DraftWidgetsJson: `[]`, DraftLayoutJson: `{}`, DraftBehaviorsJson: `{}`, ClearDraft: true},
		"draft behaviors array":   {DraftWidgetsJson: `[]`, DraftLayoutJson: `{}`, DraftBehaviorsJson: `[]`},
		"inputs not fields":       {InputsJson: `[1]`},
	}
	for name, req := range refusedUpdates {
		req.Id = alert.Id
		if _, err := svc.UpdateScene(ctx, req); twirpCode(err) != twirp.InvalidArgument {
			t.Errorf("%s: update error = %v, want invalid_argument", name, err)
		}
	}

	// Behaviors and inputs are documents: writing them without editor state
	// clears the stored state.
	for name, req := range map[string]*client.UpdateSceneRequest{
		"behaviors": {BehaviorsJson: behaviors},
		"inputs":    {InputsJson: inputs},
	} {
		update(&client.UpdateSceneRequest{EditorStateJson: `{"v":1}`})
		if got := update(req); got.EditorStateJson != "" {
			t.Errorf("a %s write kept editor state %q", name, got.EditorStateJson)
		}
	}
}

// sameJSON compares two JSON texts by value, since postgres stores JSONB in
// its own key order and spacing.
func sameJSON(t *testing.T, a, b string) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal([]byte(a), &x); err != nil {
		t.Fatalf("not JSON %q: %v", a, err)
	}
	if err := json.Unmarshal([]byte(b), &y); err != nil {
		t.Fatalf("not JSON %q: %v", b, err)
	}
	return reflect.DeepEqual(x, y)
}

// An overlay token is a browser-source URL, and an alert is never an overlay
// page, so no token is minted for one.
func TestOverlayTokenService_Mint_RefusesAnAlert(t *testing.T) {
	sceneSvc, tokenSvc, _, _ := newSceneSvc(t)
	alert := createComposition(t, sceneSvc, &client.CreateSceneRequest{Name: "Follow", Kind: "alert"})
	_, err := tokenSvc.MintOverlayToken(context.Background(), &client.MintOverlayTokenRequest{SceneId: alert.Id})
	if twirpCode(err) != twirp.InvalidArgument {
		t.Fatalf("minting a token for an alert: %v, want invalid_argument", err)
	}
}
