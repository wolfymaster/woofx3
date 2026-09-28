// Package actions holds engine-native workflow actions that are implemented by
// asking another service to act. Each action validates its step parameters,
// sends one request, and turns the reply into the step's outputs.
package actions

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/nats-io/nats.go"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

// Requester sends a request and waits for its reply. The shared NATS client
// satisfies it; tests supply a fake responder.
type Requester interface {
	Request(subject string, data []byte, timeout time.Duration) ([]byte, error)
}

// Registrar is the part of the engine these actions register through.
type Registrar[S any] interface {
	RegisterValidatedAction(name string, action tasks.ActionFunc[S], validate tasks.ParamsValidator) error
}

// TwitchAPISubject is where the twitch service serves its commands.
const TwitchAPISubject = "twitchapi"

// TwitchRequestTimeout matches the engine API's timeout for the same
// requests. Twitch itself answers in well under a second; a category lookup
// adds a search round trip.
const TwitchRequestTimeout = 10 * time.Second

// Twitch's limits, checked again by the twitch service. Must match
// twitch/src/lib/twitch.ts: they are repeated here so a workflow that breaks
// them is refused when it is saved rather than on every run.
const (
	twitchTitleMaxLength       = 140
	twitchMarkerMaxLength      = 140
	twitchTagsMaxCount         = 10
	twitchTagMaxLength         = 25
	twitchTimeoutMaxSeconds    = 1_209_600
	twitchErrorCodeRateLimited = "rate_limited"
)

// The action ids a workflow step names in `action`, and the bundled woofx3
// module declares as native handlers. Must match modules/woofx3/manifest.json.
const (
	ActionTwitchShoutout     = "twitch.shoutout"
	ActionTwitchClip         = "twitch.clip"
	ActionTwitchMarker       = "twitch.marker"
	ActionTwitchUpdateStream = "twitch.update_stream"
	ActionTwitchTimeout      = "twitch.timeout"
)

// TwitchError is the twitch service refusing a command: invalid input, Twitch
// not linked, or Twitch's own error. Code is set for refusals a workflow can
// act on, such as `rate_limited`.
type TwitchError struct {
	Command string
	Message string
	Code    string
}

func (e *TwitchError) Error() string {
	// The twitch service already names the command on its own refusals.
	if strings.HasPrefix(e.Message, e.Command+":") {
		return e.Message
	}
	return fmt.Sprintf("%s: %s", e.Command, e.Message)
}

// twitchAction is one native action: how its parameters are read, and the
// command they are sent as. parse runs twice: on the definition when the
// workflow is registered (resolved false, `${...}` values accepted unseen), and
// on the resolved parameters when the step runs, returning the command's args.
type twitchAction struct {
	name    string
	command string
	parse   func(params map[string]any, resolved bool) (map[string]any, error)
	// send performs the command. Nil sends it as is and returns the reply's
	// data as the step's outputs.
	send func(client *twitchClient, args map[string]any) (map[string]any, error)
}

var twitchActions = []twitchAction{
	{name: ActionTwitchShoutout, command: "shoutout", parse: parseShoutout, send: sendShoutout},
	{name: ActionTwitchClip, command: "clip", parse: parseNoArgs},
	{name: ActionTwitchMarker, command: "createMarker", parse: parseMarker},
	{name: ActionTwitchUpdateStream, command: "updateStream", parse: parseUpdateStream},
	{name: ActionTwitchTimeout, command: "timeout", parse: parseTimeout},
}

// RegisterTwitch registers every Twitch action with the engine.
func RegisterTwitch[S any](registrar Registrar[S], requester Requester, timeout time.Duration) error {
	if requester == nil {
		return fmt.Errorf("twitch actions: requester is required")
	}
	if timeout <= 0 {
		return fmt.Errorf("twitch actions: timeout must be positive, got %s", timeout)
	}
	client := &twitchClient{requester: requester, timeout: timeout}
	for _, action := range twitchActions {
		if err := registrar.RegisterValidatedAction(action.name, twitchHandler[S](client, action), definitionValidator(action)); err != nil {
			return fmt.Errorf("register %s: %w", action.name, err)
		}
	}
	return nil
}

func definitionValidator(action twitchAction) tasks.ParamsValidator {
	return func(params map[string]any) error {
		_, err := action.parse(params, false)
		return err
	}
}

func twitchHandler[S any](client *twitchClient, action twitchAction) tasks.ActionFunc[S] {
	return func(_ tasks.ActionContext[S], params map[string]any) (map[string]any, error) {
		args, err := action.parse(params, true)
		if err != nil {
			return nil, err
		}
		if action.send != nil {
			return action.send(client, args)
		}
		return client.call(action.command, args)
	}
}

// sendShoutout succeeds with `skipped: true` instead of failing when Twitch's
// shoutout rate limit refuses it and the step asked for that. Twitch allows one
// shoutout every 2 minutes, so on a night with back-to-back raids the limit
// is routine, not a fault worth failing the rest of the workflow over.
func sendShoutout(client *twitchClient, args map[string]any) (map[string]any, error) {
	skipIfRateLimited, _ := args["skipIfRateLimited"].(bool)
	delete(args, "skipIfRateLimited")

	data, err := client.call("shoutout", args)
	var refusal *TwitchError
	if errors.As(err, &refusal) && refusal.Code == twitchErrorCodeRateLimited && skipIfRateLimited {
		return map[string]any{"userId": "", "skipped": true, "reason": refusal.Message}, nil
	}
	if err != nil {
		return nil, err
	}
	userID, _ := data["userId"].(string)
	return map[string]any{"userId": userID, "skipped": false, "reason": ""}, nil
}

func parseNoArgs(_ map[string]any, _ bool) (map[string]any, error) {
	return map[string]any{}, nil
}

func parseShoutout(params map[string]any, resolved bool) (map[string]any, error) {
	args, err := parseTarget(params)
	if err != nil {
		return nil, err
	}
	skip, err := boolParam(params, "skipIfRateLimited", resolved)
	if err != nil {
		return nil, err
	}
	args["skipIfRateLimited"] = skip
	return args, nil
}

func parseMarker(params map[string]any, resolved bool) (map[string]any, error) {
	description, err := textParam(params, "description")
	if err != nil {
		return nil, err
	}
	args := map[string]any{}
	if description == "" {
		return args, nil
	}
	if (resolved || !isTemplate(description)) && len([]rune(description)) > twitchMarkerMaxLength {
		return nil, fmt.Errorf("description is %d characters; Twitch allows at most %d", len([]rune(description)), twitchMarkerMaxLength)
	}
	args["description"] = description
	return args, nil
}

// parseUpdateStream reads title, category and tags. A blank field means "leave
// it as it is", because a form leaves every field it was not given blank; that
// also means this action cannot clear the category or remove every tag.
func parseUpdateStream(params map[string]any, resolved bool) (map[string]any, error) {
	args := map[string]any{}

	title, err := textParam(params, "title")
	if err != nil {
		return nil, err
	}
	if title != "" {
		if (resolved || !isTemplate(title)) && len([]rune(title)) > twitchTitleMaxLength {
			return nil, fmt.Errorf("title is %d characters; Twitch allows at most %d", len([]rune(title)), twitchTitleMaxLength)
		}
		args["title"] = title
	}

	category, err := textParam(params, "category")
	if err != nil {
		return nil, err
	}
	if category != "" {
		args["category"] = category
	}

	tags, set, err := tagsParam(params, resolved)
	if err != nil {
		return nil, err
	}
	if set {
		args["tags"] = tags
	}

	if len(args) == 0 {
		if resolved {
			return nil, fmt.Errorf("nothing to update: title, category and tags are all empty")
		}
		return nil, fmt.Errorf("set at least one of title, category or tags")
	}
	return args, nil
}

func parseTimeout(params map[string]any, resolved bool) (map[string]any, error) {
	args, err := parseTarget(params)
	if err != nil {
		return nil, err
	}

	raw, present := params["durationSeconds"]
	if !present || raw == nil || raw == "" {
		return nil, fmt.Errorf("durationSeconds is required")
	}
	if !resolved && isTemplate(raw) {
		args["durationSeconds"] = raw
	} else {
		seconds, err := wholeNumber(raw)
		if err != nil || seconds < 1 || seconds > twitchTimeoutMaxSeconds {
			return nil, fmt.Errorf("durationSeconds must be a whole number from 1 to %d, got %v", twitchTimeoutMaxSeconds, raw)
		}
		args["durationSeconds"] = seconds
	}

	reason, err := textParam(params, "reason")
	if err != nil {
		return nil, err
	}
	if reason != "" {
		args["reason"] = reason
	}
	return args, nil
}

// parseTarget reads the user an action is aimed at. userId wins when both are
// given, as it does in the twitch service: an id needs no lookup.
func parseTarget(params map[string]any) (map[string]any, error) {
	userID, err := textParam(params, "userId")
	if err != nil {
		return nil, err
	}
	userName, err := textParam(params, "userName")
	if err != nil {
		return nil, err
	}
	if userID != "" {
		return map[string]any{"userId": userID}, nil
	}
	if userName != "" {
		return map[string]any{"userName": strings.TrimPrefix(userName, "@")}, nil
	}
	return nil, fmt.Errorf("userName or userId is required")
}

// tagsParam accepts a list, or text with the tags separated by commas, which is
// what a form field or a `${...}` template produces. Commas only: a tag cannot
// contain a space, and splitting on spaces would turn a mistyped tag into two
// tags nobody asked for instead of an error naming it.
func tagsParam(params map[string]any, resolved bool) ([]string, bool, error) {
	raw, present := params["tags"]
	if !present || raw == nil {
		return nil, false, nil
	}

	var tags []string
	switch v := raw.(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return nil, false, nil
		}
		if !resolved && isTemplate(v) {
			return []string{v}, true, nil
		}
		for _, part := range strings.Split(v, ",") {
			if tag := strings.TrimSpace(part); tag != "" {
				tags = append(tags, tag)
			}
		}
	case []any:
		for _, item := range v {
			text, ok := item.(string)
			if !ok {
				return nil, false, fmt.Errorf("tags must be text, got %T in the list", item)
			}
			if !resolved && isTemplate(text) {
				return []string{text}, true, nil
			}
			tags = append(tags, strings.TrimSpace(text))
		}
		if len(tags) == 0 {
			return nil, false, nil
		}
	default:
		return nil, false, fmt.Errorf("tags must be text or a list, got %T", raw)
	}

	if err := validateTags(tags); err != nil {
		return nil, false, err
	}
	return tags, true, nil
}

func validateTags(tags []string) error {
	if len(tags) > twitchTagsMaxCount {
		return fmt.Errorf("%d tags given; Twitch allows at most %d", len(tags), twitchTagsMaxCount)
	}
	seen := make(map[string]bool, len(tags))
	for _, tag := range tags {
		if tag == "" {
			return fmt.Errorf("a tag cannot be empty")
		}
		if len([]rune(tag)) > twitchTagMaxLength {
			return fmt.Errorf("tag %q is longer than %d characters", tag, twitchTagMaxLength)
		}
		for _, r := range tag {
			if !unicode.IsLetter(r) && !unicode.IsNumber(r) {
				return fmt.Errorf("tag %q may only contain letters and numbers", tag)
			}
		}
		key := strings.ToLower(tag)
		if seen[key] {
			return fmt.Errorf("tag %q is listed twice", tag)
		}
		seen[key] = true
	}
	return nil
}

// textParam reads an optional text parameter, trimmed; absent reads as "". A
// number is accepted as its decimal text, because a Twitch user id reaches a
// step through `${...}` from whatever the trigger event carried.
func textParam(params map[string]any, key string) (string, error) {
	switch v := params[key].(type) {
	case nil:
		return "", nil
	case string:
		return strings.TrimSpace(v), nil
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), nil
	default:
		return "", fmt.Errorf("%s must be text, got %T", key, v)
	}
}

// boolParam reads an optional toggle; absent reads as false.
func boolParam(params map[string]any, key string, resolved bool) (bool, error) {
	switch v := params[key].(type) {
	case nil:
		return false, nil
	case bool:
		return v, nil
	case string:
		if !resolved && isTemplate(v) {
			return false, nil
		}
		switch strings.TrimSpace(strings.ToLower(v)) {
		case "", "false":
			return false, nil
		case "true":
			return true, nil
		}
		return false, fmt.Errorf("%s must be true or false, got %q", key, v)
	default:
		return false, fmt.Errorf("%s must be true or false, got %T", key, v)
	}
}

// wholeNumber reads a number that may arrive as JSON number or as text, since
// a partially templated value resolves to text.
func wholeNumber(value any) (int64, error) {
	switch v := value.(type) {
	case float64:
		if v != float64(int64(v)) {
			return 0, fmt.Errorf("not a whole number")
		}
		return int64(v), nil
	case int:
		return int64(v), nil
	case int64:
		return v, nil
	case string:
		return strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	default:
		return 0, fmt.Errorf("not a number")
	}
}

func isTemplate(value any) bool {
	text, ok := value.(string)
	return ok && strings.Contains(text, "${")
}

// twitchClient sends commands on the twitchapi subject.
type twitchClient struct {
	requester Requester
	timeout   time.Duration
}

type twitchReply struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// call sends `{ command, args }` and returns the reply's data, which for every
// command an action sends is an object.
func (c *twitchClient) call(command string, args map[string]any) (map[string]any, error) {
	payload, err := json.Marshal(map[string]any{"command": command, "args": args})
	if err != nil {
		return nil, fmt.Errorf("%s: encode request: %w", command, err)
	}

	raw, err := c.requester.Request(TwitchAPISubject, payload, c.timeout)
	if err != nil {
		if errors.Is(err, nats.ErrNoResponders) {
			return nil, fmt.Errorf("%s: the twitch service is not running", command)
		}
		if errors.Is(err, nats.ErrTimeout) {
			return nil, fmt.Errorf("%s: the twitch service did not answer within %s", command, c.timeout)
		}
		return nil, fmt.Errorf("%s: request failed: %w", command, err)
	}

	var reply twitchReply
	if err := json.Unmarshal(raw, &reply); err != nil {
		return nil, fmt.Errorf("%s: unreadable reply from the twitch service: %w", command, err)
	}

	switch reply.Type {
	case "twitchapi.error":
		var refusal struct {
			Error string `json:"error"`
			Code  string `json:"code"`
		}
		if err := json.Unmarshal(reply.Data, &refusal); err != nil || refusal.Error == "" {
			return nil, &TwitchError{Command: command, Message: "the twitch service refused the request without saying why"}
		}
		return nil, &TwitchError{Command: command, Message: refusal.Error, Code: refusal.Code}
	case "twitchapi." + command + ".result":
		var data map[string]any
		if err := json.Unmarshal(reply.Data, &data); err != nil {
			return nil, fmt.Errorf("%s: reply data is not an object: %w", command, err)
		}
		if data == nil {
			data = map[string]any{}
		}
		return data, nil
	default:
		return nil, fmt.Errorf("%s: unexpected reply type %q from the twitch service", command, reply.Type)
	}
}
