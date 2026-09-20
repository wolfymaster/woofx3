package commandactions

import (
	"encoding/json"
	"testing"
)

func decode(t *testing.T, actions string) []map[string]any {
	t.Helper()
	var decoded []map[string]any
	if err := json.Unmarshal([]byte(actions), &decoded); err != nil {
		t.Fatalf("actions are not JSON: %v (%s)", err, actions)
	}
	return decoded
}

func TestActionsFor(t *testing.T) {
	t.Run("a text response becomes one chat reply", func(t *testing.T) {
		actions, err := ActionsFor("text", "hi there")
		if err != nil {
			t.Fatalf("ActionsFor: %v", err)
		}
		decoded := decode(t, actions)
		if len(decoded) != 1 {
			t.Fatalf("got %d actions, want 1", len(decoded))
		}
		if decoded[0]["action"] != "chat.reply" {
			t.Errorf("action = %v, want chat.reply", decoded[0]["action"])
		}
		parameters := decoded[0]["parameters"].(map[string]any)
		if parameters["message"] != "hi there" {
			t.Errorf("message = %v", parameters["message"])
		}
	})

	t.Run("a function becomes one function step naming it", func(t *testing.T) {
		decoded := decode(t, mustActions(t, "function", "twitch_platform/sendChatMessage"))
		if decoded[0]["action"] != "function" {
			t.Errorf("action = %v, want function", decoded[0]["action"])
		}
		if decoded[0]["function"] != "twitch_platform/sendChatMessage" {
			t.Errorf("function = %v", decoded[0]["function"])
		}
	})

	t.Run("a function holding a workflow id becomes a workflow step", func(t *testing.T) {
		// What barkloader wrote for a manifest command declaring a workflow.
		decoded := decode(t, mustActions(t, "function", "agent_probe:workflow:probe_follow_workflow"))
		if decoded[0]["type"] != "workflow" {
			t.Errorf("type = %v, want workflow", decoded[0]["type"])
		}
		workflow := decoded[0]["workflow"].(map[string]any)
		if workflow["workflowId"] != "agent_probe:workflow:probe_follow_workflow" {
			t.Errorf("workflowId = %v", workflow["workflowId"])
		}
		if decoded[0]["action"] != nil {
			t.Errorf("workflow step names an action handler: %v", decoded[0]["action"])
		}
	})

	t.Run("a command with nothing to say runs nothing", func(t *testing.T) {
		for _, commandType := range []string{"text", "function"} {
			if got := mustActions(t, commandType, "   "); got != "[]" {
				t.Errorf("%s with no value = %s, want []", commandType, got)
			}
		}
	})
}

func TestTemplateToExpressions(t *testing.T) {
	cases := map[string]string{
		"hi {user}":                       "hi ${trigger.data.chatter}",
		"{user} asked for {songTitle}":    "${trigger.data.chatter} asked for ${trigger.data.variables.songTitle}",
		"you said {argsText}":             "you said ${trigger.data.text}",
		"echo {rawMessage} for {command}": "echo ${trigger.data.rawMessage} for ${trigger.data.command}",
		"no placeholders here":            "no placeholders here",
		// Not a placeholder: nothing in the old resolver matched an empty name.
		"{} stays": "{} stays",
	}
	for input, want := range cases {
		if got := TemplateToExpressions(input); got != want {
			t.Errorf("TemplateToExpressions(%q) = %q, want %q", input, got, want)
		}
	}
}

func mustActions(t *testing.T, commandType, typeValue string) string {
	t.Helper()
	actions, err := ActionsFor(commandType, typeValue)
	if err != nil {
		t.Fatalf("ActionsFor: %v", err)
	}
	return actions
}
