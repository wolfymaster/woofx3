package services

import (
	"testing"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
)

func TestBuildTriggerRegisteredData(t *testing.T) {
	id := uuid.New()
	triggers := []*models.Trigger{{
		ID:            id,
		Category:      "platform.twitch",
		Name:          "channel.follow",
		Description:   "desc",
		Event:         "twitch.channel.follow",
		ConfigSchema:  "[]",
		AllowVariants: false,
		CreatedByType: "MODULE",
		CreatedByRef:  "twitch:1.0.0:abcdef1",
	}}

	data := buildTriggerRegisteredData("twitch:1.0.0:abcdef1", "Twitch", "1.0.0", triggers)

	if got := data["module_key"]; got != "twitch:1.0.0:abcdef1" {
		t.Errorf("module_key = %v", got)
	}
	if got := data["module_name"]; got != "Twitch" {
		t.Errorf("module_name = %v", got)
	}
	if got := data["version"]; got != "1.0.0" {
		t.Errorf("version = %v", got)
	}

	list, ok := data["triggers"].([]map[string]any)
	if !ok {
		t.Fatalf("triggers is not []map[string]any, got %T", data["triggers"])
	}
	if len(list) != 1 {
		t.Fatalf("len(triggers) = %d", len(list))
	}
	row := list[0]
	if row["id"] != id.String() {
		t.Errorf("id = %v", row["id"])
	}
	if row["created_by_ref"] != "twitch:1.0.0:abcdef1" {
		t.Errorf("created_by_ref = %v", row["created_by_ref"])
	}
	if row["allow_variants"] != false {
		t.Errorf("allow_variants = %v", row["allow_variants"])
	}
}

func TestBuildTriggerRegisteredDataEmpty(t *testing.T) {
	data := buildTriggerRegisteredData("k", "n", "v", nil)
	list, ok := data["triggers"].([]map[string]any)
	if !ok || len(list) != 0 {
		t.Fatalf("expected empty triggers slice, got %v (%T)", data["triggers"], data["triggers"])
	}
}

func TestBuildActionRegisteredData(t *testing.T) {
	id := uuid.New()
	actions := []*models.Action{{
		ID:            id,
		Name:          "send",
		Description:   "desc",
		Call:          "mod.send",
		ParamsSchema:  "{}",
		CreatedByType: "MODULE",
		CreatedByRef:  "twitch:1.0.0:abcdef1",
	}}

	data := buildActionRegisteredData("twitch:1.0.0:abcdef1", "Twitch", "1.0.0", actions)

	list, ok := data["actions"].([]map[string]any)
	if !ok || len(list) != 1 {
		t.Fatalf("actions not populated, got %v", data["actions"])
	}
	row := list[0]
	if row["id"] != id.String() {
		t.Errorf("id = %v", row["id"])
	}
	if row["call"] != "mod.send" {
		t.Errorf("call = %v", row["call"])
	}
	if row["params_schema"] != "{}" {
		t.Errorf("params_schema = %v", row["params_schema"])
	}
}

func TestBuildWorkflowChangeData(t *testing.T) {
	t.Run("includes enabled and projection key for module-owned rows", func(t *testing.T) {
		id := uuid.New()
		appID := uuid.New()
		wf := &models.WorkflowDefinition{
			ID:            id,
			ApplicationID: appID,
			Name:          "wolfy_profile/Follow",
			Steps:         "[]",
			Trigger:       "{}",
			Enabled:       true,
			CreatedByType: "MODULE",
			CreatedByRef:  "wolfy_profile:1.0.0:abc1234",
			ManifestID:    "follow-workflow",
		}

		row := buildWorkflowChangeData(wf)

		if got := row["enabled"]; got != true {
			t.Errorf("enabled = %v, want true", got)
		}
		if got := row["projection_key"]; got != "wolfy_profile:1.0.0:abc1234:workflow:follow-workflow" {
			t.Errorf("projection_key = %v", got)
		}
		if got := row["id"]; got != id.String() {
			t.Errorf("id = %v", got)
		}
	})

	t.Run("emits enabled=false for newly created (inert) workflows", func(t *testing.T) {
		wf := &models.WorkflowDefinition{
			ID:            uuid.New(),
			ApplicationID: uuid.New(),
			Name:          "fresh",
			Steps:         "[]",
			Trigger:       "{}",
			Enabled:       false,
			CreatedByType: "USER",
		}
		row := buildWorkflowChangeData(wf)
		if got := row["enabled"]; got != false {
			t.Errorf("enabled = %v, want false", got)
		}
		if _, ok := row["projection_key"]; ok {
			t.Errorf("USER workflow should not carry projection_key, got %v", row["projection_key"])
		}
	})
}

func TestModuleCatalogFields(t *testing.T) {
	t.Run("extracts author, category, and description from a well-formed manifest", func(t *testing.T) {
		manifest := `{"id":"m","name":"M","author":"WolfyMaster LLC","category":"platform","description":"a module"}`
		author, category, description := moduleCatalogFields(manifest)
		if author != "WolfyMaster LLC" {
			t.Errorf("author = %q", author)
		}
		if category != "platform" {
			t.Errorf("category = %q", category)
		}
		if description != "a module" {
			t.Errorf("description = %q", description)
		}
	})

	t.Run("defaults author and category to Unknown when missing", func(t *testing.T) {
		manifest := `{"id":"m","name":"M"}`
		author, category, description := moduleCatalogFields(manifest)
		if author != "Unknown" || category != "Unknown" || description != "" {
			t.Errorf("got (%q, %q, %q)", author, category, description)
		}
	})

	t.Run("treats blank values as missing for author and category", func(t *testing.T) {
		manifest := `{"author":"  ","category":"","description":"  trimmed  "}`
		author, category, description := moduleCatalogFields(manifest)
		if author != "Unknown" || category != "Unknown" {
			t.Errorf("blank fields not defaulted: author=%q category=%q", author, category)
		}
		if description != "trimmed" {
			t.Errorf("description = %q", description)
		}
	})

	t.Run("falls back to defaults on empty or malformed input", func(t *testing.T) {
		for _, raw := range []string{"", "not-json", "{"} {
			author, category, description := moduleCatalogFields(raw)
			if author != "Unknown" || category != "Unknown" || description != "" {
				t.Errorf("input %q: got (%q, %q, %q)", raw, author, category, description)
			}
		}
	})
}
