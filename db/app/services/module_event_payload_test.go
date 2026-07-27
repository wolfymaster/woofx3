package services

import (
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
)

func TestBuildTriggerRegisteredData(t *testing.T) {
	id := uuid.New()
	triggers := []*models.Trigger{{
		ID:            id,
		Taxonomy:      `["platform.twitch","function.chat"]`,
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
	if got, want := row["taxonomy"], []string{"platform.twitch", "function.chat"}; !reflect.DeepEqual(got, want) {
		t.Errorf("taxonomy = %v, want %v", got, want)
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
		Taxonomy:      `["platform.govee","function.lighting"]`,
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
	if got, want := row["taxonomy"], []string{"platform.govee", "function.lighting"}; !reflect.DeepEqual(got, want) {
		t.Errorf("taxonomy = %v, want %v", got, want)
	}
}

func TestBuildActionRegisteredDataDefaultsEmptyTaxonomy(t *testing.T) {
	actions := []*models.Action{{ID: uuid.New(), Name: "send"}}
	data := buildActionRegisteredData("k", "n", "v", actions)
	row := data["actions"].([]map[string]any)[0]
	if got, want := row["taxonomy"], []string{}; !reflect.DeepEqual(got, want) {
		t.Errorf("taxonomy = %v, want %v", got, want)
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
			Taxonomy:      `["platform.twitch"]`,
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
		if got, want := row["taxonomy"], []string{"platform.twitch"}; !reflect.DeepEqual(got, want) {
			t.Errorf("taxonomy = %v, want %v", got, want)
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
	t.Run("extracts author, taxonomy, and description from a well-formed manifest", func(t *testing.T) {
		manifest := `{"id":"m","name":"M","author":"WolfyMaster LLC","taxonomy":["platform.govee","function.lighting"],"description":"a module"}`
		author, taxonomy, description := moduleCatalogFields(manifest)
		if author != "WolfyMaster LLC" {
			t.Errorf("author = %q", author)
		}
		if got, want := taxonomy, []string{"platform.govee", "function.lighting"}; !reflect.DeepEqual(got, want) {
			t.Errorf("taxonomy = %v, want %v", got, want)
		}
		if description != "a module" {
			t.Errorf("description = %q", description)
		}
	})

	t.Run("falls back to legacy category when taxonomy is absent", func(t *testing.T) {
		manifest := `{"id":"m","name":"M","author":"WolfyMaster LLC","category":"platform"}`
		_, taxonomy, _ := moduleCatalogFields(manifest)
		if got, want := taxonomy, []string{"platform"}; !reflect.DeepEqual(got, want) {
			t.Errorf("taxonomy = %v, want %v", got, want)
		}
	})

	t.Run("prefers taxonomy over legacy category when both are present", func(t *testing.T) {
		manifest := `{"id":"m","name":"M","category":"platform","taxonomy":["platform.spotify"]}`
		_, taxonomy, _ := moduleCatalogFields(manifest)
		if got, want := taxonomy, []string{"platform.spotify"}; !reflect.DeepEqual(got, want) {
			t.Errorf("taxonomy = %v, want %v", got, want)
		}
	})

	t.Run("defaults author to Unknown and taxonomy to empty when missing", func(t *testing.T) {
		manifest := `{"id":"m","name":"M"}`
		author, taxonomy, description := moduleCatalogFields(manifest)
		if author != "Unknown" {
			t.Errorf("author = %q", author)
		}
		if got, want := taxonomy, []string{}; !reflect.DeepEqual(got, want) {
			t.Errorf("taxonomy = %v, want %v", got, want)
		}
		if description != "" {
			t.Errorf("description = %q", description)
		}
	})

	t.Run("treats blank values as missing for author and category", func(t *testing.T) {
		manifest := `{"author":"  ","category":"","description":"  trimmed  "}`
		author, taxonomy, description := moduleCatalogFields(manifest)
		if author != "Unknown" {
			t.Errorf("author not defaulted: author=%q", author)
		}
		if got, want := taxonomy, []string{}; !reflect.DeepEqual(got, want) {
			t.Errorf("blank category should not populate taxonomy: got %v, want %v", got, want)
		}
		if description != "trimmed" {
			t.Errorf("description = %q", description)
		}
	})

	t.Run("falls back to defaults on empty or malformed input", func(t *testing.T) {
		for _, raw := range []string{"", "not-json", "{"} {
			author, taxonomy, description := moduleCatalogFields(raw)
			if author != "Unknown" || len(taxonomy) != 0 || description != "" {
				t.Errorf("input %q: got (%q, %v, %q)", raw, author, taxonomy, description)
			}
		}
	})
}
