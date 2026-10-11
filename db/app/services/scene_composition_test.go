package services

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

func TestSceneService_Compositions_SQLite(t *testing.T) {
	sceneSvc, _, _, _ := newSceneSvc(t)
	testSceneCompositions(t, sceneSvc)
}

func TestSceneService_Compositions_Postgres(t *testing.T) {
	sceneSvc, _ := newScenePostgresSvc(t)
	testSceneCompositions(t, sceneSvc)
}

func TestSceneService_CompositionLinks_SQLite(t *testing.T) {
	sceneSvc, _, _, db := newSceneSvc(t)
	testCompositionLinks(t, sceneSvc, db)
}

func TestSceneService_CompositionLinks_Postgres(t *testing.T) {
	sceneSvc, db := newScenePostgresSvc(t)
	testCompositionLinks(t, sceneSvc, db)
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

// An owner's links are replaced as a whole, only alerts can be linked, and a
// linked alert cannot be deleted until its links are gone.
func testCompositionLinks(t *testing.T, svc client.SceneService, db *gorm.DB) {
	ctx := context.Background()
	follow := createComposition(t, svc, &client.CreateSceneRequest{Name: "Follow", Kind: "alert"})
	raid := createComposition(t, svc, &client.CreateSceneRequest{Name: "Raid", Kind: "alert"})
	scene := createComposition(t, svc, &client.CreateSceneRequest{Name: "Main"})
	workflow := uuid.NewString()

	list := func(id string) []*client.CompositionLink {
		t.Helper()
		resp, err := svc.ListCompositionLinks(ctx, &client.ListCompositionLinksRequest{CompositionId: id})
		if err != nil {
			t.Fatalf("list links: %v", err)
		}
		return resp.Links
	}
	type target struct{ CompositionId, StepId string }
	replace := func(ownerKind, ownerID string, links ...target) ([]*client.CompositionLink, error) {
		targets := make([]repository.CompositionLinkTarget, len(links))
		for i, link := range links {
			targets[i] = repository.CompositionLinkTarget{CompositionID: uuid.MustParse(link.CompositionId), StepID: link.StepId}
		}
		err := db.Transaction(func(tx *gorm.DB) error {
			return replaceOwnerCompositionLinks(tx, ownerKind, ownerID, targets, time.Now().UTC())
		})
		if err != nil {
			return nil, saveError("steps_json", "save", err)
		}
		var owned []*client.CompositionLink
		for _, id := range []string{follow.Id, raid.Id} {
			for _, link := range list(id) {
				if link.OwnerKind == ownerKind && link.OwnerId == ownerID {
					owned = append(owned, link)
				}
			}
		}
		sort.Slice(owned, func(i, j int) bool { return owned[i].StepId < owned[j].StepId })
		return owned, nil
	}
	countOf := func(id string) int32 {
		t.Helper()
		resp, err := svc.CountCompositionLinks(ctx, &client.CountCompositionLinksRequest{CompositionId: id})
		if err != nil {
			t.Fatalf("count links: %v", err)
		}
		return resp.Count
	}

	links, err := replace("workflow", workflow,
		target{CompositionId: follow.Id, StepId: "s1"},
		target{CompositionId: follow.Id, StepId: "s2"},
	)
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	if len(links) != 2 || links[0].StepId != "s1" || links[1].StepId != "s2" {
		t.Fatalf("replace returned %+v", links)
	}
	if _, err := replace("command", "cmd-1", target{CompositionId: follow.Id, StepId: "a1"}); err != nil {
		t.Fatalf("link a command: %v", err)
	}
	if n := countOf(follow.Id); n != 3 {
		t.Fatalf("follow has %d links, want 3", n)
	}
	got := list(follow.Id)
	if len(got) != 3 || got[0].OwnerKind != "command" || got[1].StepId != "s1" || got[2].StepId != "s2" {
		t.Fatalf("follow links = %+v", got)
	}

	_, err = svc.DeleteScene(ctx, &client.DeleteSceneRequest{Id: follow.Id})
	if twirpCode(err) != twirp.FailedPrecondition {
		t.Fatalf("deleting a linked alert: %v, want failed_precondition", err)
	}
	var terr twirp.Error
	if !errors.As(err, &terr) || !strings.Contains(terr.Msg(), "workflow "+workflow+" step s1") ||
		!strings.Contains(terr.Meta("links"), `"stepId":"a1"`) {
		t.Fatalf("the refusal does not name the linking steps: %v", err)
	}
	if getComposition(t, svc, follow.Id) == nil {
		t.Fatalf("the refused delete removed the alert")
	}

	// Replacing keeps an unchanged step's row, moves a changed one and drops
	// the rest.
	before := got[1]
	links, err = replace("workflow", workflow, target{CompositionId: follow.Id, StepId: "s1"},
		target{CompositionId: raid.Id, StepId: "s3"})
	if err != nil {
		t.Fatalf("relink: %v", err)
	}
	if len(links) != 2 || links[0].Id != before.Id || !links[0].CreatedAt.AsTime().Equal(before.CreatedAt.AsTime()) {
		t.Fatalf("an unchanged link was recreated: %+v", links)
	}
	if n := countOf(raid.Id); n != 1 {
		t.Fatalf("raid has %d links, want 1", n)
	}

	refused := map[string][]target{
		"a scene":       {{CompositionId: scene.Id, StepId: "s9"}},
		"an unknown id": {{CompositionId: uuid.NewString(), StepId: "s9"}},
	}
	for name, links := range refused {
		if _, err := replace("workflow", workflow, links...); twirpCode(err) != twirp.InvalidArgument {
			t.Errorf("linking %s: %v, want invalid_argument", name, err)
		}
	}
	if n := countOf(raid.Id); n != 1 {
		t.Fatalf("a refused replace changed the links: raid has %d", n)
	}

	// Once nothing links it, the alert can be deleted.
	if _, err := replace("workflow", workflow); err != nil {
		t.Fatalf("unlink workflow: %v", err)
	}
	if _, err := replace("command", "cmd-1"); err != nil {
		t.Fatalf("unlink command: %v", err)
	}
	if _, err := svc.DeleteScene(ctx, &client.DeleteSceneRequest{Id: follow.Id}); err != nil {
		t.Fatalf("delete an unlinked alert: %v", err)
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
