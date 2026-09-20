package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
	dbv1 "github.com/wolfymaster/woofx3/clients/db"
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

		eventPayload := buildModuleInvokeEvent(ctx.TriggerEvent, argsObj)
		if ctx.Logger != nil {
			ctx.Logger.Info(
				"Invoking module function",
				"task", ctx.TaskID,
				"function", canonicalID,
				"parameters", argsObj,
			)
		}
		result, err := client.Invoke(canonicalID, eventPayload)
		if err != nil {
			if ctx.Logger != nil {
				ctx.Logger.Error(
					"Module function invoke failed",
					"task", ctx.TaskID,
					"function", canonicalID,
					"error", err,
				)
			}
			return nil, fmt.Errorf("failed to invoke barkloader function %s: %w", canonicalID, err)
		}
		if len(result) == 0 {
			if ctx.Logger != nil {
				ctx.Logger.Warn(
					"Module function returned empty result map",
					"task", ctx.TaskID,
					"function", canonicalID,
					"event", eventPayload,
				)
			}
			return nil, fmt.Errorf("module function %s returned empty result", canonicalID)
		}
		if ctx.Logger != nil {
			ctx.Logger.Info(
				"Module function returned",
				"task", ctx.TaskID,
				"function", canonicalID,
				"result", result,
			)
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
// The published envelope is `{ id, parameters, event }`:
//   - `parameters`: the step's params with expressions resolved: `target`,
//     the name of the alert widgets to play on, and `layout`, the widgets
//     the alert shows.
//   - `event`: the originating CloudEvent that triggered the workflow,
//     attached so layout widgets can read raw event fields. `null` for
//     non-event triggers (manual, scheduled, chat command).
//
// The step fails rather than publishing when `layout` is structurally
// unusable (see validateAlertParams). Everything else about `parameters` is
// forwarded unchecked: the scene manager holds the widget catalog and decides
// what it will actually frame.
//
// Canonical id of the corresponding action declaration row:
// `woofx3:action:alert`, declared as a `native` action by the bundled
// woofx3 module and installed by barkloader. The engine implements the
// handler; the manifest declares it.
func NewAlertAction() tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		bus := ctx.Services.MessageBus()
		if bus == nil {
			return nil, fmt.Errorf("message bus not available")
		}
		if err := validateAlertParams(params); err != nil {
			return nil, fmt.Errorf("alert cannot be published: %w", err)
		}
		payload, envelopeID, err := buildAlertEnvelope(ctx.ApplicationID, params, ctx.TriggerEvent)
		if err != nil {
			return nil, err
		}
		recordAlertDispatch(ctx, envelopeID, payload)
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
func buildAlertEnvelope(applicationID string, params map[string]any, event *types.Event) ([]byte, string, error) {
	// Generate a stable envelope id at publish time so every consumer
	// (api alert log, streamware broadcaster, overlay widget) keys on
	// the same value. Honors a caller-supplied `parameters.id` so
	// authors can pin an id for tests / replays. The envelope-level
	// `id` field is the canonical handle used by the widget-completion
	// ack channel (`ui.widget.status` reports key on it).
	envelopeID := ""
	if v, ok := params["id"].(string); ok && v != "" {
		envelopeID = v
	} else {
		envelopeID = uuid.NewString()
	}
	envelope := map[string]any{
		"id":         envelopeID,
		"parameters": params,
		"event":      event,
	}
	if applicationID != "" {
		envelope["applicationId"] = applicationID
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		return nil, "", fmt.Errorf("marshal alert envelope: %w", err)
	}
	return payload, envelopeID, nil
}

// recordAlertDispatch writes the alert to the engine's alert log.
//
// Before the publish, not after: a consumer that refuses the alert reports
// against this row keyed on the envelope id, and a row that does not exist yet
// cannot be updated.
//
// Best-effort, and deliberately so. An alert nobody logged is worth more than
// an alert nobody saw, so a failure here is recorded and the dispatch
// continues — which means every consumer downstream has to tolerate a missing
// row rather than assume one.
func recordAlertDispatch(ctx tasks.ActionContext[AppServices], envelopeID string, payload []byte) {
	client := ctx.Services.AlertLog()
	if client == nil {
		return
	}

	sourceEventID := ""
	if ctx.TriggerEvent != nil {
		sourceEventID = ctx.TriggerEvent.ID
	}

	_, err := client.CreateAlert(context.Background(), &dbv1.CreateAlertRequest{
		ApplicationId: ctx.ApplicationID,
		Payload:       string(payload),
		// Named for the workflow, but documented as the execution that fired
		// the alert — and the run is the value that can answer "what produced
		// this", which the definition id cannot.
		WorkflowId:    ctx.ExecutionID,
		SourceEventId: sourceEventID,
		EnvelopeId:    envelopeID,
	})
	if err != nil && ctx.Logger != nil {
		ctx.Logger.Warn("alert dispatch not recorded", "envelopeId", envelopeID, "error", err)
	}
}

// validateAlertParams rejects an alert whose `layout` cannot be framed,
// before anything is published.
//
// The scene manager validates layouts properly — it is the side holding the
// widget catalog — but it does so after this step has already reported
// success, and its refusal reaches nobody but a log file. These four checks
// need no catalog, so making them here turns the common authoring mistake (a
// step saved against a module that has since changed) into a failed run with a
// reason on it.
//
// Structural only, deliberately. Whether a widget exists, or may play in an
// alert, stays with the scene manager.
func validateAlertParams(params map[string]any) error {
	layout, ok := params["layout"].(map[string]any)
	if !ok {
		return fmt.Errorf("layout must be an object, got %s", describeParam(params["layout"]))
	}
	if !isPositiveNumber(layout["width"]) {
		return fmt.Errorf("layout.width must be a positive number, got %s", describeParam(layout["width"]))
	}
	if !isPositiveNumber(layout["height"]) {
		return fmt.Errorf("layout.height must be a positive number, got %s", describeParam(layout["height"]))
	}
	if _, ok := layout["widgets"].([]any); !ok {
		return fmt.Errorf("layout.widgets must be an array, got %s", describeParam(layout["widgets"]))
	}
	return nil
}

// describeParam names what arrived, so a message tells an absent field apart
// from a mistyped one. Mirrors `describe` in the scene manager's
// alert-layout.ts, so an author sees the same vocabulary wherever the alert was
// refused. A JSON null and an absent key are indistinguishable once unmarshalled
// into map[string]any, and both read as "nothing".
func describeParam(value any) string {
	switch v := value.(type) {
	case nil:
		return "nothing"
	case string:
		return fmt.Sprintf("the string %q", v)
	case bool:
		return fmt.Sprintf("bool %v", v)
	case float64:
		return fmt.Sprintf("number %v", v)
	case int:
		return fmt.Sprintf("number %d", v)
	case []any:
		return "an array"
	case map[string]any:
		return "an object"
	default:
		return fmt.Sprintf("%T", value)
	}
}

// isPositiveNumber accepts the shapes a step parameter can arrive in. Steps are
// persisted as JSON, so a dimension is a float64 in practice; the integer cases
// are for definitions built in Go.
//
// No finiteness check: JSON cannot carry Inf or NaN, so neither can reach here.
func isPositiveNumber(value any) bool {
	switch v := value.(type) {
	case float64:
		return v > 0
	case int:
		return v > 0
	case int64:
		return v > 0
	default:
		return false
	}
}

// buildModuleInvokeEvent shapes the sandbox `ctx.event` object module functions
// read. Action schema fields live under `parameters` (see counter module);
// trigger CloudEvent fields are merged at the top level when present.
func buildModuleInvokeEvent(trigger *types.Event, params map[string]any) map[string]interface{} {
	event := map[string]interface{}{
		"parameters": params,
	}
	if trigger == nil {
		return event
	}
	event["id"] = trigger.ID
	event["type"] = trigger.Type
	event["source"] = trigger.Source
	event["time"] = trigger.Time
	if trigger.Data != nil {
		event["data"] = trigger.Data
	}
	return event
}
