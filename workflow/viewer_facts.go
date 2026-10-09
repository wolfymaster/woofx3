package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/facts"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	// factApplyTimeout bounds the fact write that sits in front of workflow
	// dispatch for every event a definition matches. A db proxy slower than
	// this may cost the event its fact deltas, never its workflows.
	factApplyTimeout = time.Second

	// Fact definitions change when one is saved or deleted, and when a
	// trigger a definition reads is registered or deregistered, since that
	// changes whether the definition resolves.
	subjectDbViewerFactPattern    = "db.viewer.fact.>"
	subjectDbModuleTriggerPattern = "db.module.trigger.>"

	// factSubscriptionOwnerPrefix namespaces the projector's patterns among
	// the workflow ids that own subscriptions in the event registrar.
	factSubscriptionOwnerPrefix = "facts:"
)

// errFactDefinitionsUnavailable marks a failure to list the definitions at
// all, as distinct from a list in which some definitions do not compile. The
// first leaves the projector as it was and is worth retrying soon.
var errFactDefinitionsUnavailable = errors.New("fact definitions unavailable")

// viewerFactClient adapts the db proxy's ViewerFactService to facts.Client.
type viewerFactClient struct {
	db     dbv1.ViewerFactService
	logger tasks.Logger

	mu sync.Mutex
	// reported is, per fact id, the revision and status last seen, so that a
	// definition that is not counting is logged when that changes rather than
	// on every list.
	reported map[string]string
}

func newViewerFactClient(db dbv1.ViewerFactService, logger tasks.Logger) *viewerFactClient {
	if db == nil {
		panic("viewer facts: newViewerFactClient needs a db client")
	}
	if logger == nil {
		panic("viewer facts: newViewerFactClient needs a logger")
	}
	return &viewerFactClient{db: db, logger: logger, reported: make(map[string]string)}
}

func (c *viewerFactClient) ListFactDefinitions(ctx context.Context) ([]facts.FactDefinition, error) {
	resp, err := c.db.ListFactDefinitions(ctx, &dbv1.ListFactDefinitionsRequest{})
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errFactDefinitionsUnavailable, err)
	}
	defs := make([]facts.FactDefinition, 0, len(resp.GetDefinitions()))
	for _, in := range resp.GetDefinitions() {
		defs = append(defs, decodeFactDefinition(in))
	}
	c.reportStatuses(defs)
	return defs, nil
}

func (c *viewerFactClient) ApplyFactDeltas(ctx context.Context, req *facts.ApplyFactDeltasRequest) error {
	deltas := make([]*dbv1.FactDelta, len(req.Deltas))
	for i, d := range req.Deltas {
		delta := &dbv1.FactDelta{
			FactId:    d.FactID,
			Revision:  d.Revision,
			Platform:  d.Platform,
			SubjectId: d.SubjectID,
			Op:        d.Op,
			Num:       d.Num,
			Str:       d.Str,
		}
		if d.SubjectName != "" {
			name := d.SubjectName
			delta.SubjectName = &name
		}
		deltas[i] = delta
	}
	_, err := c.db.ApplyFactDeltas(ctx, &dbv1.ApplyFactDeltasRequest{
		Source:       req.Source,
		EventId:      req.EventID,
		OccurredAt:   timestamppb.New(req.OccurredAt),
		SessionStamp: req.SessionStamp,
		Silent:       req.Silent,
		Deltas:       deltas,
	})
	return err
}

// reportStatuses logs each definition that is not counting, once per
// revision and status, and forgets definitions that are gone.
func (c *viewerFactClient) reportStatuses(defs []facts.FactDefinition) {
	c.mu.Lock()
	defer c.mu.Unlock()
	listed := make(map[string]struct{}, len(defs))
	for i := range defs {
		def := &defs[i]
		listed[def.ID] = struct{}{}
		state := fmt.Sprintf("%d\x00%s\x00%s", def.Revision, def.Status, def.StatusReason)
		if c.reported[def.ID] == state {
			continue
		}
		c.reported[def.ID] = state
		if def.Status != facts.StatusActive {
			c.logger.Warn("Fact definition is not counting",
				"fact", def.ID,
				"revision", def.Revision,
				"status", def.Status,
				"reason", def.StatusReason)
		}
	}
	for id := range c.reported {
		if _, ok := listed[id]; !ok {
			delete(c.reported, id)
		}
	}
}

// decodeFactDefinition converts a listed definition. An active definition the
// db sent in a shape this service cannot read is reported invalid here, so
// that it is skipped and named rather than counted wrongly.
func decodeFactDefinition(in *dbv1.FactDefinition) facts.FactDefinition {
	def := facts.FactDefinition{
		ID:           in.GetId(),
		Revision:     in.GetRevision(),
		Status:       in.GetStatus(),
		StatusReason: in.GetReason(),
	}
	if def.Status != facts.StatusActive {
		return def
	}
	if err := decodeActiveDefinition(in, &def); err != nil {
		def.Status = facts.StatusInvalid
		def.StatusReason = err.Error()
		def.Aggregate = facts.Aggregate{}
		def.Sources = nil
	}
	return def
}

// factDefinitionBody is the part of the stored definition body the projector
// needs beyond the resolved sources. Must match FactDefinitionBody in
// db/database/models/viewer_fact.go.
type factDefinitionBody struct {
	Aggregate struct {
		Fn string `json:"fn"`
	} `json:"aggregate"`
}

// factAggregateFn reads the aggregate function out of the stored body.
func factAggregateFn(in *dbv1.FactDefinition) (string, error) {
	var body factDefinitionBody
	if err := json.Unmarshal([]byte(in.GetDefinition()), &body); err != nil {
		return "", fmt.Errorf("definition body: %w", err)
	}
	return body.Aggregate.Fn, nil
}

func decodeActiveDefinition(in *dbv1.FactDefinition, def *facts.FactDefinition) error {
	fn, err := factAggregateFn(in)
	if err != nil {
		return err
	}
	def.Aggregate = facts.Aggregate{Fn: fn}
	def.Sources = make([]facts.FactSource, len(in.GetSources()))
	for i, src := range in.GetSources() {
		if !isCanonicalTriggerID(src.GetTrigger()) {
			return fmt.Errorf("sources[%d]: trigger %q is not `{moduleId}:trigger:{manifestId}`", i, src.GetTrigger())
		}
		if src.GetEvent() == "" {
			return fmt.Errorf("sources[%d] (%s): active but its trigger has no event", i, src.GetTrigger())
		}
		where, err := decodeWhere(src.GetWhere())
		if err != nil {
			return fmt.Errorf("sources[%d] (%s): where: %w", i, src.GetTrigger(), err)
		}
		source := facts.FactSource{
			Trigger:           src.GetTrigger(),
			EventPattern:      src.GetEvent(),
			IdentityPath:      src.GetSubjectPath(),
			AnonymousWhenPath: src.GetAnonymousWhen(),
			Where:             where,
			Value:             src.GetValuePath(),
		}
		// A list of viewer ids carries no names to pair with them.
		if !src.GetSubjectIsArray() {
			source.DisplayNamePath = src.GetDisplayName()
		}
		def.Sources[i] = source
	}
	return nil
}

// decodeWhere reads a source's condition tree. Unknown keys are refused: a
// misspelled `all` read as an empty tree would match every event.
func decodeWhere(raw string) (*expression.ConditionTree, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	decoder := json.NewDecoder(bytes.NewReader([]byte(raw)))
	decoder.DisallowUnknownFields()
	var tree *expression.ConditionTree
	if err := decoder.Decode(&tree); err != nil {
		return nil, err
	}
	return tree, nil
}

func isCanonicalTriggerID(id string) bool {
	parts := strings.Split(id, ":")
	return len(parts) == 3 && parts[0] != "" && parts[1] == "trigger" && parts[2] != ""
}

// factPatternRegistrar is the part of triggers.EventTriggerRegistrar the
// projector's subscriptions use. Sharing it with workflows means a subject
// both listen on has one bus subscription.
type factPatternRegistrar interface {
	Register(ownerID string, trigger *types.TriggerConfig) error
	Unregister(ownerID string, trigger *types.TriggerConfig) error
}

// factSubscriptions keeps one registrar owner per event pattern the
// projector listens for.
type factSubscriptions struct {
	registrar  factPatternRegistrar
	mu         sync.Mutex
	registered map[string]struct{}
}

func newFactSubscriptions(registrar factPatternRegistrar) *factSubscriptions {
	if registrar == nil {
		panic("viewer facts: newFactSubscriptions needs a registrar")
	}
	return &factSubscriptions{registrar: registrar, registered: make(map[string]struct{})}
}

// sync makes the registered patterns exactly patterns, and returns the error
// of each pattern it could not subscribe or unsubscribe. A pattern that fails
// to register is left out and retried by the next sync. New patterns are
// registered before old ones are released, so that events of a subject an old
// and a new pattern both match keep arriving across the change.
func (s *factSubscriptions) sync(patterns []string) map[string]error {
	s.mu.Lock()
	defer s.mu.Unlock()
	wanted := make(map[string]struct{}, len(patterns))
	for _, pattern := range patterns {
		wanted[pattern] = struct{}{}
	}
	failed := make(map[string]error)
	for _, pattern := range sortedKeys(wanted) {
		if _, done := s.registered[pattern]; done {
			continue
		}
		if err := s.registrar.Register(factSubscriptionOwnerPrefix+pattern, factTrigger(pattern)); err != nil {
			failed[pattern] = fmt.Errorf("subscribe: %w", err)
			continue
		}
		s.registered[pattern] = struct{}{}
	}
	for _, pattern := range sortedKeys(s.registered) {
		if _, keep := wanted[pattern]; keep {
			continue
		}
		delete(s.registered, pattern)
		if err := s.registrar.Unregister(factSubscriptionOwnerPrefix+pattern, factTrigger(pattern)); err != nil {
			failed[pattern] = fmt.Errorf("unsubscribe: %w", err)
		}
	}
	return failed
}

func factTrigger(pattern string) *types.TriggerConfig {
	return &types.TriggerConfig{Type: "event", Event: pattern}
}

func sortedKeys(set map[string]struct{}) []string {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// factReloader keeps the projector's definitions and subscriptions current.
// It lists on start, retrying with backoff until the db proxy answers, again
// on every lifecycle event that can change a definition, and on an interval
// as the safety net against a lifecycle event that never arrived. All loads
// run on its one goroutine, so they never overlap.
type factReloader struct {
	projector     *facts.Projector
	subscriptions *factSubscriptions
	logger        tasks.Logger
	interval      time.Duration
	// settle is how long a lifecycle event waits for the rest of its burst:
	// installing a module registers each of its triggers separately.
	settle     time.Duration
	minBackoff time.Duration
	maxBackoff time.Duration
	requests   chan struct{}
	// The failures last logged, so that a retry or a periodic re-list that
	// fails the same way is silent: the list failure, the compile failure,
	// and the failure per event pattern the bus would not subscribe.
	lastListErr    string
	lastCompileErr string
	lastSubErrs    map[string]string
}

func newFactReloader(projector *facts.Projector, subscriptions *factSubscriptions, logger tasks.Logger) *factReloader {
	if projector == nil || subscriptions == nil || logger == nil {
		panic("viewer facts: newFactReloader needs a projector, subscriptions and a logger")
	}
	return &factReloader{
		projector:     projector,
		subscriptions: subscriptions,
		logger:        logger,
		interval:      5 * time.Minute,
		settle:        250 * time.Millisecond,
		minBackoff:    time.Second,
		maxBackoff:    30 * time.Second,
		requests:      make(chan struct{}, 1),
		lastSubErrs:   make(map[string]string),
	}
}

// Request asks for a reload without waiting for it. Requests made while one
// is pending are folded into it.
func (r *factReloader) Request() {
	select {
	case r.requests <- struct{}{}:
	default:
	}
}

// Run blocks until ctx is cancelled.
func (r *factReloader) Run(ctx context.Context) {
	backoff := r.minBackoff
	for {
		wait := r.interval
		if r.reload(ctx) {
			backoff = r.minBackoff
		} else {
			wait = backoff
			backoff = min(backoff*2, r.maxBackoff)
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		case <-r.requests:
			timer.Stop()
			if !r.awaitBurst(ctx) {
				return
			}
		}
	}
}

// awaitBurst lets the rest of a burst of lifecycle events arrive, so that it
// costs one reload. It reports false when ctx ends first.
func (r *factReloader) awaitBurst(ctx context.Context) bool {
	timer := time.NewTimer(r.settle)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
	}
	select {
	case <-r.requests:
	default:
	}
	return true
}

// reload lists the definitions and syncs the subscriptions to them. It
// reports false only when the list failed, the one failure worth retrying
// soon. A pattern the bus would not subscribe is retried by the next reload,
// and its events go uncounted until then.
func (r *factReloader) reload(ctx context.Context) bool {
	loadCtx, cancel := context.WithTimeout(ctx, reconcileListTimeout)
	defer cancel()
	err := r.projector.Load(loadCtx)
	if errors.Is(err, errFactDefinitionsUnavailable) {
		if err.Error() != r.lastListErr {
			r.lastListErr = err.Error()
			r.logger.Warn("Fact definitions unavailable; retrying", "error", err)
		}
		return false
	}
	if r.lastListErr != "" {
		r.lastListErr = ""
		r.logger.Info("Fact definitions listed after earlier failures")
	}
	r.reportCompileErr(err)
	r.reportSubscriptionErrs(r.subscriptions.sync(r.projector.Patterns()))
	return true
}

func (r *factReloader) reportCompileErr(err error) {
	if err == nil {
		r.lastCompileErr = ""
		return
	}
	if err.Error() == r.lastCompileErr {
		return
	}
	r.lastCompileErr = err.Error()
	r.logger.Error("Fact definitions left out of the projector", "error", err)
}

func (r *factReloader) reportSubscriptionErrs(failed map[string]error) {
	for pattern := range r.lastSubErrs {
		if _, still := failed[pattern]; !still {
			delete(r.lastSubErrs, pattern)
		}
	}
	for pattern, err := range failed {
		if r.lastSubErrs[pattern] == err.Error() {
			continue
		}
		r.lastSubErrs[pattern] = err.Error()
		r.logger.Error("Fact event pattern not subscribed; its events go uncounted",
			"pattern", pattern,
			"error", err)
	}
}

// errFactWritesPaused fails a fact write without sending it, while
// factWriteBreaker considers the db proxy unreachable.
var errFactWritesPaused = errors.New("fact writes paused: db proxy unreachable")

// factWriteBreaker stops sending fact writes to a db proxy that keeps timing
// out or refusing connections. Every event a definition matches waits on its
// write before the event's workflows dispatch, so a stalled proxy would add
// the full write timeout to each of them. After threshold consecutive such
// failures it fails writes at once for cooldown, then lets them try again.
// An error the proxy answered with is not counted: it says the proxy is up.
type factWriteBreaker struct {
	client    facts.Client
	logger    tasks.Logger
	threshold int
	cooldown  time.Duration
	now       func() time.Time

	mu        sync.Mutex
	failures  int
	open      bool
	openUntil time.Time
}

func newFactWriteBreaker(client facts.Client, logger tasks.Logger) *factWriteBreaker {
	if client == nil || logger == nil {
		panic("viewer facts: newFactWriteBreaker needs a client and a logger")
	}
	return &factWriteBreaker{
		client:    client,
		logger:    logger,
		threshold: 5,
		cooldown:  30 * time.Second,
		now:       time.Now,
	}
}

func (b *factWriteBreaker) ListFactDefinitions(ctx context.Context) ([]facts.FactDefinition, error) {
	return b.client.ListFactDefinitions(ctx)
}

func (b *factWriteBreaker) ApplyFactDeltas(ctx context.Context, req *facts.ApplyFactDeltasRequest) error {
	if !b.allow() {
		return errFactWritesPaused
	}
	err := b.client.ApplyFactDeltas(ctx, req)
	// A write cut short by shutdown says nothing about the proxy.
	if errors.Is(ctx.Err(), context.Canceled) {
		return err
	}
	b.record(isUnreachable(err))
	return err
}

func (b *factWriteBreaker) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return !b.open || !b.now().Before(b.openUntil)
}

func (b *factWriteBreaker) record(unreachable bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !unreachable {
		b.failures = 0
		if b.open {
			b.open = false
			b.logger.Info("Fact writes resumed")
		}
		return
	}
	b.failures++
	if b.open {
		// The trial write after a cooldown failed as well.
		b.openUntil = b.now().Add(b.cooldown)
		return
	}
	if b.failures >= b.threshold {
		b.open = true
		b.openUntil = b.now().Add(b.cooldown)
		b.logger.Error("Fact writes paused; db proxy unreachable",
			"consecutive_failures", b.failures,
			"retry_in", b.cooldown)
	}
}

// isUnreachable reports whether a write failed without the proxy answering:
// a timeout, or a request the transport could not complete. The db client
// wraps both, but keeps them reachable through errors.Is and errors.As.
func isUnreachable(err error) bool {
	if err == nil {
		return false
	}
	var urlErr *url.Error
	return errors.Is(err, context.DeadlineExceeded) || errors.As(err, &urlErr)
}

// factErrorLog logs a projection error that is a property of a definition
// rather than of one event once per definition revision and source, where
// logging it per event would log it for every chat message.
type factErrorLog struct {
	mu sync.Mutex
	// logged is the revision last logged, per fact and source trigger.
	logged map[string]int64
}

func newFactErrorLog() *factErrorLog {
	return &factErrorLog{logged: make(map[string]int64)}
}

// first reports whether err has not been logged for its revision yet, and
// records that it now has.
func (l *factErrorLog) first(err *facts.SourceError) bool {
	key := err.FactID + "\x00" + err.Trigger
	l.mu.Lock()
	defer l.mu.Unlock()
	if revision, seen := l.logged[key]; seen && revision == err.Revision {
		return false
	}
	l.logged[key] = err.Revision
	return true
}

// splitSourceErrors separates the per-source errors in a projection error
// from the rest, descending only through joined errors: a source error is
// never wrapped inside another error by the projector.
func splitSourceErrors(err error) (sourceErrs []*facts.SourceError, others []error) {
	var walk func(error)
	walk = func(err error) {
		if err == nil {
			return
		}
		if sourceErr, ok := err.(*facts.SourceError); ok {
			sourceErrs = append(sourceErrs, sourceErr)
			return
		}
		if joined, ok := err.(interface{ Unwrap() []error }); ok {
			for _, inner := range joined.Unwrap() {
				walk(inner)
			}
			return
		}
		others = append(others, err)
	}
	walk(err)
	return sourceErrs, others
}

// projectFacts applies the fact deltas an event causes, and reports whether
// a definition listens for the event. It runs before the event reaches the
// engine so that a workflow the event starts reads facts that already include
// it. A failure costs the event its deltas only: it is logged and the event
// still goes on to the engine.
func (a *WorkflowApp) projectFacts(event *types.Event) bool {
	if a.facts == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(a.factCtx, factApplyTimeout)
	defer cancel()
	listened, err := a.facts.Project(ctx, event)
	if err == nil {
		return listened
	}
	sourceErrs, others := splitSourceErrors(err)
	for _, sourceErr := range sourceErrs {
		if a.factErrors.first(sourceErr) {
			a.logger.Warn("Fact source cannot read its trigger's events",
				"fact", sourceErr.FactID,
				"revision", sourceErr.Revision,
				"trigger", sourceErr.Trigger,
				"error", sourceErr.Err,
				"event_id", event.ID)
		}
	}
	for _, other := range others {
		// The breaker logged when it paused writes; an event skipped while
		// they are paused is not worth a line of its own.
		if errors.Is(other, errFactWritesPaused) {
			continue
		}
		a.logger.Error("Failed to apply fact deltas",
			"error", other,
			"type", event.Type,
			"id", event.ID)
	}
	return listened
}
