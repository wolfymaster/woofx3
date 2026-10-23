package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/platformgateway"
	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// NewChatReplyAction is the engine handler registered as `chat.reply`, the
// "Send chat message" action.
//
// Sends one message through the platform gateway in connectors, to the
// platforms the step's `platform` parameter names (see resolveChatTarget), and
// returns what happened on each. The step fails unless the gateway's reply is
// ok, with a sentence per platform saying why.
//
// Native rather than a module function so that replying in chat needs no
// module installed: it is what a chat command has always done, and what makes
// "a command runs actions" lose nothing next to the response text it replaces.
//
// Canonical id of the corresponding action declaration row:
// `woofx3:action:chat.reply`.
func NewChatReplyAction() tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		message, target, err := chatStepTarget(ctx, params)
		if err != nil {
			return nil, err
		}
		reply, err := sendThroughGateway(ctx, platformgateway.ActionChatSend, target, platformgateway.ChatSendPayload{Message: message}, nil)
		if err != nil {
			return nil, err
		}
		return chatStepOutput(message, reply)
	}
}

// NewChatAnnounceAction is the engine handler registered as `chat.announce`,
// the "Send announcement" action: a highlighted chat line, where the platform
// has one. The optional `twitchColor` reaches the gateway as Twitch's options
// and is left out when unset, so Twitch uses the channel's accent colour.
//
// Canonical id of the corresponding action declaration row:
// `woofx3:action:chat.announce`.
func NewChatAnnounceAction() tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		message, target, err := chatStepTarget(ctx, params)
		if err != nil {
			return nil, err
		}
		color, err := announcementColorParam(params)
		if err != nil {
			return nil, err
		}
		options, err := announceOptions(color)
		if err != nil {
			return nil, err
		}
		reply, err := sendThroughGateway(ctx, platformgateway.ActionChatAnnounce, target, platformgateway.ChatAnnouncePayload{Message: message}, options)
		if err != nil {
			return nil, err
		}
		return chatStepOutput(message, reply)
	}
}

// NewChatPinAction is the engine handler registered as `chat.pin`, the "Pin
// message" action: posts a message and pins it. Only the send-and-pin form of
// the gateway action is offered; pinning an existing line needs a message id a
// step has no way to name.
//
// Canonical id of the corresponding action declaration row:
// `woofx3:action:chat.pin`.
func NewChatPinAction() tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		message, target, err := chatStepTarget(ctx, params)
		if err != nil {
			return nil, err
		}
		duration, err := pinDurationParam(params)
		if err != nil {
			return nil, err
		}
		reply, err := sendThroughGateway(ctx, platformgateway.ActionChatPin, target, platformgateway.ChatPinNewPayload{Message: message, DurationSeconds: duration}, nil)
		if err != nil {
			return nil, err
		}
		return chatStepOutput(message, reply)
	}
}

// chatStepTarget reads the parameters every chat step shares, `message` and
// `platform`, and resolves where the step sends.
func chatStepTarget(ctx tasks.ActionContext[AppServices], params map[string]any) (string, platformgateway.Target, error) {
	message, err := chatMessageParam(params)
	if err != nil {
		return "", platformgateway.Target{}, err
	}
	platform, err := chatPlatformParam(params)
	if err != nil {
		return "", platformgateway.Target{}, err
	}
	target, err := resolveChatTarget(platform, ctx.TriggerEvent)
	if err != nil {
		return "", platformgateway.Target{}, err
	}
	return message, target, nil
}

func chatStepOutput(message string, reply platformgateway.GatewayReply) (map[string]any, error) {
	results, err := gatewayResultsOutput(reply)
	if err != nil {
		return nil, err
	}
	return map[string]any{"message": message, "ok": reply.OK, "results": results}, nil
}

// Values of a chat step's `platform` parameter besides a platform id. Must
// match the pinned options of the platform field in
// modules/woofx3/manifest.json.
const (
	// chatPlatformOrigin answers on the platform the trigger came from, or on
	// every platform when the trigger came from none (a timer, the
	// dashboard). An empty parameter means the same, so steps saved before
	// the parameter existed keep answering where they were asked.
	chatPlatformOrigin = "origin"
	// chatPlatformAll sends to every platform that is linked and enabled.
	chatPlatformAll = "all"
)

// chatPlatformIDPattern is the shape of a platform id, checked when a workflow
// is registered. Deliberately not the gateway's own list: a stored workflow
// naming a platform this engine has no adapter for still loads, and its step
// says so when it runs.
var chatPlatformIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

// validateChatPlatformParam is the registration check of a chat step's
// `platform`: empty, origin, all, anything shaped like a platform id, or an
// expression resolved when the step runs.
func validateChatPlatformParam(params map[string]any) error {
	raw, present := params["platform"]
	if !present || raw == nil {
		return nil
	}
	platform, ok := raw.(string)
	if !ok {
		return fmt.Errorf("platform must be text, got %s", describeParam(raw))
	}
	if expression.HasExpression(platform) {
		return nil
	}
	if platform == "" || platform == chatPlatformOrigin || platform == chatPlatformAll || chatPlatformIDPattern.MatchString(platform) {
		return nil
	}
	return fmt.Errorf("platform must be %q, %q or a platform id, got %s", chatPlatformOrigin, chatPlatformAll, describeParam(raw))
}

func chatMessageParam(params map[string]any) (string, error) {
	message, _ := params["message"].(string)
	if message == "" {
		return "", fmt.Errorf("message parameter is required")
	}
	return message, nil
}

// chatPlatformParam is the resolved `platform` parameter, "" when absent.
func chatPlatformParam(params map[string]any) (string, error) {
	raw, present := params["platform"]
	if !present || raw == nil {
		return "", nil
	}
	platform, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("platform must be text, got %s", describeParam(raw))
	}
	return platform, nil
}

// resolveChatTarget turns a resolved `platform` parameter into the gateway
// target it names. Origin answers the trigger event: its platform attribute
// picks the platform, and its `messageId`, when it has one, is the line the
// gateway replies to. A trigger from no platform falls back to all.
func resolveChatTarget(platform string, trigger *types.Event) (platformgateway.Target, error) {
	switch platform {
	case "", chatPlatformOrigin:
		return originTarget(trigger)
	case chatPlatformAll:
		return platformgateway.Target{Kind: platformgateway.TargetAll}, nil
	}
	id := platformgateway.PlatformID(platform)
	if !id.Valid() {
		return platformgateway.Target{}, fmt.Errorf("platform %q is not one this engine can send to; choose %s", platform, chatPlatformChoices())
	}
	return platformgateway.Target{Kind: platformgateway.TargetPlatforms, IDs: []platformgateway.PlatformID{id}}, nil
}

func originTarget(trigger *types.Event) (platformgateway.Target, error) {
	if trigger == nil || trigger.Platform == "" {
		return platformgateway.Target{Kind: platformgateway.TargetAll}, nil
	}
	id := platformgateway.PlatformID(trigger.Platform)
	if !id.Valid() {
		return platformgateway.Target{}, fmt.Errorf("the trigger came from %q, which this engine cannot send to; choose %s", trigger.Platform, chatPlatformChoices())
	}
	origin := &platformgateway.OriginRef{Platform: id}
	if messageID, ok := trigger.Data["messageId"].(string); ok {
		origin.MessageID = messageID
	}
	if channelID, ok := trigger.Data["channelId"].(string); ok {
		origin.ChannelID = channelID
	}
	return platformgateway.Target{Kind: platformgateway.TargetOrigin, Origin: origin}, nil
}

// chatPlatformChoices lists what a chat step's platform may be, for errors.
func chatPlatformChoices() string {
	choices := []string{chatPlatformOrigin, chatPlatformAll}
	for _, id := range platformgateway.PlatformIDs() {
		choices = append(choices, string(id))
	}
	return strings.Join(choices, ", ")
}

// describeChatPlatform names where a resolved `platform` parameter sends, for
// a dry run's sentence, refusing what resolveChatTarget refuses.
func describeChatPlatform(platform string) (string, error) {
	switch platform {
	case "", chatPlatformOrigin:
		return "the chat the trigger came from", nil
	case chatPlatformAll:
		return "every linked platform's chat", nil
	}
	if _, err := resolveChatTarget(platform, nil); err != nil {
		return "", err
	}
	return platform + " chat", nil
}

// Bounds of a pin's duration in seconds, as the chat.pin contract states them
// and Twitch enforces them.
const (
	pinDurationMinSeconds = 30
	pinDurationMaxSeconds = 1200
)

// announcementColors are the colours Twitch's announcements take, the options
// of the `twitchColor` select in modules/woofx3/manifest.json. Must match
// ANNOUNCEMENT_COLORS in connectors/src/adapters/twitch/egress.ts.
func announcementColors() []string {
	return []string{"primary", "blue", "green", "orange", "purple"}
}

// announcementColorParam is the `twitchColor` parameter, "" when unset.
func announcementColorParam(params map[string]any) (string, error) {
	raw, present := params["twitchColor"]
	if !present || raw == nil {
		return "", nil
	}
	color, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("twitchColor must be text, got %s", describeParam(raw))
	}
	if color == "" || slices.Contains(announcementColors(), color) {
		return color, nil
	}
	return "", fmt.Errorf("twitchColor must be one of %s, got %s", strings.Join(announcementColors(), ", "), describeParam(raw))
}

// validateAnnouncementParams is the registration check of a chat.announce
// step: the platform as for any chat step, and a colour that is unset, one of
// Twitch's, or an expression resolved when the step runs.
func validateAnnouncementParams(params map[string]any) error {
	if err := validateChatPlatformParam(params); err != nil {
		return err
	}
	if color, ok := params["twitchColor"].(string); ok && expression.HasExpression(color) {
		return nil
	}
	_, err := announcementColorParam(params)
	return err
}

// announceOptions is the request options for a colour: Twitch's, or none when
// the step sets no colour.
func announceOptions(color string) (map[platformgateway.PlatformID]json.RawMessage, error) {
	if color == "" {
		return nil, nil
	}
	encoded, err := json.Marshal(struct {
		Color string `json:"color"`
	}{Color: color})
	if err != nil {
		return nil, fmt.Errorf("marshal twitch announcement options: %w", err)
	}
	return map[platformgateway.PlatformID]json.RawMessage{platformgateway.PlatformTwitch: encoded}, nil
}

// pinDurationParam is the `durationSeconds` parameter, nil when unset so the
// platform keeps its own default. Text is accepted because a step reading the
// number from another step's output resolves to text.
func pinDurationParam(params map[string]any) (*int, error) {
	var seconds int
	switch v := params["durationSeconds"].(type) {
	case nil:
		return nil, nil
	case int:
		seconds = v
	case int64:
		seconds = int(v)
	case float64:
		if v != math.Trunc(v) {
			return nil, fmt.Errorf("durationSeconds must be a whole number of seconds, got number %v", v)
		}
		if v < pinDurationMinSeconds || v > pinDurationMaxSeconds {
			return nil, fmt.Errorf("durationSeconds must be between %d and %d, got %v", pinDurationMinSeconds, pinDurationMaxSeconds, v)
		}
		seconds = int(v)
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return nil, nil
		}
		parsed, err := strconv.Atoi(trimmed)
		if err != nil {
			return nil, fmt.Errorf("durationSeconds must be a whole number of seconds, got %s", describeParam(v))
		}
		seconds = parsed
	default:
		return nil, fmt.Errorf("durationSeconds must be a number, got %s", describeParam(v))
	}
	if seconds < pinDurationMinSeconds || seconds > pinDurationMaxSeconds {
		return nil, fmt.Errorf("durationSeconds must be between %d and %d, got %d", pinDurationMinSeconds, pinDurationMaxSeconds, seconds)
	}
	return &seconds, nil
}

// validatePinParams is the registration check of a chat.pin step: the platform
// as for any chat step, and a duration that is unset, in bounds, or an
// expression resolved when the step runs.
func validatePinParams(params map[string]any) error {
	if err := validateChatPlatformParam(params); err != nil {
		return err
	}
	if duration, ok := params["durationSeconds"].(string); ok && expression.HasExpression(duration) {
		return nil
	}
	_, err := pinDurationParam(params)
	return err
}

// sendThroughGateway performs one gateway action for the running step and
// returns the reply, or an error unless the reply is ok. Options are the
// per-platform extras of the request, nil for none.
//
// The idempotency key is the run and the step, `ExecutionID:TaskID`. The
// engine never retries a task (each step's attempt is always 1), so the key is
// sent once per step of a run; it makes a duplicate of that one request, should
// one ever reach the gateway, replay the first reply instead of posting twice.
// A replay of the run is a new execution with a new key, so it posts again, as
// asked.
//
// The request carries the run's workflowChain, so a line it posts comes back
// on the platform's chat feed carrying the chain, and the loop guard sees a
// workflow answering its own lines.
func sendThroughGateway(ctx tasks.ActionContext[AppServices], action platformgateway.ActionID, target platformgateway.Target, payload any, options map[platformgateway.PlatformID]json.RawMessage) (platformgateway.GatewayReply, error) {
	if ctx.ExecutionID == "" || ctx.TaskID == "" || ctx.WorkflowID == "" {
		return platformgateway.GatewayReply{}, fmt.Errorf("%s needs the run's execution, task and workflow ids", action)
	}
	gateway := ctx.Services.PlatformGateway()
	if gateway == nil {
		return platformgateway.GatewayReply{}, fmt.Errorf("platform gateway not available")
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return platformgateway.GatewayReply{}, fmt.Errorf("marshal %s payload: %w", action, err)
	}
	reply, err := gateway.Send(ctx.Context, platformgateway.GatewayRequest{
		Action:         action,
		Target:         target,
		Payload:        encoded,
		Options:        options,
		IdempotencyKey: ctx.ExecutionID + ":" + ctx.TaskID,
		RequestedBy:    platformgateway.RequestedBy{Kind: platformgateway.RequesterWorkflow, Ref: ctx.WorkflowID},
		WorkflowChain:  ctx.TriggerEvent.ChainThrough(ctx.WorkflowID),
	})
	if err != nil {
		return platformgateway.GatewayReply{}, err
	}
	if !reply.OK {
		return reply, errors.New(summarizeGatewayReply(action, reply))
	}
	return reply, nil
}

// summarizeGatewayReply says, one platform at a time in a stable order, why a
// reply was not ok.
func summarizeGatewayReply(action platformgateway.ActionID, reply platformgateway.GatewayReply) string {
	if reply.Error != nil {
		return fmt.Sprintf("the platform gateway refused %s (%s): %s", action, reply.Error.Code, reply.Error.Message)
	}
	if len(reply.Results) == 0 {
		return "no platform is linked and enabled to send to"
	}
	ids := make([]string, 0, len(reply.Results))
	for id := range reply.Results {
		ids = append(ids, string(id))
	}
	sort.Strings(ids)
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, id+": "+describeOutcome(reply.Results[platformgateway.PlatformID(id)]))
	}
	return fmt.Sprintf("%s did not go through: %s", action, strings.Join(parts, "; "))
}

func describeOutcome(outcome platformgateway.PlatformOutcome) string {
	switch outcome.Status {
	case platformgateway.OutcomeDelivered:
		return "sent"
	case platformgateway.OutcomeDropped:
		return fmt.Sprintf("held by the platform (%s)", outcome.Reason)
	case platformgateway.OutcomeUnsupported:
		return "cannot do this"
	case platformgateway.OutcomeUnavailable:
		return fmt.Sprintf("unavailable (%s)", outcome.Reason)
	case platformgateway.OutcomeUnconfirmed:
		return outcome.Message
	case platformgateway.OutcomeFailed:
		return fmt.Sprintf("failed (%s): %s", outcome.Code, outcome.Message)
	default:
		return string(outcome.Status)
	}
}

// gatewayResultsOutput is a reply's per-platform outcomes as the step's
// `results` output, keyed by platform id with each outcome in its wire shape,
// so `${steps.<id>.results.twitch.messageId}` reads the same field the
// gateway sent.
func gatewayResultsOutput(reply platformgateway.GatewayReply) (map[string]any, error) {
	encoded, err := json.Marshal(reply.Results)
	if err != nil {
		return nil, fmt.Errorf("marshal gateway results: %w", err)
	}
	results := map[string]any{}
	if err := json.Unmarshal(encoded, &results); err != nil {
		return nil, fmt.Errorf("read gateway results: %w", err)
	}
	return results, nil
}

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
		result, err := client.Invoke(canonicalID, eventPayload, ctx.TriggerEvent.ChainThrough(ctx.WorkflowID))
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
// The published envelope is `{ id, parameters, event, rowId }`:
//   - `parameters`: the step's params with expressions resolved: `target`,
//     the name of the alert widgets to play on, and `layout`, the widgets
//     the alert shows.
//   - `event`: the originating CloudEvent that triggered the workflow,
//     attached so layout widgets can read raw event fields. `null` for
//     non-event triggers (manual, scheduled, chat command).
//   - `rowId`: the alert log row recorded for this play (see withAlertRowID),
//     absent when it could not be recorded.
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
		payload, envelopeID, err := buildAlertEnvelope(params, ctx.TriggerEvent)
		if err != nil {
			return nil, err
		}
		rowID := recordAlertDispatch(ctx, envelopeID, payload)
		message, err := withAlertRowID(payload, rowID)
		if err != nil {
			return nil, err
		}
		if err := bus.Publish("ui.notify.alert", message); err != nil {
			return nil, fmt.Errorf("publish ui.notify.alert: %w", err)
		}
		return map[string]any{"published": true}, nil
	}
}

// buildAlertEnvelope constructs the ui.notify.alert payload. Pure for
// testing — given the same args it always produces the same JSON bytes
// (modulo Go's map iteration order, which json.Marshal sorts).
func buildAlertEnvelope(params map[string]any, event *types.Event) ([]byte, string, error) {
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
	payload, err := json.Marshal(envelope)
	if err != nil {
		return nil, "", fmt.Errorf("marshal alert envelope: %w", err)
	}
	return payload, envelopeID, nil
}

// withAlertRowID adds the alert log row of this play to the envelope as
// `rowId`, or returns the envelope as it is when there is no row.
//
// The scene manager reports the play's lifecycle against this row. The
// envelope id alone cannot name it: a workflow that pins `parameters.id`
// publishes the same envelope id for every play, and plays can overlap. The
// row id is added to the published message only, not to the stored payload,
// which is the envelope a replay plays again as a new row of its own.
func withAlertRowID(payload []byte, rowID string) ([]byte, error) {
	if rowID == "" {
		return payload, nil
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, fmt.Errorf("read alert envelope: %w", err)
	}
	encodedRowID, err := json.Marshal(rowID)
	if err != nil {
		return nil, fmt.Errorf("encode alert row id: %w", err)
	}
	envelope["rowId"] = encodedRowID
	message, err := json.Marshal(envelope)
	if err != nil {
		return nil, fmt.Errorf("marshal alert envelope: %w", err)
	}
	return message, nil
}

// recordAlertDispatch writes the alert to the engine's alert log and returns
// the row's id, or "" when it was not recorded.
//
// Before the publish, not after: a consumer reports the play's lifecycle,
// including a refusal, against this row, and a row that does not exist yet
// cannot be updated.
//
// Best-effort, and deliberately so. An alert nobody logged is worth more than
// an alert nobody saw, so a failure here is recorded and the dispatch
// continues — which means every consumer downstream has to tolerate a missing
// row rather than assume one.
func recordAlertDispatch(ctx tasks.ActionContext[AppServices], envelopeID string, payload []byte) string {
	client := ctx.Services.AlertLog()
	if client == nil {
		return ""
	}

	sourceEventID := ""
	if ctx.TriggerEvent != nil {
		sourceEventID = ctx.TriggerEvent.ID
	}

	resp, err := client.CreateAlert(context.Background(), &dbv1.CreateAlertRequest{
		Payload: string(payload),
		// Named for the workflow, but documented as the execution that fired
		// the alert — and the run is the value that can answer "what produced
		// this", which the definition id cannot.
		WorkflowId:    ctx.ExecutionID,
		SourceEventId: sourceEventID,
		EnvelopeId:    envelopeID,
	})
	if err != nil {
		if ctx.Logger != nil {
			ctx.Logger.Warn("alert dispatch not recorded", "envelopeId", envelopeID, "error", err)
		}
		return ""
	}
	if resp.GetAlert() == nil {
		return ""
	}
	return resp.GetAlert().GetId()
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
//
// A layout is a composition (`{layout, widgets, behaviors}`, the canvas under
// `layout` and widgets keyed by id) or, from steps saved before alerts were
// compositions, a canvas with a list of widgets. Which one is told by the
// `layout` key, as parseAlertLayout in sceneManager/src/scene/alert-layout.ts
// tells them.
func validateAlertParams(params map[string]any) error {
	layout, ok := params["layout"].(map[string]any)
	if !ok {
		return fmt.Errorf("layout must be an object, got %s", describeParam(params["layout"]))
	}
	if _, composed := layout["layout"]; composed {
		return validateAlertComposition(layout)
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

func validateAlertComposition(layout map[string]any) error {
	canvas, ok := layout["layout"].(map[string]any)
	if !ok {
		return fmt.Errorf("layout.layout must be an object, got %s", describeParam(layout["layout"]))
	}
	if !isPositiveNumber(canvas["width"]) {
		return fmt.Errorf("layout.layout.width must be a positive number, got %s", describeParam(canvas["width"]))
	}
	if !isPositiveNumber(canvas["height"]) {
		return fmt.Errorf("layout.layout.height must be a positive number, got %s", describeParam(canvas["height"]))
	}
	if _, ok := layout["widgets"].(map[string]any); !ok {
		return fmt.Errorf("layout.widgets must be an object keyed by id, got %s", describeParam(layout["widgets"]))
	}
	if behaviors, present := layout["behaviors"]; present {
		if _, ok := behaviors.(map[string]any); !ok {
			return fmt.Errorf("layout.behaviors must be an object keyed by id, got %s", describeParam(behaviors))
		}
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

// functionActionSpec skips module code in a dry run. The function is end-user
// code that cannot be trusted to honour a dry-run flag, so it is never told
// about one: it is simply not called.
var functionActionSpec = tasks.ActionSpec{
	SideEffect: true,
	DryRun: func(params map[string]any) (string, error) {
		canonicalID, ok := params["function"].(string)
		if !ok || canonicalID == "" {
			return "", fmt.Errorf("function parameter (canonical function id) is required")
		}
		return fmt.Sprintf("would call module function %s", canonicalID), nil
	},
}

// alertActionSpec checks the alert as the real action would, so a dry run
// fails on the same broken layout a real run would.
var alertActionSpec = tasks.ActionSpec{
	SideEffect: true,
	DryRun: func(params map[string]any) (string, error) {
		if err := validateAlertParams(params); err != nil {
			return "", fmt.Errorf("alert cannot be published: %w", err)
		}
		return "would show an alert on the overlay", nil
	},
}

// chatReplyActionSpec checks the step as the real action would, so a dry run
// fails on the same message or platform a real run refuses. Whether the
// platform is linked and running is only known to the gateway, which a dry run
// does not ask.
var chatReplyActionSpec = tasks.ActionSpec{
	SideEffect: true,
	Validate:   validateChatPlatformParam,
	DryRun: func(params map[string]any) (string, error) {
		message, where, err := dryRunChatStep(params)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("would send %q to %s", message, where), nil
	},
}

// chatAnnounceActionSpec checks the step as the real action would. A dry run
// does not ask the gateway whether the platform is linked, or whether it has
// announcements.
var chatAnnounceActionSpec = tasks.ActionSpec{
	SideEffect: true,
	Validate:   validateAnnouncementParams,
	DryRun: func(params map[string]any) (string, error) {
		message, where, err := dryRunChatStep(params)
		if err != nil {
			return "", err
		}
		if _, err := announcementColorParam(params); err != nil {
			return "", err
		}
		return fmt.Sprintf("would announce %q in %s", message, where), nil
	},
}

// chatPinActionSpec checks the step as the real action would.
var chatPinActionSpec = tasks.ActionSpec{
	SideEffect: true,
	Validate:   validatePinParams,
	DryRun: func(params map[string]any) (string, error) {
		message, where, err := dryRunChatStep(params)
		if err != nil {
			return "", err
		}
		duration, err := pinDurationParam(params)
		if err != nil {
			return "", err
		}
		if duration == nil {
			return fmt.Sprintf("would send %q to %s and pin it", message, where), nil
		}
		return fmt.Sprintf("would send %q to %s and pin it for %d seconds", message, where, *duration), nil
	},
}

func dryRunChatStep(params map[string]any) (string, string, error) {
	message, err := chatMessageParam(params)
	if err != nil {
		return "", "", err
	}
	platform, err := chatPlatformParam(params)
	if err != nil {
		return "", "", err
	}
	where, err := describeChatPlatform(platform)
	if err != nil {
		return "", "", err
	}
	return message, where, nil
}
