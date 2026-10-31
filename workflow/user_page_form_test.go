package main

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/facts"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

const (
	formSubmitted      = "userpage.form.submitted"
	formViewerIdentity = "viewer.platformUserId"

	// What db-proxy publishes for each kind of viewer; see
	// db/app/services/user_page_submission_service.go.
	anonymousFormViewer = `{"platform":null,"platformUserId":null,"displayName":"anonymous","roles":[]}`
	// A viewer really named "anonymous", who must still be counted as themselves.
	signedInFormViewer = `{"platform":"twitch","platformUserId":"42","displayName":"anonymous","roles":[]}`
)

// formTriggerEmits reads the trigger's emits from the bundled manifest, so the
// identity annotations under test are the ones the engine registers.
func formTriggerEmits(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile("../modules/woofx3/manifest.json")
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest struct {
		Triggers []struct {
			Event string          `json:"event"`
			Emits json.RawMessage `json:"emits"`
		} `json:"triggers"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	for _, trigger := range manifest.Triggers {
		if trigger.Event == formSubmitted {
			return string(trigger.Emits)
		}
	}
	t.Fatalf("the manifest declares no %s trigger", formSubmitted)
	return ""
}

// formPayload is a submission as published. An anonymous one has no platform
// extension, so platformExtension is empty for it.
func formPayload(id, viewer, platformExtension string) []byte {
	extension := ""
	if platformExtension != "" {
		extension = `"platform":"` + platformExtension + `",`
	}
	return []byte(`{"id":"` + id + `","type":"` + formSubmitted + `","source":"db-proxy",` + extension +
		`"data":{"formId":"form-1","viewer":` + viewer + `}}`)
}

func TestUserPageFormViewerThroughResolverAndFacts(t *testing.T) {
	logger := &factLogger{}
	factClient := &fakeFactClient{defs: []facts.FactDefinition{{
		ID:        "user:fact:forms",
		Revision:  1,
		Status:    facts.StatusActive,
		Aggregate: facts.Aggregate{Fn: facts.AggregateCount},
		Sources: []facts.FactSource{{
			Trigger:         "woofx3:trigger:userpage_form_submitted",
			EventPattern:    formSubmitted,
			IdentityPath:    formViewerIdentity,
			DisplayNamePath: "viewer.displayName",
		}},
	}}}
	reads := &fakeViewerReads{respond: func(*dbv1.GetViewerFactsRequest) *dbv1.GetViewerFactsResponse {
		return &dbv1.GetViewerFactsResponse{}
	}}

	app := NewWorkflowApp(logger)
	app.factCtx = context.Background()
	app.facts = facts.NewProjector(factClient)
	if err := app.facts.Replace(factClient.defs); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	app.engine.SetViewerFacts(newViewerFactReader(reads,
		catalogOf(t, moduleTrigger("woofx3", "userpage_form_submitted", formSubmitted, formTriggerEmits(t))), logger))
	seen := make(chan map[string]any, 4)
	if err := app.engine.RegisterAction("seen", func(_ tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		seen <- params
		return nil, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	if err := app.engine.RegisterWorkflow(&types.WorkflowDefinition{
		ID:      "wf-form",
		Name:    "form",
		Trigger: &types.TriggerConfig{Type: "event", Event: formSubmitted},
		Tasks: []types.TaskDefinition{{
			ID: "seen", Type: "action", Action: "seen",
			Parameters: map[string]any{
				"name":      "${trigger.data.viewer.displayName}",
				"greeting":  "Thanks ${trigger.data.viewer.displayName}!",
				"anonymous": "${trigger.data.viewer.platformUserId == null}",
				"replaced":  "${trigger.data.viewer.platformUserId == null ? 'friend' : trigger.data.viewer.displayName}",
				"viewerId":  "${viewer.id}",
				"viewerAt":  "${viewer.platform}",
				"viewerAs":  "${viewer.name}",
				"fact":      "${viewer.user.forms}",
			},
		}},
	}); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	t.Cleanup(func() { _ = app.engine.Stop() })

	await := func() map[string]any {
		t.Helper()
		select {
		case params := <-seen:
			return params
		case <-time.After(2 * time.Second):
			t.Fatal("the workflow did not run")
			return nil
		}
	}
	expect := func(params map[string]any, want map[string]any) {
		t.Helper()
		for key, value := range want {
			if params[key] != value {
				t.Errorf("%s = %#v, want %#v", key, params[key], value)
			}
		}
	}

	app.handleTriggerEvent(formPayload("anon-1", anonymousFormViewer, ""), formSubmitted)
	expect(await(), map[string]any{
		"name":      "anonymous",
		"greeting":  "Thanks anonymous!",
		"anonymous": true,
		"replaced":  "friend",
		"viewerId":  nil,
		"viewerAt":  nil,
		"viewerAs":  nil,
		"fact":      nil,
	})
	if n := factClient.appliedCount(); n != 0 {
		t.Fatalf("an anonymous submission applied %d fact batches", n)
	}
	if n := reads.readCount(); n != 0 {
		t.Fatalf("an anonymous submission read facts %d times", n)
	}

	// Proves the checks above are not vacuous, and that the name is no signal.
	app.handleTriggerEvent(formPayload("named-1", signedInFormViewer, "twitch"), formSubmitted)
	expect(await(), map[string]any{
		"name":      "anonymous",
		"anonymous": false,
		"replaced":  "anonymous",
		"viewerId":  "42",
		"viewerAt":  "twitch",
		"viewerAs":  "anonymous",
	})
	deadline := time.Now().Add(2 * time.Second)
	for factClient.appliedCount() != 1 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if n := factClient.appliedCount(); n != 1 {
		t.Fatalf("a signed-in submission applied %d fact batches, want 1", n)
	}
	if n := reads.readCount(); n != 1 {
		t.Fatalf("a signed-in submission read facts %d times, want 1", n)
	}
}

// The missing platform extension is one guard and the null id another; neither
// may depend on the other, so an anonymous viewer on a platform names nobody.
func TestUserPageFormNullIdentityNamesNoViewerEvenWithAPlatform(t *testing.T) {
	var data map[string]any
	if err := json.Unmarshal([]byte(`{"viewer":`+anonymousFormViewer+`}`), &data); err != nil {
		t.Fatalf("decode: %v", err)
	}
	event := &types.Event{ID: "e", Type: formSubmitted, Source: "db-proxy", Platform: "twitch", Time: time.Now(), Data: data}

	reads := &fakeViewerReads{}
	reader := newViewerFactReader(reads,
		catalogOf(t, moduleTrigger("woofx3", "userpage_form_submitted", formSubmitted, formTriggerEmits(t))), &factLogger{})
	if got, err := reader.Viewer(context.Background(), formSubmitted, event); got != nil || err != nil {
		t.Fatalf("Viewer = %v, %v; want nil, nil", got, err)
	}
	if reads.readCount() != 0 {
		t.Fatal("read facts for a null identity")
	}

	client := &fakeFactClient{}
	projector := facts.NewProjector(client)
	if err := projector.Replace([]facts.FactDefinition{{
		ID: "user:fact:forms", Revision: 1, Status: facts.StatusActive,
		Aggregate: facts.Aggregate{Fn: facts.AggregateCount},
		Sources:   []facts.FactSource{{Trigger: "woofx3:trigger:userpage_form_submitted", EventPattern: formSubmitted, IdentityPath: formViewerIdentity}},
	}}); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	if _, err := projector.Project(context.Background(), event); err != nil {
		t.Fatalf("Project: %v", err)
	}
	if client.appliedCount() != 0 {
		t.Fatal("a null identity produced a fact delta")
	}
}
