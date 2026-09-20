// Package commandactions holds the command type/type_value -> actions rewrite
// shared by the postgres and sqlite migrations.
package commandactions

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"gorm.io/gorm"
)

// LegacyCommand is one pre-actions command row.
type LegacyCommand struct {
	ID        string
	Type      string
	TypeValue string
}

// Convert rewrites every command row's type/type_value pair into the action
// list that does what it used to do, and reports how many it rewrote.
//
// `table` is dialect-qualified ("public.commands" or "commands") because the
// two schemas name it differently; everything else about the rewrite is the
// same on both.
func Convert(tx *gorm.DB, table string) (int, error) {
	var rows []LegacyCommand
	if err := tx.Raw(fmt.Sprintf(`SELECT id, type, type_value FROM %s`, table)).Scan(&rows).Error; err != nil {
		return 0, err
	}

	for _, row := range rows {
		actions, err := ActionsFor(row.Type, row.TypeValue)
		if err != nil {
			return 0, fmt.Errorf("command %s: %w", row.ID, err)
		}
		if err := tx.Exec(
			fmt.Sprintf(`UPDATE %s SET actions = ? WHERE id = ?`, table), actions, row.ID,
		).Error; err != nil {
			return 0, err
		}
	}
	return len(rows), nil
}

// ActionsFor renders one pre-actions command as the action list that does what
// it used to do: a text response becomes a single `chat.reply`, a function
// becomes a single `function` step naming the same function, and a command with
// nothing to say becomes an empty list -- which still announces itself on
// `chat.command.<slug>`, as a trigger-only command always has.
//
// One exception: a module command declaring a workflow was stored as a
// "function" holding a *workflow* canonical id, which the runtime then invoked
// as if it were a function (barkloader's ManifestCommand::register). Those
// become a workflow step, which is what they always meant.
func ActionsFor(commandType, typeValue string) (string, error) {
	value := strings.TrimSpace(typeValue)
	actions := []map[string]any{}

	switch {
	case value == "":
	case commandType == "function" && strings.Contains(value, ":workflow:"):
		actions = append(actions, map[string]any{
			"id":   "action-1",
			"type": "workflow",
			"workflow": map[string]any{
				"workflowId":          value,
				"waitUntilCompletion": false,
			},
		})
	case commandType == "function":
		actions = append(actions, map[string]any{
			"id":       "action-1",
			"action":   "function",
			"function": value,
		})
	default:
		actions = append(actions, map[string]any{
			"id":         "action-1",
			"action":     "chat.reply",
			"parameters": map[string]any{"message": TemplateToExpressions(value)},
		})
	}

	encoded, err := json.Marshal(actions)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

var templatePattern = regexp.MustCompile(`\{([A-Za-z0-9_.]+)\}`)

// fixedNames are what a text response could refer to besides its own declared
// arguments -- the resolver context woofwoofwoof built for it. Everything else
// in braces was an argument_pattern capture, which now arrives under
// `variables` on the trigger event.
var fixedNames = map[string]string{
	"user":       "trigger.data.chatter",
	"args":       "trigger.data.args",
	"argsText":   "trigger.data.text",
	"rawMessage": "trigger.data.rawMessage",
	"command":    "trigger.data.command",
}

// TemplateToExpressions rewrites a response's `{name}` templates into the
// `${...}` expressions the workflow resolver evaluates, so a migrated command
// still greets the right person.
func TemplateToExpressions(text string) string {
	return templatePattern.ReplaceAllStringFunc(text, func(match string) string {
		name := match[1 : len(match)-1]
		if path, ok := fixedNames[name]; ok {
			return "${" + path + "}"
		}
		return "${trigger.data.variables." + name + "}"
	})
}
