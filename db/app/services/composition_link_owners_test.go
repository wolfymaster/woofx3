package services

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// linkFixture is a database with an alert and a scene, and the scene service
// that reads composition links back.
type linkFixture struct {
	scenes client.SceneService
	alert  *client.Scene
	scene  *client.Scene
}

func newLinkFixture(t *testing.T, db *gorm.DB) *linkFixture {
	t.Helper()
	scenes := NewSceneService(repository.NewSceneRepository(db), nil, nil, repository.NewCompositionLinkRepository(db), nil)
	return &linkFixture{
		scenes: scenes,
		alert:  createComposition(t, scenes, &client.CreateSceneRequest{Name: "Follow", Kind: "alert"}),
		scene:  createComposition(t, scenes, &client.CreateSceneRequest{Name: "Main"}),
	}
}

// links lists who plays the fixture's alert, as "kind owner step".
func (f *linkFixture) links(t *testing.T) []string {
	t.Helper()
	resp, err := f.scenes.ListCompositionLinks(context.Background(), &client.ListCompositionLinksRequest{CompositionId: f.alert.Id})
	if err != nil {
		t.Fatalf("list links: %v", err)
	}
	out := make([]string, len(resp.Links))
	for i, link := range resp.Links {
		out[i] = fmt.Sprintf("%s %s %s", link.OwnerKind, link.OwnerId, link.StepId)
	}
	return out
}

func alertSteps(compositionID string, stepIDs ...string) string {
	steps := make([]string, len(stepIDs))
	for i, id := range stepIDs {
		idField := ""
		if id != "" {
			idField = fmt.Sprintf(`"id":%q,`, id)
		}
		steps[i] = fmt.Sprintf(`{%s"type":"action","action":"alert","parameters":{"composition":%q,"inputs":{"name":"${trigger.data.userName}"}}}`,
			idField, compositionID)
	}
	return "[" + strings.Join(steps, ",") + "]"
}

func sameLinks(got []string, want ...string) bool {
	return strings.Join(got, "|") == strings.Join(want, "|")
}

// Saving a workflow keeps its links to exactly the compositions its alert
// steps play, and deleting it removes them.
func TestWorkflowSaveMaintainsCompositionLinks(t *testing.T) {
	svc, db := newWorkflowTestServiceWithDB(t)
	f := newLinkFixture(t, db)
	ctx := context.Background()

	wf := createWorkflow(t, svc, &client.CreateWorkflowRequest{
		Name: "Follow alert",
		StepsJson: `[{"id":"say","type":"action","action":"chat.reply","parameters":{"message":"hi"}},` +
			strings.Trim(alertSteps(f.alert.Id, "play"), "[]") + `]`,
	})
	if got := f.links(t); !sameLinks(got, "workflow "+wf.Id+" play") {
		t.Fatalf("after create: %v", got)
	}

	if _, err := svc.UpdateWorkflow(ctx, &client.UpdateWorkflowRequest{Id: wf.Id, StepsJson: alertSteps(f.alert.Id, "a", "b")}); err != nil {
		t.Fatalf("update: %v", err)
	}
	if got := f.links(t); !sameLinks(got, "workflow "+wf.Id+" a", "workflow "+wf.Id+" b") {
		t.Fatalf("after update: %v", got)
	}

	if _, err := svc.UpdateWorkflow(ctx, &client.UpdateWorkflowRequest{
		Id:        wf.Id,
		StepsJson: `[{"id":"inline","type":"action","action":"alert","parameters":{"layout":{"width":1,"height":1,"widgets":[]}}}]`,
	}); err != nil {
		t.Fatalf("update to an inline alert: %v", err)
	}
	if got := f.links(t); len(got) != 0 {
		t.Fatalf("an inline alert step kept links: %v", got)
	}

	if _, err := svc.UpdateWorkflow(ctx, &client.UpdateWorkflowRequest{Id: wf.Id, StepsJson: alertSteps(f.alert.Id, "a")}); err != nil {
		t.Fatalf("relink: %v", err)
	}
	if _, err := svc.DeleteWorkflow(ctx, &client.DeleteWorkflowRequest{Id: wf.Id}); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := f.links(t); len(got) != 0 {
		t.Fatalf("a deleted workflow kept links: %v", got)
	}
}

// A workflow that plays something that is not a stored alert is not saved at
// all: neither the definition nor its links.
func TestWorkflowSaveRefusesAStepThatPlaysNoAlert(t *testing.T) {
	svc, db := newWorkflowTestServiceWithDB(t)
	f := newLinkFixture(t, db)
	ctx := context.Background()

	refused := map[string]string{
		"a scene":           alertSteps(f.scene.Id, "play"),
		"an unknown id":     alertSteps(uuid.NewString(), "play"),
		"not an id":         alertSteps("follow", "play"),
		"one step id twice": alertSteps(f.alert.Id, "play", "play"),
	}
	for name, steps := range refused {
		_, err := svc.CreateWorkflow(ctx, &client.CreateWorkflowRequest{Name: name, StepsJson: steps, TriggerJson: `{}`})
		if twirpCode(err) != twirp.InvalidArgument {
			t.Errorf("create with %s: %v, want invalid_argument", name, err)
		}
	}
	var stored int64
	if err := db.Table("workflow_definitions").Count(&stored).Error; err != nil {
		t.Fatalf("count workflows: %v", err)
	}
	if stored != 0 {
		t.Fatalf("%d refused workflows were stored", stored)
	}

	wf := createWorkflow(t, svc, &client.CreateWorkflowRequest{Name: "ok", StepsJson: alertSteps(f.alert.Id, "play")})
	_, err := svc.UpdateWorkflow(ctx, &client.UpdateWorkflowRequest{Id: wf.Id, StepsJson: alertSteps(f.scene.Id, "other")})
	if twirpCode(err) != twirp.InvalidArgument || !strings.Contains(err.(twirp.Error).Msg(), "not an alert") {
		t.Fatalf("update to a scene: %v", err)
	}
	got, err := svc.GetWorkflow(ctx, &client.GetWorkflowRequest{Id: wf.Id})
	if err != nil || !strings.Contains(got.Workflow.StepsJson, `"play"`) {
		t.Fatalf("a refused update changed the workflow: %+v, %v", got, err)
	}
	if links := f.links(t); !sameLinks(links, "workflow "+wf.Id+" play") {
		t.Fatalf("a refused update changed the links: %v", links)
	}
}

// A command's actions link like a workflow's steps; an action without an id
// is named by its position.
func TestCommandSaveMaintainsCompositionLinks(t *testing.T) {
	fx := newCommandPermFixture(t)
	f := newLinkFixture(t, fx.db)
	ctx := context.Background()

	created, err := fx.svc.CreateCommand(ctx, &client.CreateCommandRequest{
		Command: "hype", ActionsJson: alertSteps(f.alert.Id, ""), Enabled: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := created.Command.Id
	if got := f.links(t); !sameLinks(got, "command "+id+" step[0]") {
		t.Fatalf("after create: %v", got)
	}

	if _, err := fx.svc.UpdateCommand(ctx, &client.UpdateCommandRequest{
		Id: id, Command: "hype", ActionsJson: alertSteps(f.scene.Id, "a1"), Enabled: true,
	}); twirpCode(err) != twirp.InvalidArgument {
		t.Fatalf("update to a scene: %v, want invalid_argument", err)
	}
	if got := f.links(t); !sameLinks(got, "command "+id+" step[0]") {
		t.Fatalf("a refused update changed the links: %v", got)
	}

	if _, err := fx.svc.UpdateCommand(ctx, &client.UpdateCommandRequest{
		Id: id, Command: "hype", ActionsJson: alertSteps(f.alert.Id, "a1"), Enabled: true,
	}); err != nil {
		t.Fatalf("update: %v", err)
	}
	if got := f.links(t); !sameLinks(got, "command "+id+" a1") {
		t.Fatalf("after update: %v", got)
	}

	if _, err := fx.svc.DeleteCommand(ctx, &client.DeleteCommandRequest{Id: id}); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := f.links(t); len(got) != 0 {
		t.Fatalf("a deleted command kept links: %v", got)
	}

	if _, err := fx.svc.CreateCommand(ctx, &client.CreateCommandRequest{
		Command: "nope", ActionsJson: alertSteps(uuid.NewString(), "x"), Enabled: true,
	}); twirpCode(err) != twirp.InvalidArgument {
		t.Fatalf("create playing an unknown composition: %v, want invalid_argument", err)
	}
}
