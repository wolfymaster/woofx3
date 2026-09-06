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
		CreatedByRef:  "twitch",
	}}

	data := buildTriggerRegisteredData("twitch", "twitch:1.0.0:abcdef1", "Twitch", "1.0.0", triggers)

	if got := data["module_prefix"]; got != "twitch" {
		t.Errorf("module_prefix = %v", got)
	}
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
	if row["created_by_ref"] != "twitch" {
		t.Errorf("created_by_ref = %v", row["created_by_ref"])
	}
	if row["allow_variants"] != false {
		t.Errorf("allow_variants = %v", row["allow_variants"])
	}
}

func TestBuildTriggerRegisteredDataEmpty(t *testing.T) {
	data := buildTriggerRegisteredData("p", "k", "n", "v", nil)
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
		CreatedByRef:  "twitch",
	}}

	data := buildActionRegisteredData("twitch", "twitch:1.0.0:abcdef1", "Twitch", "1.0.0", actions)

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
	data := buildActionRegisteredData("p", "k", "n", "v", actions)
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

// Every module event must carry both identities: the version-free
// `module_prefix` that rows are keyed on, and the composite `module_key`
// naming the exact installed version. A consumer that indexes modules by
// what `module.installed` gave it (the composite key) could not otherwise
// match a definition event addressed only by the bare id.
func TestModuleEventsCarryBothIdentifiers(t *testing.T) {
	const (
		prefix = "twitch_platform"
		key    = "twitch_platform:1.0.0:075ab4d"
	)
	trigger := &models.Trigger{ID: uuid.New(), Name: "follow", CreatedByType: "MODULE", CreatedByRef: prefix, ManifestID: "follow.channel.twitch"}
	action := &models.Action{ID: uuid.New(), Name: "send", CreatedByType: "MODULE", CreatedByRef: prefix, ManifestID: "twitch.chat.send"}
	widget := &models.Widget{ID: uuid.New(), Name: "alerts", CreatedByType: "MODULE", CreatedByRef: prefix, ManifestID: "alertBox"}
	asset := &models.Asset{ID: uuid.New(), Name: "bell", CreatedByType: "MODULE", CreatedByRef: prefix, ManifestID: "bell"}
	task := &models.BackgroundTask{ID: uuid.New(), Name: "poll", CreatedByRef: prefix, ManifestID: "poll"}
	fn := models.ModuleFunction{ID: uuid.New(), Name: "sendChatMessage", ManifestID: "sendChatMessage"}

	cases := map[string]map[string]any{
		"trigger.registered":           buildTriggerRegisteredData(prefix, key, "Twitch Platform", "1.0.0", []*models.Trigger{trigger}),
		"trigger.deregistered":         buildTriggerDeregisteredData(prefix, key, []*models.Trigger{trigger}),
		"action.registered":            buildActionRegisteredData(prefix, key, "Twitch Platform", "1.0.0", []*models.Action{action}),
		"action.deregistered":          buildActionDeregisteredData(prefix, key, []*models.Action{action}),
		"widget.registered":            buildWidgetRegisteredData(prefix, key, "Twitch Platform", "1.0.0", []*models.Widget{widget}),
		"widget.deregistered":          buildWidgetDeregisteredData(prefix, key, []*models.Widget{widget}),
		"asset.registered":             buildAssetRegisteredData(prefix, key, "Twitch Platform", "1.0.0", []*models.Asset{asset}),
		"asset.deregistered":           buildAssetDeregisteredData(prefix, key, []*models.Asset{asset}),
		"background_task.registered":   buildBackgroundTaskRegisteredData(prefix, key, "Twitch Platform", "1.0.0", []*models.BackgroundTask{task}),
		"background_task.deregistered": buildBackgroundTaskDeregisteredData(prefix, key, []*models.BackgroundTask{task}),
		"function.registered":          buildFunctionRegisteredData(uuid.New().String(), prefix, key, "Twitch Platform", "1.0.0", []models.ModuleFunction{fn}),
		"function.deregistered":        buildFunctionDeregisteredData(prefix, key, "Twitch Platform", "1.0.0", []models.ModuleFunction{fn}),
	}

	for name, data := range cases {
		if got := data["module_prefix"]; got != prefix {
			t.Errorf("%s: module_prefix = %v, want %q", name, got, prefix)
		}
		if got := data["module_key"]; got != key {
			t.Errorf("%s: module_key = %v, want %q", name, got, key)
		}
	}
}

// References must survive a module upgrade, so a trigger / action / widget /
// asset projects under a version-free key. A function's source can change
// without its name changing, so it stays version-pinned.
func TestProjectionKeyVersionPinningIsFunctionsOnly(t *testing.T) {
	const (
		prefix = "twitch_platform"
		key    = "twitch_platform:1.0.0:075ab4d"
	)

	trigger := &models.Trigger{ID: uuid.New(), CreatedByType: "MODULE", CreatedByRef: prefix, ManifestID: "follow.channel.twitch"}
	data := buildTriggerRegisteredData(prefix, key, "Twitch Platform", "1.0.0", []*models.Trigger{trigger})
	row := data["triggers"].([]map[string]any)[0]
	if got, want := row["projection_key"], "twitch_platform:trigger:follow.channel.twitch"; got != want {
		t.Errorf("trigger projection_key = %v, want %q (version-free so upgrades keep references resolving)", got, want)
	}

	fn := models.ModuleFunction{ID: uuid.New(), ManifestID: "sendChatMessage"}
	fnData := buildFunctionRegisteredData(uuid.New().String(), prefix, key, "Twitch Platform", "1.0.0", []models.ModuleFunction{fn})
	fnRow := fnData["functions"].([]map[string]any)[0]
	if got, want := fnRow["projection_key"], "twitch_platform:1.0.0:075ab4d:function:sendChatMessage"; got != want {
		t.Errorf("function projection_key = %v, want %q (version-pinned: source changes under a stable name)", got, want)
	}
	if got, want := fnRow["canonical_id"], "twitch_platform:function:sendChatMessage"; got != want {
		t.Errorf("function canonical_id = %v, want %q (never version-pinned)", got, want)
	}
}
