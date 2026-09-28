package actions

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

// fakeTwitch answers twitchapi requests the way the twitch service does, and
// records what it was asked.
type fakeTwitch struct {
	subject string
	request map[string]any
	calls   int
	// reply builds the answer; err, when set, is returned instead, as the
	// NATS client does for a timeout or a subject nobody serves.
	reply func(command string, args map[string]any) map[string]any
	err   error
}

func (f *fakeTwitch) Request(subject string, data []byte, _ time.Duration) ([]byte, error) {
	f.calls++
	f.subject = subject
	if err := json.Unmarshal(data, &f.request); err != nil {
		return nil, err
	}
	if f.err != nil {
		return nil, fmt.Errorf("failed to send request: %w", f.err)
	}
	command, _ := f.request["command"].(string)
	args, _ := f.request["args"].(map[string]any)
	return json.Marshal(f.reply(command, args))
}

func result(command string, data any) map[string]any {
	return map[string]any{"type": "twitchapi." + command + ".result", "source": "twitchapi", "data": data}
}

func refusal(message, code string) map[string]any {
	data := map[string]any{"error": message}
	if code != "" {
		data["code"] = code
	}
	return map[string]any{"type": "twitchapi.error", "source": "twitchapi", "data": data}
}

type registered struct {
	handler  tasks.ActionFunc[struct{}]
	validate tasks.ParamsValidator
}

type fakeRegistrar map[string]registered

func (r fakeRegistrar) RegisterValidatedAction(name string, action tasks.ActionFunc[struct{}], validate tasks.ParamsValidator) error {
	r[name] = registered{handler: action, validate: validate}
	return nil
}

func setup(t *testing.T, twitch *fakeTwitch) fakeRegistrar {
	t.Helper()
	registrar := fakeRegistrar{}
	if err := RegisterTwitch[struct{}](registrar, twitch, time.Second); err != nil {
		t.Fatalf("RegisterTwitch: %v", err)
	}
	return registrar
}

func run(t *testing.T, registrar fakeRegistrar, action string, params map[string]any) (map[string]any, error) {
	t.Helper()
	entry, ok := registrar[action]
	if !ok {
		t.Fatalf("action %s not registered", action)
	}
	return entry.handler(tasks.ActionContext[struct{}]{}, params)
}

func TestRegisterTwitch_RegistersEveryAction(t *testing.T) {
	registrar := setup(t, &fakeTwitch{})
	for _, name := range []string{
		ActionTwitchShoutout, ActionTwitchClip, ActionTwitchMarker, ActionTwitchUpdateStream, ActionTwitchTimeout,
	} {
		if _, ok := registrar[name]; !ok {
			t.Errorf("%s not registered", name)
		}
	}
}

func TestShoutout(t *testing.T) {
	t.Run("sends the user name without its @ and exports the user id", func(t *testing.T) {
		twitch := &fakeTwitch{reply: func(command string, _ map[string]any) map[string]any {
			return result(command, map[string]any{"ok": true, "userId": "42"})
		}}
		out, err := run(t, setup(t, twitch), ActionTwitchShoutout, map[string]any{"userName": "@raider"})
		if err != nil {
			t.Fatalf("shoutout: %v", err)
		}
		if twitch.subject != "twitchapi" || twitch.request["command"] != "shoutout" {
			t.Errorf("request = %s %v", twitch.subject, twitch.request)
		}
		args := twitch.request["args"].(map[string]any)
		if args["userName"] != "raider" || args["skipIfRateLimited"] != nil {
			t.Errorf("args = %v, want only userName raider", args)
		}
		if out["userId"] != "42" || out["skipped"] != false {
			t.Errorf("outputs = %v", out)
		}
	})

	t.Run("fails with Twitch's message", func(t *testing.T) {
		twitch := &fakeTwitch{reply: func(string, map[string]any) map[string]any {
			return refusal(`shoutout: no Twitch user named "ghost"`, "")
		}}
		_, err := run(t, setup(t, twitch), ActionTwitchShoutout, map[string]any{"userName": "ghost"})
		if err == nil || err.Error() != `shoutout: no Twitch user named "ghost"` {
			t.Fatalf("err = %v", err)
		}
	})

	limited := func(string, map[string]any) map[string]any {
		return refusal("shoutout: Twitch allows one shoutout every 2 minutes, and one per channel every 60 minutes; try again later", "rate_limited")
	}

	t.Run("fails on the rate limit by default", func(t *testing.T) {
		_, err := run(t, setup(t, &fakeTwitch{reply: limited}), ActionTwitchShoutout, map[string]any{"userId": "42"})
		var twitchErr *TwitchError
		if !errors.As(err, &twitchErr) || twitchErr.Code != "rate_limited" {
			t.Fatalf("err = %v, want a rate_limited TwitchError", err)
		}
		if !strings.Contains(err.Error(), "one shoutout every 2 minutes") {
			t.Errorf("message does not explain the limit: %v", err)
		}
	})

	t.Run("skips on the rate limit when asked to", func(t *testing.T) {
		out, err := run(t, setup(t, &fakeTwitch{reply: limited}), ActionTwitchShoutout,
			map[string]any{"userId": "42", "skipIfRateLimited": true})
		if err != nil {
			t.Fatalf("shoutout: %v", err)
		}
		if out["skipped"] != true || !strings.Contains(out["reason"].(string), "2 minutes") {
			t.Errorf("outputs = %v", out)
		}
	})

	t.Run("does not skip other refusals", func(t *testing.T) {
		twitch := &fakeTwitch{reply: func(string, map[string]any) map[string]any { return refusal("Unauthorized", "") }}
		_, err := run(t, setup(t, twitch), ActionTwitchShoutout, map[string]any{"userId": "42", "skipIfRateLimited": true})
		if err == nil || err.Error() != "shoutout: Unauthorized" {
			t.Fatalf("err = %v", err)
		}
	})
}

func TestClip(t *testing.T) {
	twitch := &fakeTwitch{reply: func(command string, _ map[string]any) map[string]any {
		return result(command, map[string]any{"id": "Clip1", "url": "https://clips.twitch.tv/Clip1"})
	}}
	out, err := run(t, setup(t, twitch), ActionTwitchClip, map[string]any{})
	if err != nil {
		t.Fatalf("clip: %v", err)
	}
	if twitch.request["command"] != "clip" || out["id"] != "Clip1" || out["url"] != "https://clips.twitch.tv/Clip1" {
		t.Errorf("request %v, outputs %v", twitch.request, out)
	}
}

func TestMarker(t *testing.T) {
	twitch := &fakeTwitch{reply: func(command string, args map[string]any) map[string]any {
		return result(command, map[string]any{"id": "m1", "positionSeconds": 3725.0, "createdAt": "2026-09-28T00:00:00Z", "description": args["description"]})
	}}
	out, err := run(t, setup(t, twitch), ActionTwitchMarker, map[string]any{"description": " hype train "})
	if err != nil {
		t.Fatalf("marker: %v", err)
	}
	if twitch.request["command"] != "createMarker" {
		t.Errorf("command = %v", twitch.request["command"])
	}
	if out["id"] != "m1" || out["positionSeconds"] != 3725.0 || out["description"] != "hype train" {
		t.Errorf("outputs = %v", out)
	}

	offline := &fakeTwitch{reply: func(string, map[string]any) map[string]any {
		return refusal("createMarker: the channel is not live; Twitch only places markers on a live stream", "")
	}}
	if _, err := run(t, setup(t, offline), ActionTwitchMarker, map[string]any{}); err == nil || !strings.Contains(err.Error(), "not live") {
		t.Errorf("err = %v, want the not-live refusal", err)
	}
}

func TestUpdateStream(t *testing.T) {
	t.Run("sends only the fields given, tags split on commas", func(t *testing.T) {
		twitch := &fakeTwitch{reply: func(command string, _ map[string]any) map[string]any {
			return result(command, map[string]any{"ok": true, "title": "BRB", "tags": []string{"English", "Chill"}})
		}}
		out, err := run(t, setup(t, twitch), ActionTwitchUpdateStream,
			map[string]any{"title": "BRB", "category": "", "tags": "English, Chill"})
		if err != nil {
			t.Fatalf("update_stream: %v", err)
		}
		args := twitch.request["args"].(map[string]any)
		if args["title"] != "BRB" || args["category"] != nil {
			t.Errorf("args = %v", args)
		}
		tags, _ := args["tags"].([]any)
		if len(tags) != 2 || tags[0] != "English" || tags[1] != "Chill" {
			t.Errorf("tags = %v", args["tags"])
		}
		if out["title"] != "BRB" {
			t.Errorf("outputs = %v", out)
		}
	})

	t.Run("fails when every field resolved empty", func(t *testing.T) {
		twitch := &fakeTwitch{}
		_, err := run(t, setup(t, twitch), ActionTwitchUpdateStream, map[string]any{"title": " ", "tags": ""})
		if err == nil || !strings.Contains(err.Error(), "nothing to update") {
			t.Fatalf("err = %v", err)
		}
		if twitch.calls != 0 {
			t.Errorf("sent a request for an empty update")
		}
	})

	t.Run("fails with Twitch's message", func(t *testing.T) {
		twitch := &fakeTwitch{reply: func(string, map[string]any) map[string]any {
			return refusal(`updateStream: no Twitch category matches "zzz"`, "")
		}}
		_, err := run(t, setup(t, twitch), ActionTwitchUpdateStream, map[string]any{"category": "zzz"})
		if err == nil || !strings.Contains(err.Error(), "no Twitch category") {
			t.Fatalf("err = %v", err)
		}
	})
}

func TestTimeout(t *testing.T) {
	twitch := &fakeTwitch{reply: func(command string, args map[string]any) map[string]any {
		return result(command, map[string]any{"ok": true, "userId": "7", "durationSeconds": args["durationSeconds"]})
	}}
	out, err := run(t, setup(t, twitch), ActionTwitchTimeout,
		map[string]any{"userName": "spammer", "durationSeconds": "600", "reason": "spam"})
	if err != nil {
		t.Fatalf("timeout: %v", err)
	}
	args := twitch.request["args"].(map[string]any)
	if args["durationSeconds"] != 600.0 || args["userName"] != "spammer" || args["reason"] != "spam" {
		t.Errorf("args = %v", args)
	}
	if out["userId"] != "7" || out["durationSeconds"] != 600.0 {
		t.Errorf("outputs = %v", out)
	}

	broadcaster := &fakeTwitch{reply: func(string, map[string]any) map[string]any {
		return refusal("timeout: the broadcaster cannot be timed out", "")
	}}
	if _, err := run(t, setup(t, broadcaster), ActionTwitchTimeout, map[string]any{"userId": "1", "durationSeconds": 60.0}); err == nil ||
		err.Error() != "timeout: the broadcaster cannot be timed out" {
		t.Errorf("err = %v", err)
	}
}

func TestTransportFailures(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"timeout", nats.ErrTimeout, "clip: the twitch service did not answer within 1s"},
		{"no responders", nats.ErrNoResponders, "clip: the twitch service is not running"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := run(t, setup(t, &fakeTwitch{err: tc.err}), ActionTwitchClip, map[string]any{})
			if err == nil || err.Error() != tc.want {
				t.Fatalf("err = %v, want %q", err, tc.want)
			}
		})
	}

	t.Run("an unexpected reply type", func(t *testing.T) {
		twitch := &fakeTwitch{reply: func(string, map[string]any) map[string]any { return result("somethingElse", map[string]any{}) }}
		_, err := run(t, setup(t, twitch), ActionTwitchClip, map[string]any{})
		if err == nil || !strings.Contains(err.Error(), "unexpected reply type") {
			t.Fatalf("err = %v", err)
		}
	})
}

// Validation at registration: a value that can never work is refused, and a
// `${...}` template is accepted unseen, since only the run knows it.
func TestDefinitionValidation(t *testing.T) {
	registrar := setup(t, &fakeTwitch{})
	long := strings.Repeat("a", 141)
	cases := []struct {
		action  string
		params  map[string]any
		wantErr string
	}{
		{ActionTwitchShoutout, map[string]any{"userName": "${trigger.data.fromBroadcasterUserLogin}"}, ""},
		{ActionTwitchShoutout, map[string]any{"userId": "42", "skipIfRateLimited": true}, ""},
		{ActionTwitchShoutout, map[string]any{}, "userName or userId is required"},
		{ActionTwitchShoutout, map[string]any{"userName": "x", "skipIfRateLimited": "maybe"}, "skipIfRateLimited must be true or false"},
		{ActionTwitchClip, map[string]any{}, ""},
		{ActionTwitchMarker, map[string]any{}, ""},
		{ActionTwitchMarker, map[string]any{"description": long}, "Twitch allows at most 140"},
		{ActionTwitchMarker, map[string]any{"description": "${trigger.data.message}"}, ""},
		{ActionTwitchUpdateStream, map[string]any{}, "set at least one of title, category or tags"},
		{ActionTwitchUpdateStream, map[string]any{"title": "", "category": "", "tags": ""}, "set at least one of title, category or tags"},
		{ActionTwitchUpdateStream, map[string]any{"title": long}, "Twitch allows at most 140"},
		{ActionTwitchUpdateStream, map[string]any{"title": "Back soon: ${trigger.data.args}"}, ""},
		{ActionTwitchUpdateStream, map[string]any{"category": "Just Chatting"}, ""},
		{ActionTwitchUpdateStream, map[string]any{"tags": "chill vibes"}, `tag "chill vibes" may only contain letters and numbers`},
		{ActionTwitchUpdateStream, map[string]any{"tags": "a,b,c,d,e,f,g,h,i,j,k"}, "11 tags given"},
		{ActionTwitchUpdateStream, map[string]any{"tags": "Chill,chill"}, "listed twice"},
		{ActionTwitchUpdateStream, map[string]any{"tags": []any{"English", "Chill"}}, ""},
		{ActionTwitchUpdateStream, map[string]any{"tags": []string{"English", "Chill"}}, ""},
		{ActionTwitchUpdateStream, map[string]any{"tags": []string{"a b"}}, "may only contain letters and numbers"},
		{ActionTwitchUpdateStream, map[string]any{"tags": "हिन्दी, English"}, ""},
		{ActionTwitchTimeout, map[string]any{"userId": "7", "durationSeconds": 60.0, "reason": strings.Repeat("r", 500)}, ""},
		{ActionTwitchTimeout, map[string]any{"userId": "7", "durationSeconds": 60.0, "reason": strings.Repeat("r", 501)}, "Twitch allows at most 500"},
		{ActionTwitchUpdateStream, map[string]any{"tags": 5.0}, "tags must be text or a list"},
		{ActionTwitchTimeout, map[string]any{"userName": "x", "durationSeconds": 600.0}, ""},
		{ActionTwitchTimeout, map[string]any{"userName": "x", "durationSeconds": "${trigger.data.seconds}"}, ""},
		{ActionTwitchTimeout, map[string]any{"userName": "x"}, "durationSeconds is required"},
		{ActionTwitchTimeout, map[string]any{"userName": "x", "durationSeconds": 0.0}, "durationSeconds must be a whole number from 1 to 1209600"},
		{ActionTwitchTimeout, map[string]any{"userName": "x", "durationSeconds": 1.5}, "durationSeconds must be a whole number"},
		{ActionTwitchTimeout, map[string]any{"userName": "x", "durationSeconds": 1209601.0}, "durationSeconds must be a whole number"},
		{ActionTwitchTimeout, map[string]any{"durationSeconds": 60.0}, "userName or userId is required"},
	}
	for _, tc := range cases {
		name := fmt.Sprintf("%s %v", tc.action, tc.params)
		err := registrar[tc.action].validate(tc.params)
		if tc.wantErr == "" {
			if err != nil {
				t.Errorf("%s: unexpected error %v", name, err)
			}
			continue
		}
		if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
			t.Errorf("%s: err = %v, want %q", name, err, tc.wantErr)
		}
	}
}

// A template that resolves to something invalid is caught when the step runs,
// before anything is sent.
func TestRunValidatesResolvedParams(t *testing.T) {
	twitch := &fakeTwitch{}
	_, err := run(t, setup(t, twitch), ActionTwitchTimeout, map[string]any{"userName": "x", "durationSeconds": "soon"})
	if err == nil || !strings.Contains(err.Error(), "durationSeconds must be a whole number") {
		t.Fatalf("err = %v", err)
	}
	if twitch.calls != 0 {
		t.Errorf("sent a request with an invalid duration")
	}
}

// A reference the resolver could not follow is left in place as `${...}`; it
// must fail the step rather than become a literal stream title.
func TestRunRefusesUnresolvedTemplates(t *testing.T) {
	twitch := &fakeTwitch{}
	registrar := setup(t, twitch)
	cases := []struct {
		action string
		params map[string]any
	}{
		{ActionTwitchUpdateStream, map[string]any{"title": "BRB ${trigger.data.missing}"}},
		{ActionTwitchUpdateStream, map[string]any{"tags": []any{"${trigger.data.tag}"}}},
		{ActionTwitchShoutout, map[string]any{"userName": "${trigger.data.missing}"}},
	}
	for _, tc := range cases {
		_, err := run(t, registrar, tc.action, tc.params)
		if err == nil || !strings.Contains(err.Error(), "did not resolve") {
			t.Errorf("%s %v: err = %v, want an unresolved-template error", tc.action, tc.params, err)
		}
	}
	if twitch.calls != 0 {
		t.Errorf("sent %d requests carrying unresolved templates", twitch.calls)
	}
}

// Devanagari vowel signs are combining marks; a tag written in it is valid.
func TestUpdateStreamAcceptsCombiningMarks(t *testing.T) {
	twitch := &fakeTwitch{reply: func(command string, _ map[string]any) map[string]any {
		return result(command, map[string]any{"ok": true})
	}}
	if _, err := run(t, setup(t, twitch), ActionTwitchUpdateStream, map[string]any{"tags": "हिन्दी"}); err != nil {
		t.Fatalf("update_stream: %v", err)
	}
	tags := twitch.request["args"].(map[string]any)["tags"].([]any)
	if len(tags) != 1 || tags[0] != "हिन्दी" {
		t.Errorf("tags = %v", tags)
	}
}
