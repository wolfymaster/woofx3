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
