package main

import (
	"encoding/json"
	"fmt"

	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// NewBarkloaderAction is the engine handler registered as `function`.
// A workflow step with `type: "action"` and `action: "function"` reads
// its `function` field (a canonical function id, e.g.
// `twitch_platform:function:play_alert`) and the rest of `parameters`,
// then invokes the named function in the barkloader sandbox.
//
// Step shape consumed:
//
//	{
//	  "type": "action",
//	  "action": "function",
//	  "function": "{moduleId}:function:{fn_id}",
//	  "parameters": { "alertType": "subscription", ... }
//	}
//
// `function` is injected into params by `NewActionTask` (see
// `tasks/action.go`) from the top-level `TaskDefinition.Function`.
// Author-supplied step parameters arrive in the same map and are
// passed to the sandboxed function as a single object argument.
//
// The canonical id is forwarded to barkloader as-is; barkloader's
// `ModuleRegistry::get_function` parses the same format. No engine-side
// conversion is needed.
func NewBarkloaderAction() tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		canonicalID, ok := params["function"].(string)
		if !ok || canonicalID == "" {
			return nil, fmt.Errorf("function parameter (canonical function id) is required")
		}

		// Build the args object from author-supplied params, dropping
		// the engine-injected `function` key. The sandboxed function
		// receives a single object containing every other param.
		argsObj := make(map[string]any, len(params))
		for k, v := range params {
			if k == "function" {
				continue
			}
			argsObj[k] = v
		}

		client := ctx.Services.Barkloader()
		if client == nil {
			return nil, fmt.Errorf("barkloader service not available")
		}

		// Ensure we're using the barkloader.Client type
		_ = (*barkloader.Client)(nil)

		result, err := client.Invoke(canonicalID, []any{argsObj})
		if err != nil {
			return nil, fmt.Errorf("failed to invoke barkloader function %s: %w", canonicalID, err)
		}
		return result, nil
	}
}

// NewAlertAction is the engine handler registered as `alert`. A workflow
// step with `type: "action"` and `action: "alert"` publishes an envelope
// to the NATS subject `ui.notify.alert`. Subscribers (UI / overlays)
// consume that subject and render the alert via a widget; the handler
// itself is fire-and-forget and returns immediately.
//
// The published envelope is `{ parameters, event }`:
//   - `parameters`: the workflow author's params verbatim (text, mediaUrl,
//     audioUrl, duration, options, custom keys). Convention: include a
//     `widget` key naming a streamware widget that knows how to render
//     this alert. Substitution / pluralization / formatting happen inside
//     the widget at render time.
//   - `event`: the originating CloudEvent that triggered the workflow,
//     attached so widgets can read raw event fields directly without the
//     author having to manually map every field into parameters. `null`
//     for non-event triggers (manual, scheduled, chat command).
//
// The action carries no schema validation today — the contract is "the
// widget reads what it needs from parameters + event."
//
// Canonical id of the corresponding action declaration row:
// `builtin:action:alert` (registered by the workflow service on startup;
// see `registerBuiltinActions` in `app.go`).
func NewAlertAction() tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		bus := ctx.Services.MessageBus()
		if bus == nil {
			return nil, fmt.Errorf("message bus not available")
		}
		payload, err := buildAlertEnvelope(ctx.ApplicationID, params, ctx.TriggerEvent)
		if err != nil {
			return nil, err
		}
		if err := bus.Publish("ui.notify.alert", payload); err != nil {
			return nil, fmt.Errorf("publish ui.notify.alert: %w", err)
		}
		return map[string]any{"published": true}, nil
	}
}

// buildAlertEnvelope constructs the ui.notify.alert payload. Pure for
// testing — given the same args it always produces the same JSON bytes
// (modulo Go's map iteration order, which json.Marshal sorts).
//
// `applicationId` is stamped on the envelope so subscribers can
// attribute the dispatch without falling back to a singleton lookup.
// Empty string is omitted from the JSON so envelopes from non-workflow
// publishers (manual / debug / ad-hoc) round-trip cleanly without
// stamping a misleading id.
func buildAlertEnvelope(applicationID string, params map[string]any, event *types.Event) ([]byte, error) {
	envelope := map[string]any{
		"parameters": params,
		"event":      event,
	}
	if applicationID != "" {
		envelope["applicationId"] = applicationID
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		return nil, fmt.Errorf("marshal alert envelope: %w", err)
	}
	return payload, nil
}
