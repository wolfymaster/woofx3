package facts

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type fakeClient struct {
	mu       sync.Mutex
	defs     []FactDefinition
	listErr  error
	applyErr error
	applied  []*ApplyFactDeltasRequest
}

func (f *fakeClient) ListFactDefinitions(context.Context) ([]FactDefinition, error) {
	return f.defs, f.listErr
}

func (f *fakeClient) ApplyFactDeltas(_ context.Context, req *ApplyFactDeltasRequest) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.applied = append(f.applied, req)
	return f.applyErr
}

var eventTime = time.Date(2026, 10, 9, 20, 0, 0, 0, time.UTC)

func where(t *testing.T, raw string) *expression.ConditionTree {
	t.Helper()
	var tree expression.ConditionTree
	if err := json.Unmarshal([]byte(raw), &tree); err != nil {
		t.Fatalf("decode where %s: %v", raw, err)
	}
	return &tree
}

func chatSource(w *expression.ConditionTree) FactSource {
	return FactSource{
		Trigger:           "twitch:user_message",
		EventPattern:      "user.message",
		IdentityPath:      "chatterId",
		AnonymousWhenPath: "chatterIsAnonymous",
		DisplayNamePath:   "chatterName",
		Where:             w,
	}
}

func definition(id, fn string, sources ...FactSource) FactDefinition {
	return FactDefinition{ID: id, Revision: 3, Aggregate: Aggregate{Fn: fn}, Sources: sources, Status: StatusActive}
}

func chatEvent(data map[string]any) *types.Event {
	return &types.Event{
		ID:        "evt-1",
		Type:      "user.message",
		Source:    "twitch",
		Platform:  "twitch",
		SessionID: "sess-9",
		Time:      eventTime,
		Data:      data,
	}
}

func newProjector(t *testing.T, defs ...FactDefinition) (*Projector, *fakeClient) {
	t.Helper()
	client := &fakeClient{}
	p := NewProjector(client)
	if err := p.Replace(defs); err != nil {
		t.Fatalf("replace: %v", err)
	}
	return p, client
}

func num(n float64) *float64 { return &n }

func str(s string) *string { return &s }

func TestProjectCountsAMatchingMessageInOneBatch(t *testing.T) {
	p, client := newProjector(t,
		definition("user:fact:apple_mentions", AggregateCount,
			chatSource(where(t, `{"path":"message","op":"contains","value":"apple"}`))),
		definition("woofx3:fact:messages", AggregateCount, chatSource(nil)),
	)
	err := p.Project(context.Background(), chatEvent(map[string]any{
		"chatterId": "u1", "chatterName": "Wolfy", "chatterIsAnonymous": false, "message": "apple pie",
	}))
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	if len(client.applied) != 1 {
		t.Fatalf("got %d apply calls, want 1", len(client.applied))
	}
	want := &ApplyFactDeltasRequest{
		Source:       "twitch",
		EventID:      "evt-1",
		OccurredAt:   eventTime,
		SessionStamp: "sess-9",
		Deltas: []FactDelta{
			{FactID: "user:fact:apple_mentions", Revision: 3, Platform: "twitch", SubjectID: "u1", SubjectName: "Wolfy", Op: "count", Num: num(1)},
			{FactID: "woofx3:fact:messages", Revision: 3, Platform: "twitch", SubjectID: "u1", SubjectName: "Wolfy", Op: "count", Num: num(1)},
		},
	}
	if !reflect.DeepEqual(client.applied[0], want) {
		t.Fatalf("got %+v\nwant %+v", client.applied[0], want)
	}
}

func TestProjectMakesNoCallWhenNothingMatches(t *testing.T) {
	p, client := newProjector(t, definition("f", AggregateCount,
		chatSource(where(t, `{"path":"message","op":"contains","value":"apple"}`))))
	if err := p.Project(context.Background(), chatEvent(map[string]any{"chatterId": "u1", "message": "pear"})); err != nil {
		t.Fatalf("project: %v", err)
	}
	other := chatEvent(map[string]any{"chatterId": "u1", "message": "apple"})
	other.Type = "channel.cheer"
	if err := p.Project(context.Background(), other); err != nil {
		t.Fatalf("project: %v", err)
	}
	if len(client.applied) != 0 {
		t.Fatalf("got %d apply calls, want none", len(client.applied))
	}
}

func TestProjectSkipsEventsThatAreNotAViewerAction(t *testing.T) {
	p, client := newProjector(t, definition("f", AggregateCount, chatSource(nil)))
	data := map[string]any{"chatterId": "u1"}

	api := chatEvent(data)
	api.Source = "api"
	dry := chatEvent(data)
	dry.DryRun = true
	noPlatform := chatEvent(data)
	noPlatform.Platform = ""
	anonymous := chatEvent(map[string]any{"chatterId": "u1", "chatterIsAnonymous": true})
	noViewer := chatEvent(map[string]any{"message": "hi"})
	emptyViewer := chatEvent(map[string]any{"chatterId": ""})

	for name, event := range map[string]*types.Event{
		"api": api, "dry run": dry, "no platform": noPlatform,
		"anonymous": anonymous, "no viewer": noViewer, "empty viewer": emptyViewer,
	} {
		if err := p.Project(context.Background(), event); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(client.applied) != 0 {
			t.Fatalf("%s: produced an apply call", name)
		}
	}
}

func TestProjectFansOutToEveryViewerInAList(t *testing.T) {
	src := FactSource{
		Trigger:      "twitch:chat_presence",
		EventPattern: "chat.presence",
		IdentityPath: "chatterIds",
		Value:        "intervalSeconds",
	}
	p, _ := newProjector(t, definition("woofx3:fact:watch_seconds", AggregateSum, src))
	req, err := p.Request(&types.Event{
		ID: "p1", Type: "chat.presence", Source: "twitch", Platform: "twitch", Time: eventTime,
		Data: map[string]any{
			"chatterIds":      []any{"a", nil, "b", "a", ""},
			"intervalSeconds": float64(60),
		},
	})
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	got := subjectsOf(req)
	if !reflect.DeepEqual(got, []string{"a=", "b="}) {
		t.Fatalf("got subjects %v", got)
	}
	for _, d := range req.Deltas {
		if d.Op != "sum" || d.Num == nil || *d.Num != 60 {
			t.Fatalf("delta %+v does not carry the interval", d)
		}
	}
}

func subjectsOf(req *ApplyFactDeltasRequest) []string {
	var out []string
	for _, d := range req.Deltas {
		out = append(out, d.SubjectID+"="+d.SubjectName)
	}
	sort.Strings(out)
	return out
}

func TestProjectDeltaValueFollowsTheAggregate(t *testing.T) {
	ms := float64(eventTime.UnixMilli())
	cases := []struct {
		fn      string
		path    string
		wantNum *float64
		wantStr *string
	}{
		{AggregateCount, "", num(1), nil},
		{AggregateSum, "bits", num(250), nil},
		{AggregateMin, "bits", num(250), nil},
		{AggregateMax, "bits", num(250), nil},
		{AggregateLast, "bits", num(250), nil},
		{AggregateLast, "message", nil, str("Cheer250 hi")},
		{AggregateLast, "isVip", nil, str("true")},
		{AggregateLast, "badges", nil, str(`["vip"]`)},
		{AggregateFirstAt, "", num(ms), nil},
		{AggregateLastAt, "", num(ms), nil},
		{AggregateSessions, "", num(ms), nil},
		{AggregateSessionStreak, "", num(ms), nil},
	}
	for _, tc := range cases {
		t.Run(tc.fn+"/"+tc.path, func(t *testing.T) {
			def := definition("f", tc.fn, FactSource{EventPattern: "channel.cheer", IdentityPath: "userId"})
			def.Aggregate.Path = tc.path
			p, _ := newProjector(t, def)
			req, err := p.Request(&types.Event{
				ID: "c1", Type: "channel.cheer", Source: "twitch", Platform: "twitch", Time: eventTime,
				Data: map[string]any{
					"userId": "u1", "bits": float64(250), "message": "Cheer250 hi",
					"isVip": true, "badges": []any{"vip"},
				},
			})
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			if len(req.Deltas) != 1 {
				t.Fatalf("got %d deltas", len(req.Deltas))
			}
			d := req.Deltas[0]
			if d.Op != tc.fn {
				t.Fatalf("op %q, want %q", d.Op, tc.fn)
			}
			if !reflect.DeepEqual(d.Num, tc.wantNum) || !reflect.DeepEqual(d.Str, tc.wantStr) {
				t.Fatalf("got num=%v str=%v", deref(d.Num), deref(d.Str))
			}
		})
	}
}

func deref[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestProjectUsesNowWhenTheEventHasNoTime(t *testing.T) {
	p, _ := newProjector(t, definition("f", AggregateLastAt, chatSource(nil)))
	p.now = func() time.Time { return eventTime.Add(time.Hour) }
	event := chatEvent(map[string]any{"chatterId": "u1"})
	event.Time = time.Time{}
	req, err := p.Request(event)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if !req.OccurredAt.Equal(eventTime.Add(time.Hour)) || *req.Deltas[0].Num != float64(eventTime.Add(time.Hour).UnixMilli()) {
		t.Fatalf("got occurredAt %v delta %v", req.OccurredAt, *req.Deltas[0].Num)
	}
}

func TestProjectSkipsASourceWithoutItsValue(t *testing.T) {
	def := definition("f", AggregateSum, FactSource{EventPattern: "channel.cheer", IdentityPath: "userId", Value: "bits"})
	p, client := newProjector(t, def)
	if err := p.Project(context.Background(), &types.Event{
		ID: "c1", Type: "channel.cheer", Source: "twitch", Platform: "twitch", Data: map[string]any{"userId": "u1"},
	}); err != nil {
		t.Fatalf("project: %v", err)
	}
	if len(client.applied) != 0 {
		t.Fatal("a sum with no value produced a delta")
	}
}

func TestProjectReportsAWrongTypeAndKeepsTheOtherDeltas(t *testing.T) {
	p, client := newProjector(t,
		definition("bits", AggregateSum, FactSource{Trigger: "cheer", EventPattern: "channel.cheer", IdentityPath: "userId", Value: "bits"}),
		definition("cheers", AggregateCount, FactSource{Trigger: "cheer", EventPattern: "channel.cheer", IdentityPath: "userId"}),
	)
	err := p.Project(context.Background(), &types.Event{
		ID: "c1", Type: "channel.cheer", Source: "twitch", Platform: "twitch", Time: eventTime,
		Data: map[string]any{"userId": "u1", "bits": "lots"},
	})
	if err == nil || !strings.Contains(err.Error(), "fact bits from cheer: sum value bits is string") {
		t.Fatalf("got error %v", err)
	}
	if len(client.applied) != 1 || len(client.applied[0].Deltas) != 1 || client.applied[0].Deltas[0].FactID != "cheers" {
		t.Fatalf("got %+v", client.applied)
	}
}

func TestProjectMultiSourceCountsAnEventOncePerViewer(t *testing.T) {
	support := definition("user:fact:support", AggregateCount,
		FactSource{Trigger: "cheer", EventPattern: "channel.cheer", IdentityPath: "userId"},
		FactSource{Trigger: "sub", EventPattern: "channel.subscribe", IdentityPath: "userId"},
		FactSource{Trigger: "big cheer", EventPattern: "channel.*", IdentityPath: "userId",
			Where: where(t, `{"path":"bits","op":"gte","value":100}`)},
	)
	p, client := newProjector(t, support)
	for _, typ := range []string{"channel.cheer", "channel.subscribe", "channel.follow"} {
		if err := p.Project(context.Background(), &types.Event{
			ID: typ, Type: typ, Source: "twitch", Platform: "twitch", Time: eventTime,
			Data: map[string]any{"userId": "u1", "bits": float64(500)},
		}); err != nil {
			t.Fatalf("%s: %v", typ, err)
		}
	}
	if len(client.applied) != 3 {
		t.Fatalf("got %d calls, want one per event", len(client.applied))
	}
	for _, req := range client.applied {
		if len(req.Deltas) != 1 {
			t.Fatalf("event %s got %d deltas, want 1", req.EventID, len(req.Deltas))
		}
	}
}

func TestProjectEvaluatesASharedAtomOncePerEvent(t *testing.T) {
	apple := `{"path":"message","op":"regex","value":"(?i)apple"}`
	p, _ := newProjector(t,
		definition("a", AggregateCount, chatSource(where(t, apple))),
		definition("b", AggregateCount, chatSource(where(t, `{"all":[`+apple+`,{"path":"bits","op":"gt","value":0}]}`))),
		definition("c", AggregateCount, chatSource(where(t, `{"not":`+apple+`}`))),
		definition("d", AggregateCount, chatSource(where(t, `{"path":"message","op":"matches","value":"(?i)apple"}`))),
	)
	idx := p.index.Load()
	if len(idx.atoms) != 2 {
		t.Fatalf("pooled %d atoms, want 2 (the regex shared, alias included, and bits)", len(idx.atoms))
	}
	if idx.atoms[0].re == nil {
		t.Fatal("regex atom was not precompiled")
	}
	req, err := p.Request(chatEvent(map[string]any{"chatterId": "u1", "message": "APPLES", "bits": float64(1)}))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	var facts []string
	for _, d := range req.Deltas {
		facts = append(facts, d.FactID)
	}
	if !reflect.DeepEqual(facts, []string{"a", "b", "d"}) {
		t.Fatalf("got facts %v", facts)
	}
}

func TestReplaceSkipsDefinitionsThatAreNotActiveOrDoNotCompile(t *testing.T) {
	good := definition("good", AggregateCount, chatSource(nil))
	unresolved := definition("unresolved", AggregateCount, chatSource(nil))
	unresolved.Status = StatusUnresolved
	badRegex := definition("bad_regex", AggregateCount, chatSource(&expression.ConditionTree{Path: "message", Op: "regex", Value: "("}))
	noValue := definition("no_value", AggregateMax, chatSource(nil))
	unknownFn := definition("unknown_fn", "median", chatSource(nil))
	noIdentity := definition("no_identity", AggregateCount, FactSource{EventPattern: "user.message"})

	client := &fakeClient{defs: []FactDefinition{good, unresolved, badRegex, noValue, unknownFn, noIdentity}}
	p := NewProjector(client)
	err := p.Load(context.Background())
	if err == nil {
		t.Fatal("expected compile errors")
	}
	for _, id := range []string{"bad_regex", "no_value", "unknown_fn", "no_identity"} {
		if !strings.Contains(err.Error(), "fact "+id+":") {
			t.Errorf("error does not name %s: %v", id, err)
		}
	}
	if strings.Contains(err.Error(), "unresolved") {
		t.Errorf("an unresolved definition is skipped, not an error: %v", err)
	}
	req, _ := p.Request(chatEvent(map[string]any{"chatterId": "u1", "message": "hi"}))
	if req == nil || len(req.Deltas) != 1 || req.Deltas[0].FactID != "good" {
		t.Fatalf("got %+v", req)
	}
}

func TestLoadKeepsTheCurrentDefinitionsWhenListingFails(t *testing.T) {
	p, client := newProjector(t, definition("f", AggregateCount, chatSource(nil)))
	client.listErr = errors.New("db down")
	if err := p.Load(context.Background()); err == nil {
		t.Fatal("expected the list error")
	}
	if got := p.Patterns(); !reflect.DeepEqual(got, []string{"user.message"}) {
		t.Fatalf("patterns %v", got)
	}
}

func TestPatternsListsEachPatternOnce(t *testing.T) {
	p, _ := newProjector(t,
		definition("a", AggregateCount, chatSource(nil), FactSource{EventPattern: "channel.>", IdentityPath: "userId"}),
		definition("b", AggregateCount, chatSource(nil), FactSource{EventPattern: "channel.>", IdentityPath: "userId"}),
	)
	if got := p.Patterns(); !reflect.DeepEqual(got, []string{"user.message", "channel.>"}) {
		t.Fatalf("patterns %v", got)
	}
}

func TestReplaceOwnsItsWhereTrees(t *testing.T) {
	tree := where(t, `{"path":"message","op":"contains","value":"apple"}`)
	p, _ := newProjector(t, definition("f", AggregateCount, chatSource(tree)))
	tree.Value = "pear"
	req, _ := p.Request(chatEvent(map[string]any{"chatterId": "u1", "message": "apple"}))
	if req == nil {
		t.Fatal("mutating the caller's tree changed the compiled definition")
	}
}

func TestProjectReturnsTheApplyError(t *testing.T) {
	p, client := newProjector(t, definition("f", AggregateCount, chatSource(nil)))
	client.applyErr = errors.New("timeout")
	err := p.Project(context.Background(), chatEvent(map[string]any{"chatterId": "u1"}))
	if err == nil || !strings.Contains(err.Error(), "apply fact deltas for event evt-1: timeout") {
		t.Fatalf("got %v", err)
	}
}

func TestProjectRejectsANonStringIdentity(t *testing.T) {
	p, client := newProjector(t, definition("f", AggregateCount, chatSource(nil)))
	err := p.Project(context.Background(), chatEvent(map[string]any{"chatterId": float64(7)}))
	var sourceErr *SourceError
	if !errors.As(err, &sourceErr) || sourceErr.FactID != "f" || !strings.Contains(err.Error(), "identity chatterId is float64, not a string or a list") {
		t.Fatalf("got %v", err)
	}
	if len(client.applied) != 0 {
		t.Fatal("a bad identity produced a call")
	}
}

func TestProjectRejectsANonStringIdInAList(t *testing.T) {
	p, client := newProjector(t, definition("f", AggregateCount,
		FactSource{Trigger: "presence", EventPattern: "chat.presence", IdentityPath: "chatterIds"}))
	err := p.Project(context.Background(), &types.Event{
		ID: "p1", Type: "chat.presence", Source: "twitch", Platform: "twitch", Time: eventTime,
		Data: map[string]any{"chatterIds": []any{"a", map[string]any{"id": "b"}}},
	})
	if err == nil || err.Error() != "fact f from presence: identity chatterIds[1] is map[string]interface {}, not a string" {
		t.Fatalf("got %v", err)
	}
	if len(client.applied) != 0 {
		t.Fatal("a bad id list produced a call")
	}
}

func TestProjectFirstMatchingSourceSetsTheValue(t *testing.T) {
	p, _ := newProjector(t, definition("f", AggregateSum,
		FactSource{EventPattern: "channel.cheer", IdentityPath: "userId", Value: "bits"},
		FactSource{EventPattern: "channel.*", IdentityPath: "userId", Value: "bonus"},
	))
	req, err := p.Request(&types.Event{
		ID: "c1", Type: "channel.cheer", Source: "twitch", Platform: "twitch", Time: eventTime,
		Data: map[string]any{"userId": "u1", "bits": float64(100), "bonus": float64(7)},
	})
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if len(req.Deltas) != 1 || *req.Deltas[0].Num != 100 {
		t.Fatalf("got %+v", req.Deltas)
	}
}

func TestProjectSecondSourceCountsWhenTheFirstSkips(t *testing.T) {
	p, _ := newProjector(t, definition("f", AggregateSum,
		FactSource{EventPattern: "channel.cheer", IdentityPath: "userId", Value: "bits",
			Where: where(t, `{"path":"bits","op":"gt","value":1000}`)},
		FactSource{EventPattern: "channel.cheer", IdentityPath: "userId", Value: "missing"},
		FactSource{EventPattern: "channel.cheer", IdentityPath: "userId", Value: "bonus"},
	))
	req, err := p.Request(&types.Event{
		ID: "c1", Type: "channel.cheer", Source: "twitch", Platform: "twitch", Time: eventTime,
		Data: map[string]any{"userId": "u1", "bits": float64(100), "bonus": float64(7)},
	})
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if len(req.Deltas) != 1 || *req.Deltas[0].Num != 7 {
		t.Fatalf("got %+v", req.Deltas)
	}
}

func TestProjectAnonymousWhenSkipsAListIdentity(t *testing.T) {
	p, client := newProjector(t, definition("f", AggregateCount, FactSource{
		EventPattern: "channel.gift", IdentityPath: "recipientIds", AnonymousWhenPath: "isAnonymous",
	}))
	data := map[string]any{"recipientIds": []any{"a", "b"}, "isAnonymous": true}
	event := &types.Event{ID: "g1", Type: "channel.gift", Source: "twitch", Platform: "twitch", Time: eventTime, Data: data}
	if err := p.Project(context.Background(), event); err != nil {
		t.Fatalf("project: %v", err)
	}
	if len(client.applied) != 0 {
		t.Fatal("an anonymous event produced a call")
	}
	data["isAnonymous"] = false
	if err := p.Project(context.Background(), event); err != nil {
		t.Fatalf("project: %v", err)
	}
	if len(client.applied) != 1 || len(client.applied[0].Deltas) != 2 {
		t.Fatalf("got %+v", client.applied)
	}
}

func TestReplaceRunsConcurrentlyWithRequest(t *testing.T) {
	defs := []FactDefinition{
		definition("a", AggregateCount, chatSource(where(t, `{"path":"message","op":"regex","value":"apple"}`))),
		definition("b", AggregateCount, FactSource{EventPattern: "user.*", IdentityPath: "chatterId"}),
	}
	p, _ := newProjector(t, defs...)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for range 200 {
			if err := p.Replace(defs); err != nil {
				t.Errorf("replace: %v", err)
				return
			}
		}
	}()
	go func() {
		defer wg.Done()
		for range 200 {
			req, err := p.Request(chatEvent(map[string]any{"chatterId": "u1", "message": "apple"}))
			if err != nil || req == nil || len(req.Deltas) != 2 {
				t.Errorf("request: %+v, %v", req, err)
				return
			}
		}
	}()
	wg.Wait()
}
