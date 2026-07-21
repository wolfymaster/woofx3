package engine

import (
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// fakeAssetURLResolver lets tests assert the applicationId buildResolver
// derives from the workflow, without depending on the real db-backed
// implementation in workflow/asset_settings.go (a different Go module).
type fakeAssetURLResolver struct {
	byApplicationID map[string]string
}

func (f *fakeAssetURLResolver) Resolve(applicationID string) string {
	return f.byApplicationID[applicationID]
}

func TestBuildResolver_AddsWoofx3AssetURLSource(t *testing.T) {
	e := New[triggerSvcs](testLogger{})
	e.SetAssetURLResolver(&fakeAssetURLResolver{
		byApplicationID: map[string]string{"app-1": "https://cdn.example.com/assets"},
	})

	if err := e.RegisterWorkflow(&types.WorkflowDefinition{
		ID:            "wf-1",
		Name:          "test",
		ApplicationID: "app-1",
		Trigger:       &types.TriggerConfig{Type: "event", Event: "test.event"},
		Tasks: []types.TaskDefinition{
			{ID: "t1", Type: "action", Action: "print", Parameters: map[string]any{}},
		},
	}); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}

	event := &types.Event{ID: "evt-1", Type: "test.event"}
	resolver := e.buildResolver("wf-1", event, map[string]map[string]any{})

	got, err := resolver.ResolveString("${woofx3_asset_url}/bell.mp3")
	if err != nil {
		t.Fatalf("ResolveString: %v", err)
	}
	if got != "https://cdn.example.com/assets/bell.mp3" {
		t.Errorf("ResolveString() = %q, want %q", got, "https://cdn.example.com/assets/bell.mp3")
	}
}

func TestBuildResolver_UnknownWorkflowResolvesEmptyAssetURL(t *testing.T) {
	e := New[triggerSvcs](testLogger{})
	e.SetAssetURLResolver(&fakeAssetURLResolver{
		byApplicationID: map[string]string{"": "https://default.example.com/assets"},
	})

	event := &types.Event{ID: "evt-1", Type: "test.event"}
	resolver := e.buildResolver("unregistered-workflow", event, map[string]map[string]any{})

	got, err := resolver.ResolveString("${woofx3_asset_url}/bell.mp3")
	if err != nil {
		t.Fatalf("ResolveString: %v", err)
	}
	if got != "https://default.example.com/assets/bell.mp3" {
		t.Errorf("ResolveString() = %q, want %q", got, "https://default.example.com/assets/bell.mp3")
	}
}

func TestBuildResolver_NoResolverConfiguredResolvesEmptyString(t *testing.T) {
	e := New[triggerSvcs](testLogger{})

	event := &types.Event{ID: "evt-1", Type: "test.event"}
	resolver := e.buildResolver("wf-1", event, map[string]map[string]any{})

	got, err := resolver.ResolveString("${woofx3_asset_url}/bell.mp3")
	if err != nil {
		t.Fatalf("ResolveString: %v", err)
	}
	if got != "/bell.mp3" {
		t.Errorf("ResolveString() = %q, want %q", got, "/bell.mp3")
	}
}

type testLogger struct{}

func (testLogger) Info(string, ...any)  {}
func (testLogger) Warn(string, ...any)  {}
func (testLogger) Error(string, ...any) {}
func (testLogger) Debug(string, ...any) {}
