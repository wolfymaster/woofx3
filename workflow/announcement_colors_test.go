package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/wolfymaster/woofx3/common/platformgateway"
)

// The manifest and the docs cannot import the generated colours, so these
// tests hold them to the contract: a colour added there fails here until the
// `twitchColor` select and the docs offer it too.

// repoRoot is the repository root, relative to this package.
const repoRoot = ".."

// manifestField is a step field as far as these tests read it. DefaultValue
// is any because other fields default to booleans and numbers.
type manifestField struct {
	ID           string `json:"id"`
	DefaultValue any    `json:"defaultValue"`
	Min          *int   `json:"min"`
	Max          *int   `json:"max"`
	Options      []struct {
		Value string `json:"value"`
	} `json:"options"`
}

type manifestAction struct {
	ID     string          `json:"id"`
	Schema []manifestField `json:"schema"`
}

func TestTwitchColorSelectOffersTheContractColours(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, "modules", "woofx3", "manifest.json"))
	if err != nil {
		t.Fatalf("reading the woofx3 manifest: %v", err)
	}
	var manifest struct {
		Actions []manifestAction `json:"actions"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decoding the woofx3 manifest: %v", err)
	}
	var field *manifestField
	for _, action := range manifest.Actions {
		if action.ID != string(platformgateway.ActionChatAnnounce) {
			continue
		}
		for i := range action.Schema {
			if action.Schema[i].ID == "twitchColor" {
				field = &action.Schema[i]
			}
		}
	}
	if field == nil {
		t.Fatal("the woofx3 manifest has no twitchColor field on chat.announce")
	}
	offered := make([]string, len(field.Options))
	for i, option := range field.Options {
		offered[i] = option.Value
	}
	if want := announcementColorNames(); !reflect.DeepEqual(offered, want) {
		t.Errorf("twitchColor offers %v, want the contract's %v", offered, want)
	}
	defaultColor, ok := field.DefaultValue.(string)
	if !ok || !platformgateway.TwitchAnnouncementColor(defaultColor).Valid() {
		t.Errorf("twitchColor defaults to %v, which is not one of the contract's colours", field.DefaultValue)
	}
}

func TestDocsListTheContractColours(t *testing.T) {
	colors := announcementColorNames()
	quoted := make([]string, len(colors))
	for i, color := range colors {
		quoted[i] = "`" + color + "`"
	}
	list := strings.Join(quoted[:len(quoted)-1], ", ") + " or " + quoted[len(quoted)-1]

	for _, page := range []string{
		filepath.Join("docs", "workflow", "tasks.md"),
		filepath.Join("docs", "services", "connectors.md"),
		filepath.Join("docs", "services", "platform-gateway.md"),
	} {
		t.Run(page, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(repoRoot, page))
			if err != nil {
				t.Fatalf("reading %s: %v", page, err)
			}
			if !strings.Contains(string(raw), list) {
				t.Errorf("%s does not list the announcement colours as %q", page, list)
			}
		})
	}
}

func loadManifestAction(t *testing.T, actionID string) manifestAction {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRoot, "modules", "woofx3", "manifest.json"))
	if err != nil {
		t.Fatalf("reading the woofx3 manifest: %v", err)
	}
	var manifest struct {
		Actions []manifestAction `json:"actions"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decoding the woofx3 manifest: %v", err)
	}
	for _, action := range manifest.Actions {
		if action.ID == actionID {
			return action
		}
	}
	t.Fatalf("the woofx3 manifest has no %s action", actionID)
	return manifestAction{}
}

func manifestFieldOf(t *testing.T, action manifestAction, fieldID string) manifestField {
	t.Helper()
	for _, field := range action.Schema {
		if field.ID == fieldID {
			return field
		}
	}
	t.Fatalf("the %s action has no %s field", action.ID, fieldID)
	return manifestField{}
}

func TestChatPinDurationFieldMatchesTheContractBounds(t *testing.T) {
	field := manifestFieldOf(t, loadManifestAction(t, string(platformgateway.ActionChatPin)), "durationSeconds")
	if field.Min == nil || *field.Min != platformgateway.ChatPinDurationSecondsMin {
		t.Errorf("durationSeconds min is %v, want the contract's %d", field.Min, platformgateway.ChatPinDurationSecondsMin)
	}
	if field.Max == nil || *field.Max != platformgateway.ChatPinDurationSecondsMax {
		t.Errorf("durationSeconds max is %v, want the contract's %d", field.Max, platformgateway.ChatPinDurationSecondsMax)
	}
}

func TestChatPlatformFieldPinsTheOriginAndAllOptions(t *testing.T) {
	for _, actionID := range []string{"chat.reply", string(platformgateway.ActionChatAnnounce), string(platformgateway.ActionChatPin)} {
		t.Run(actionID, func(t *testing.T) {
			field := manifestFieldOf(t, loadManifestAction(t, actionID), "platform")
			offered := make([]string, len(field.Options))
			for i, option := range field.Options {
				offered[i] = option.Value
			}
			for _, want := range []string{chatPlatformOrigin, chatPlatformAll} {
				if !slices.Contains(offered, want) {
					t.Errorf("the platform field offers %v, which lacks %q", offered, want)
				}
			}
			if field.DefaultValue != chatPlatformOrigin {
				t.Errorf("the platform field defaults to %v, want %q", field.DefaultValue, chatPlatformOrigin)
			}
		})
	}
}
