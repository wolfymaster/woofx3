package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/facts"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/triggers"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// factLogger records what was logged, safe for the goroutines the engine and
// the reloader log from.
type factLogger struct {
	mu     sync.Mutex
	infos  []string
	debugs []string
	warns  []string
	errs   []string
}

func (l *factLogger) Info(message string, _ ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.infos = append(l.infos, message)
}

func (l *factLogger) Debug(message string, _ ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.debugs = append(l.debugs, message)
}

func (l *factLogger) Warn(message string, _ ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.warns = append(l.warns, message)
}

func (l *factLogger) Error(message string, _ ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.errs = append(l.errs, message)
}

func (l *factLogger) count(messages func(*factLogger) []string, message string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for _, m := range messages(l) {
		if m == message {
			n++
		}
	}
	return n
}

func infosOf(l *factLogger) []string  { return l.infos }
func debugsOf(l *factLogger) []string { return l.debugs }
func warnsOf(l *factLogger) []string  { return l.warns }
func errorsOf(l *factLogger) []string { return l.errs }

// fakeFactClient is a facts.Client whose apply can be observed and failed.
type fakeFactClient struct {
	mu       sync.Mutex
	defs     []facts.FactDefinition
	listErr  error
	applyErr error
	applied  []*facts.ApplyFactDeltasRequest
	// onApply runs inside ApplyFactDeltas, before it returns.
	onApply func(ctx context.Context)
}

func (f *fakeFactClient) ListFactDefinitions(context.Context) ([]facts.FactDefinition, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.listErr != nil {
		return nil, fmt.Errorf("%w: %w", errFactDefinitionsUnavailable, f.listErr)
	}
	return append([]facts.FactDefinition(nil), f.defs...), nil
}

func (f *fakeFactClient) ApplyFactDeltas(ctx context.Context, req *facts.ApplyFactDeltasRequest) error {
	if f.onApply != nil {
		f.onApply(ctx)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.applied = append(f.applied, req)
	return f.applyErr
}

func (f *fakeFactClient) appliedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.applied)
}

func countChatters(revision int64, pattern string) facts.FactDefinition {
	return facts.FactDefinition{
		ID:        "user:fact:messages",
		Revision:  revision,
		Status:    facts.StatusActive,
		Aggregate: facts.Aggregate{Fn: facts.AggregateCount},
		Sources: []facts.FactSource{{
			Trigger:      "twitch:trigger:user_message",
			EventPattern: pattern,
			IdentityPath: "chatterId",
		}},
	}
}

// factApp is an app with a projector over client and one workflow on
// message.user.twitch whose only step reports each run on the returned
// channel.
func factApp(t *testing.T, client *fakeFactClient, logger *factLogger) (*WorkflowApp, <-chan struct{}) {
	t.Helper()
	app := NewWorkflowApp(logger)
	app.factCtx = context.Background()
	app.facts = facts.NewProjector(client)
	if err := app.facts.Replace(client.defs); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	ran := make(chan struct{}, 8)
	if err := app.engine.RegisterAction("record", func(tasks.ActionContext[AppServices], map[string]any) (map[string]any, error) {
		ran <- struct{}{}
		return nil, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	if err := app.engine.RegisterWorkflow(&types.WorkflowDefinition{
		ID:      "wf-chat",
		Name:    "chat",
		Trigger: &types.TriggerConfig{Type: "event", Event: "message.user.twitch"},
		Tasks:   []types.TaskDefinition{{ID: "record", Type: "action", Action: "record"}},
	}); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	t.Cleanup(func() { _ = app.engine.Stop() })
	return app, ran
}

func chatPayload(id string, chatterID any) []byte {
	identity := `"` + fmt.Sprint(chatterID) + `"`
	if _, isNumber := chatterID.(int); isNumber {
		identity = fmt.Sprint(chatterID)
	}
	return []byte(`{"id":"` + id + `","type":"message.user.twitch","source":"twitch","platform":"twitch",` +
		`"data":{"chatterId":` + identity + `}}`)
}

func awaitRuns(t *testing.T, ran <-chan struct{}, want int) {
	t.Helper()
	for i := 0; i < want; i++ {
		select {
		case <-ran:
		case <-time.After(2 * time.Second):
			t.Fatalf("saw %d workflow runs, want %d", i, want)
		}
	}
	select {
	case <-ran:
		t.Fatalf("saw more than %d workflow runs", want)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestHandleTriggerEventAppliesFactsBeforeDispatch(t *testing.T) {
	client := &fakeFactClient{defs: []facts.FactDefinition{countChatters(1, "message.user.twitch")}}
	app, ran := factApp(t, client, &factLogger{})
	entered := make(chan struct{})
	release := make(chan struct{})
	client.onApply = func(context.Context) {
		close(entered)
		<-release
	}

	handled := make(chan struct{})
	go func() {
		app.handleTriggerEvent(chatPayload("e1", "u1"), "message.user.twitch")
		close(handled)
	}()
	<-entered
	select {
	case <-ran:
		t.Fatal("a workflow ran while the fact write was still in flight")
	case <-time.After(100 * time.Millisecond):
	}

	close(release)
	<-handled
	awaitRuns(t, ran, 1)
	if client.appliedCount() != 1 {
		t.Fatalf("applied %d batches, want 1", client.appliedCount())
	}
	if got := client.applied[0].Deltas[0].SubjectID; got != "u1" {
		t.Fatalf("delta subject = %q, want u1", got)
	}
}

func TestHandleTriggerEventDispatchesWhenFactsFail(t *testing.T) {
	client := &fakeFactClient{
		defs:     []facts.FactDefinition{countChatters(1, "message.user.twitch")},
		applyErr: errors.New("db proxy down"),
	}
	logger := &factLogger{}
	app, ran := factApp(t, client, logger)

	app.handleTriggerEvent(chatPayload("e1", "u1"), "message.user.twitch")

	awaitRuns(t, ran, 1)
	if n := logger.count(errorsOf, "Failed to apply fact deltas"); n != 1 {
		t.Fatalf("logged the apply failure %d times, want 1", n)
	}
}

// The bus delivers an event once per subscription it matches. A fact pattern
// overlapping a workflow's must not double either the facts or the runs.
func TestHandleTriggerEventHandlesOverlappingDeliveriesOnce(t *testing.T) {
	client := &fakeFactClient{defs: []facts.FactDefinition{countChatters(1, "message.user.*")}}
	app, ran := factApp(t, client, &factLogger{})

	var wg sync.WaitGroup
	// One copy per subscription, each on its own goroutine as the bus runs
	// them; both carry the concrete subject.
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			app.handleTriggerEvent(chatPayload("e1", "u1"), "message.user.twitch")
		}()
	}
	wg.Wait()

	awaitRuns(t, ran, 1)
	if client.appliedCount() != 1 {
		t.Fatalf("applied %d batches, want 1", client.appliedCount())
	}

	app.handleTriggerEvent(chatPayload("e2", "u1"), "message.user.twitch")
	awaitRuns(t, ran, 1)
	if client.appliedCount() != 2 {
		t.Fatalf("a new event id was taken for a copy; applied %d batches, want 2", client.appliedCount())
	}
}

func TestNoWorkflowMatchIsDebugForAnEventFactsListenFor(t *testing.T) {
	client := &fakeFactClient{defs: []facts.FactDefinition{countChatters(1, "chat.presence")}}
	logger := &factLogger{}
	app, _ := factApp(t, client, logger)
	const noMatch = "Event matched no workflows"

	const received = "Received trigger event"

	app.handleTriggerEvent([]byte(`{"id":"p1","type":"chat.presence","source":"twitch","platform":"twitch","data":{"chatterId":"u1"}}`), "chat.presence")
	if len(logger.infos) != 0 || logger.count(debugsOf, noMatch) != 1 || logger.count(debugsOf, received) != 1 {
		t.Fatalf("a facts-only event logged at Info: %v", logger.infos)
	}
	if client.appliedCount() != 1 {
		t.Fatalf("applied %d batches, want 1", client.appliedCount())
	}

	// A dashboard simulation never counts toward a fact, so facts do not
	// listen for it and its trail stays at Info.
	app.handleTriggerEvent([]byte(`{"id":"p2","type":"chat.presence","source":"api","platform":"twitch","data":{"chatterId":"u1"}}`), "chat.presence")
	if logger.count(infosOf, noMatch) != 1 || logger.count(infosOf, received) != 1 {
		t.Fatalf("a simulated event did not log at Info: %v", logger.infos)
	}

	app.handleTriggerEvent([]byte(`{"id":"r1","type":"channel.raid","source":"twitch","data":{}}`), "channel.raid")
	if logger.count(infosOf, noMatch) != 2 || logger.count(infosOf, received) != 2 {
		t.Fatalf("an event nothing listens for did not log at Info: %v", logger.infos)
	}
}

func TestFactWriteIsCancelledWithTheApp(t *testing.T) {
	client := &fakeFactClient{defs: []facts.FactDefinition{countChatters(1, "message.user.twitch")}}
	app, ran := factApp(t, client, &factLogger{})
	ctx, cancel := context.WithCancel(context.Background())
	app.factCtx = ctx
	var writeErr error
	client.onApply = func(ctx context.Context) { writeErr = ctx.Err() }

	cancel()
	app.handleTriggerEvent(chatPayload("e1", "u1"), "message.user.twitch")

	awaitRuns(t, ran, 1)
	if !errors.Is(writeErr, context.Canceled) {
		t.Fatalf("the write's context was %v after the app stopped, want canceled", writeErr)
	}
}

func TestProjectFactsLogsASourceErrorOncePerRevision(t *testing.T) {
	client := &fakeFactClient{defs: []facts.FactDefinition{countChatters(1, "message.user.twitch")}}
	logger := &factLogger{}
	app, ran := factApp(t, client, logger)
	const message = "Fact source cannot read its trigger's events"

	for i := 0; i < 3; i++ {
		app.handleTriggerEvent(chatPayload(fmt.Sprintf("e%d", i), 7), "message.user.twitch")
	}
	awaitRuns(t, ran, 3)
	if n := logger.count(warnsOf, message); n != 1 {
		t.Fatalf("logged %d times for one revision, want 1", n)
	}

	if err := app.facts.Replace([]facts.FactDefinition{countChatters(2, "message.user.twitch")}); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	app.handleTriggerEvent(chatPayload("e9", 7), "message.user.twitch")
	awaitRuns(t, ran, 1)
	if n := logger.count(warnsOf, message); n != 2 {
		t.Fatalf("logged %d times across two revisions, want 2", n)
	}
}

// fakeViewerFactService is the db proxy's fact service with only the calls
// the adapter makes.
type fakeViewerFactService struct {
	dbv1.ViewerFactService
	list    *dbv1.ListFactDefinitionsResponse
	applied *dbv1.ApplyFactDeltasRequest
}

func (f *fakeViewerFactService) ListFactDefinitions(context.Context, *dbv1.ListFactDefinitionsRequest) (*dbv1.ListFactDefinitionsResponse, error) {
	return f.list, nil
}

func (f *fakeViewerFactService) ApplyFactDeltas(_ context.Context, req *dbv1.ApplyFactDeltasRequest) (*dbv1.ApplyFactDeltasResponse, error) {
	f.applied = req
	return &dbv1.ApplyFactDeltasResponse{Applied: true}, nil
}

func protoDefinition(id string, revision int64, status string, sources ...*dbv1.ResolvedFactSource) *dbv1.FactDefinition {
	return &dbv1.FactDefinition{
		Id:         id,
		Revision:   revision,
		Status:     status,
		Definition: `{"sources":[],"aggregate":{"fn":"sum"}}`,
		Sources:    sources,
	}
}

func TestViewerFactClientDecodesDefinitions(t *testing.T) {
	bits := &dbv1.ResolvedFactSource{
		Trigger:       "twitch:trigger:cheer",
		Event:         "cheer.channel.twitch",
		SubjectPath:   "userId",
		AnonymousWhen: "isAnonymous",
		DisplayName:   "userName",
		ValuePath:     "bits",
		Where:         `{"any":[{"path":"bits","op":"gte","value":100},{"not":{"path":"message","op":"contains","value":"x"}}]}`,
	}
	gifts := &dbv1.ResolvedFactSource{
		Trigger:        "twitch:trigger:gift",
		Event:          "gift.channel.twitch",
		SubjectPath:    "recipientIds",
		SubjectIsArray: true,
		DisplayName:    "userName",
		ValuePath:      "count",
	}
	misspelled := &dbv1.ResolvedFactSource{
		Trigger:     "twitch:trigger:cheer",
		Event:       "cheer.channel.twitch",
		SubjectPath: "userId",
		Where:       `{"alll":[]}`,
	}
	notCanonical := &dbv1.ResolvedFactSource{Trigger: "cheer", Event: "cheer.channel.twitch", SubjectPath: "userId"}
	unresolved := &dbv1.ResolvedFactSource{Trigger: "twitch:trigger:missing", SubjectPath: "userId", Where: "not json"}

	service := &fakeViewerFactService{list: &dbv1.ListFactDefinitionsResponse{Definitions: []*dbv1.FactDefinition{
		protoDefinition("user:fact:bits", 3, facts.StatusActive, bits, gifts),
		protoDefinition("user:fact:misspelled", 1, facts.StatusActive, misspelled),
		protoDefinition("user:fact:short", 1, facts.StatusActive, notCanonical),
		protoDefinition("user:fact:unresolved", 1, facts.StatusUnresolved, unresolved),
	}}}
	logger := &factLogger{}
	client := newViewerFactClient(service, logger)

	defs, err := client.ListFactDefinitions(context.Background())
	if err != nil {
		t.Fatalf("ListFactDefinitions: %v", err)
	}
	if len(defs) != 4 {
		t.Fatalf("got %d definitions, want 4", len(defs))
	}

	active := defs[0]
	if active.Status != facts.StatusActive || active.Revision != 3 || active.Aggregate.Fn != facts.AggregateSum {
		t.Fatalf("active definition = %+v", active)
	}
	cheer := active.Sources[0]
	if cheer.EventPattern != "cheer.channel.twitch" || cheer.IdentityPath != "userId" ||
		cheer.AnonymousWhenPath != "isAnonymous" || cheer.DisplayNamePath != "userName" || cheer.Value != "bits" {
		t.Fatalf("cheer source = %+v", cheer)
	}
	if cheer.Where == nil || len(cheer.Where.Any) != 2 || cheer.Where.Any[1].Not == nil || cheer.Where.Any[0].Value != float64(100) {
		t.Fatalf("cheer where = %+v", cheer.Where)
	}
	if gift := active.Sources[1]; gift.DisplayNamePath != "" || gift.Where != nil {
		t.Fatalf("a fan-out source kept a display name or a where: %+v", gift)
	}

	for _, def := range defs[1:3] {
		if def.Status != facts.StatusInvalid || def.Sources != nil || def.StatusReason == "" {
			t.Fatalf("unreadable active definition not marked invalid: %+v", def)
		}
	}
	if !strings.Contains(defs[2].StatusReason, "{moduleId}:trigger:{manifestId}") {
		t.Fatalf("reason = %q", defs[2].StatusReason)
	}
	if defs[3].Status != facts.StatusUnresolved || defs[3].Sources != nil {
		t.Fatalf("unresolved definition = %+v", defs[3])
	}

	projector := facts.NewProjector(client)
	if err := projector.Replace(defs); err != nil {
		t.Fatalf("the decoded definitions do not compile: %v", err)
	}
	if got := strings.Join(projector.Patterns(), ","); got != "cheer.channel.twitch,gift.channel.twitch" {
		t.Fatalf("patterns = %s, want only the active definition's", got)
	}

	const notCounting = "Fact definition is not counting"
	if n := logger.count(warnsOf, notCounting); n != 3 {
		t.Fatalf("logged %d definitions as not counting, want 3", n)
	}
	if _, err := client.ListFactDefinitions(context.Background()); err != nil {
		t.Fatalf("ListFactDefinitions: %v", err)
	}
	if n := logger.count(warnsOf, notCounting); n != 3 {
		t.Fatalf("an unchanged list logged again (%d)", n)
	}
	service.list.Definitions[3].Revision = 2
	if _, err := client.ListFactDefinitions(context.Background()); err != nil {
		t.Fatalf("ListFactDefinitions: %v", err)
	}
	if n := logger.count(warnsOf, notCounting); n != 4 {
		t.Fatalf("a new revision was not logged (%d)", n)
	}
}

func TestViewerFactClientEncodesDeltas(t *testing.T) {
	service := &fakeViewerFactService{}
	client := newViewerFactClient(service, &factLogger{})
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	one := 1.0

	err := client.ApplyFactDeltas(context.Background(), &facts.ApplyFactDeltasRequest{
		Source:       "twitch",
		EventID:      "e1",
		OccurredAt:   at,
		SessionStamp: "s1",
		Deltas: []facts.FactDelta{
			{FactID: "f", Revision: 2, Platform: "twitch", SubjectID: "u1", SubjectName: "Ann", Op: "count", Num: &one},
			{FactID: "f", Revision: 2, Platform: "twitch", SubjectID: "u2", Op: "count", Num: &one},
		},
	})
	if err != nil {
		t.Fatalf("ApplyFactDeltas: %v", err)
	}
	req := service.applied
	if req.Source != "twitch" || req.EventId != "e1" || req.SessionStamp != "s1" || !req.OccurredAt.AsTime().Equal(at) {
		t.Fatalf("request = %+v", req)
	}
	if req.Deltas[0].GetSubjectName() != "Ann" || req.Deltas[0].GetNum() != 1 || req.Deltas[0].Revision != 2 {
		t.Fatalf("first delta = %+v", req.Deltas[0])
	}
	if req.Deltas[1].SubjectName != nil {
		t.Fatalf("a delta without a name sent one: %+v", req.Deltas[1])
	}
}

// fakePatternRegistrar records the owners registered with it.
type fakePatternRegistrar struct {
	mu      sync.Mutex
	owners  map[string]string
	failFor string
	// calls is every Register and Unregister, in order.
	calls []string
}

func (f *fakePatternRegistrar) Register(ownerID string, trigger *types.TriggerConfig) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if trigger.Event == f.failFor {
		return errors.New("bus refused")
	}
	f.calls = append(f.calls, "+"+trigger.Event)
	f.owners[ownerID] = trigger.Event
	return nil
}

func (f *fakePatternRegistrar) Unregister(ownerID string, trigger *types.TriggerConfig) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, "-"+trigger.Event)
	delete(f.owners, ownerID)
	return nil
}

func (f *fakePatternRegistrar) snapshot() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	owners := make(map[string]struct{}, len(f.owners))
	for owner, pattern := range f.owners {
		if owner != factSubscriptionOwnerPrefix+pattern {
			return "owner " + owner + " holds " + pattern
		}
		owners[owner] = struct{}{}
	}
	return strings.Join(sortedKeys(owners), ",")
}

func newTestReloader(client *fakeFactClient, registrar *fakePatternRegistrar) *factReloader {
	r := newFactReloader(facts.NewProjector(client), newFactSubscriptions(registrar), &factLogger{})
	r.interval = time.Hour
	r.settle = time.Millisecond
	r.minBackoff = time.Millisecond
	r.maxBackoff = 5 * time.Millisecond
	return r
}

func TestFactReloaderSyncsSubscriptionsToDefinitions(t *testing.T) {
	client := &fakeFactClient{defs: []facts.FactDefinition{
		countChatters(1, "message.user.twitch"),
		{
			ID: "user:fact:cheers", Revision: 1, Status: facts.StatusActive,
			Aggregate: facts.Aggregate{Fn: facts.AggregateCount},
			Sources:   []facts.FactSource{{Trigger: "twitch:trigger:cheer", EventPattern: "cheer.*.twitch", IdentityPath: "userId"}},
		},
	}}
	registrar := &fakePatternRegistrar{owners: map[string]string{}}
	r := newTestReloader(client, registrar)

	if !r.reload(context.Background()) {
		t.Fatal("reload failed")
	}
	if got := registrar.snapshot(); got != "facts:cheer.*.twitch,facts:message.user.twitch" {
		t.Fatalf("owners = %s", got)
	}

	registrar.calls = nil
	client.defs = []facts.FactDefinition{countChatters(2, "message.user.*")}
	if !r.reload(context.Background()) {
		t.Fatal("reload failed")
	}
	if got := registrar.snapshot(); got != "facts:message.user.*" {
		t.Fatalf("owners after a reload = %s", got)
	}
	if got := strings.Join(registrar.calls, " "); got != "+message.user.* -cheer.*.twitch -message.user.twitch" {
		t.Fatalf("calls = %s, want the new pattern registered before the old ones are released", got)
	}

	logger := r.logger.(*factLogger)
	const unavailable = "Fact definitions unavailable; retrying"
	client.listErr = errors.New("connection refused")
	for i := 0; i < 3; i++ {
		if r.reload(context.Background()) {
			t.Fatal("a failed list reported success")
		}
	}
	if n := logger.count(warnsOf, unavailable); n != 1 {
		t.Fatalf("one list failure logged %d times, want once", n)
	}
	if got := registrar.snapshot(); got != "facts:message.user.*" {
		t.Fatalf("a failed list changed the subscriptions: %s", got)
	}
	client.listErr = errors.New("connection reset")
	r.reload(context.Background())
	if n := logger.count(warnsOf, unavailable); n != 2 {
		t.Fatalf("a different list failure was not logged (%d)", n)
	}

	const notSubscribed = "Fact event pattern not subscribed; its events go uncounted"
	client.listErr = nil
	client.defs = []facts.FactDefinition{countChatters(3, "message.user.twitch")}
	registrar.failFor = "message.user.twitch"
	for i := 0; i < 3; i++ {
		if !r.reload(context.Background()) {
			t.Fatal("a refused subscription failed the reload, which would retry it at list-failure speed")
		}
	}
	if n := logger.count(errorsOf, notSubscribed); n != 1 {
		t.Fatalf("one refused pattern logged %d times, want once", n)
	}
	registrar.failFor = ""
	if !r.reload(context.Background()) {
		t.Fatal("reload failed")
	}
	if got := registrar.snapshot(); got != "facts:message.user.twitch" {
		t.Fatalf("a refused subscription was not retried: %s", got)
	}
}

// recordingSubscriber is a bus for the real event registrar: it delivers a
// subject to every live subscription on it.
type recordingSubscriber struct {
	mu       sync.Mutex
	handlers map[*recordingSubscription]func([]byte, string)
	subjects map[*recordingSubscription]string
}

type recordingSubscription struct {
	parent *recordingSubscriber
}

func (s *recordingSubscription) Unsubscribe() error {
	s.parent.mu.Lock()
	defer s.parent.mu.Unlock()
	delete(s.parent.handlers, s)
	delete(s.parent.subjects, s)
	return nil
}

func (r *recordingSubscriber) Subscribe(subject string, handler func([]byte, string)) (triggers.Subscription, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	sub := &recordingSubscription{parent: r}
	r.handlers[sub] = handler
	r.subjects[sub] = subject
	return sub, nil
}

func (r *recordingSubscriber) deliver(subject string) int {
	r.mu.Lock()
	var handlers []func([]byte, string)
	for sub, handler := range r.handlers {
		if r.subjects[sub] == subject {
			handlers = append(handlers, handler)
		}
	}
	r.mu.Unlock()
	for _, handler := range handlers {
		handler(nil, subject)
	}
	return len(handlers)
}

// A workflow and a fact on one pattern share the registrar's subscription;
// the fact going away must not take the workflow's events with it.
func TestFactSubscriptionsShareTheRegistrarWithWorkflows(t *testing.T) {
	bus := &recordingSubscriber{
		handlers: map[*recordingSubscription]func([]byte, string){},
		subjects: map[*recordingSubscription]string{},
	}
	delivered := 0
	registrar := triggers.NewEventTriggerRegistrar(bus, func([]byte, string) { delivered++ }, nil)
	const pattern = "message.user.twitch"
	if err := registrar.Register("wf-chat", &types.TriggerConfig{Type: "event", Event: pattern}); err != nil {
		t.Fatalf("Register: %v", err)
	}
	subscriptions := newFactSubscriptions(registrar)

	if failed := subscriptions.sync([]string{pattern}); len(failed) != 0 {
		t.Fatalf("sync: %v", failed)
	}
	if n := bus.deliver(pattern); n != 1 {
		t.Fatalf("%d subscriptions on %s, want the one shared subscription", n, pattern)
	}

	if failed := subscriptions.sync(nil); len(failed) != 0 {
		t.Fatalf("sync: %v", failed)
	}
	if n := bus.deliver(pattern); n != 1 || delivered != 2 {
		t.Fatalf("after the fact left: %d subscriptions, %d deliveries; the workflow lost its events", n, delivered)
	}
}

// breakerClock is a settable clock for factWriteBreaker.
type breakerClock struct {
	at time.Time
}

func (c *breakerClock) now() time.Time { return c.at }

func TestFactWriteBreakerPausesWritesToAnUnreachableProxy(t *testing.T) {
	unreachable := &url.Error{Op: "Post", URL: "http://db", Err: errors.New("connection refused")}
	client := &fakeFactClient{applyErr: unreachable}
	logger := &factLogger{}
	clock := &breakerClock{at: time.Unix(0, 0)}
	breaker := newFactWriteBreaker(client, logger)
	breaker.now = clock.now
	write := func() error {
		return breaker.ApplyFactDeltas(context.Background(), &facts.ApplyFactDeltasRequest{EventID: "e"})
	}
	const paused, resumed = "Fact writes paused; db proxy unreachable", "Fact writes resumed"

	for i := 0; i < breaker.threshold; i++ {
		if err := write(); !errors.Is(err, unreachable) {
			t.Fatalf("write %d: %v", i, err)
		}
	}
	if err := write(); !errors.Is(err, errFactWritesPaused) || client.appliedCount() != breaker.threshold {
		t.Fatalf("after %d failures the write was sent (%v)", breaker.threshold, err)
	}
	if logger.count(errorsOf, paused) != 1 {
		t.Fatal("pausing was not logged once")
	}

	clock.at = clock.at.Add(breaker.cooldown)
	if err := write(); !errors.Is(err, unreachable) {
		t.Fatalf("the trial write after the cooldown was not sent: %v", err)
	}
	if err := write(); !errors.Is(err, errFactWritesPaused) {
		t.Fatalf("a failed trial did not pause again: %v", err)
	}
	if logger.count(errorsOf, paused) != 1 {
		t.Fatal("a failed trial logged the pause again")
	}

	clock.at = clock.at.Add(breaker.cooldown)
	client.applyErr = nil
	if err := write(); err != nil {
		t.Fatalf("the proxy came back but the write failed: %v", err)
	}
	if logger.count(infosOf, resumed) != 1 {
		t.Fatal("resuming was not logged once")
	}

	// An error the proxy answered with says it is reachable.
	client.applyErr = errors.New("invalid_argument")
	for i := 0; i < breaker.threshold*2; i++ {
		_ = write()
	}
	if err := write(); errors.Is(err, errFactWritesPaused) {
		t.Fatal("errors the proxy answered with paused writes")
	}
}

func TestIsUnreachable(t *testing.T) {
	// The generated client wraps a refused connection in its own error type;
	// it must still read as unreachable.
	refused := newViewerFactClient(dbv1.NewViewerFactServiceProtobufClient("http://127.0.0.1:1", newFactHTTPClient()), &factLogger{})
	refusedErr := refused.ApplyFactDeltas(context.Background(), &facts.ApplyFactDeltasRequest{Source: "twitch", EventID: "e"})
	if refusedErr == nil || !isUnreachable(refusedErr) {
		t.Fatalf("a refused connection (%v) is not unreachable", refusedErr)
	}

	for _, tc := range []struct {
		err  error
		want bool
	}{
		{nil, false},
		{context.DeadlineExceeded, true},
		{fmt.Errorf("apply: %w", &url.Error{Op: "Post", URL: "http://db", Err: errors.New("refused")}), true},
		{errors.New("internal: db locked"), false},
	} {
		if got := isUnreachable(tc.err); got != tc.want {
			t.Errorf("isUnreachable(%v) = %v, want %v", tc.err, got, tc.want)
		}
	}
}

func TestFactReloaderRetriesUntilTheDbAnswersThenFollowsRequests(t *testing.T) {
	client := &fakeFactClient{listErr: errors.New("connection refused")}
	registrar := &fakePatternRegistrar{owners: map[string]string{}}
	r := newTestReloader(client, registrar)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		r.Run(ctx)
		close(done)
	}()
	defer func() {
		cancel()
		<-done
	}()

	awaitOwners := func(want string) {
		t.Helper()
		deadline := time.Now().Add(2 * time.Second)
		for registrar.snapshot() != want {
			if time.Now().After(deadline) {
				t.Fatalf("owners = %q, want %q", registrar.snapshot(), want)
			}
			time.Sleep(time.Millisecond)
		}
	}

	time.Sleep(10 * time.Millisecond)
	client.mu.Lock()
	client.listErr = nil
	client.defs = []facts.FactDefinition{countChatters(1, "message.user.twitch")}
	client.mu.Unlock()
	awaitOwners("facts:message.user.twitch")

	client.mu.Lock()
	client.defs = []facts.FactDefinition{countChatters(2, "chat.presence")}
	client.mu.Unlock()
	for i := 0; i < 5; i++ {
		r.Request()
	}
	awaitOwners("facts:chat.presence")
}
