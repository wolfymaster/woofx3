package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/eventmatch"
	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

const (
	// viewerReadTimeout bounds the fact read a trigger condition or step
	// waits on the first time it references `${viewer.*}`. A db proxy slower
	// than this leaves the viewer's facts missing for that event.
	viewerReadTimeout = time.Second

	// emitsIdentityViewer is the identity annotation on an emits field that
	// names a viewer. Must match emitsIdentityViewer in
	// db/app/services/viewer_fact_service.go.
	emitsIdentityViewer = "viewer"
)

// Keys of `${viewer.*}` that are not facts. A fact whose owner is one of
// them has no path.
const (
	viewerKeyID       = "id"
	viewerKeyPlatform = "platform"
	viewerKeyName     = "name"
)

func isReservedViewerKey(key string) bool {
	return key == viewerKeyID || key == viewerKeyPlatform || key == viewerKeyName
}

// triggerIdentity is where the viewer an event is about sits in the data of
// one trigger's events.
type triggerIdentity struct {
	trigger string
	pattern string
	// path is the emits path of the trigger's one string identity field, or
	// empty when the trigger does not name exactly one viewer: its identity
	// is an array, or it marks several fields.
	path string
	// anonymousWhen is the emits path of the boolean that is true when the
	// platform withheld the identity, or empty.
	anonymousWhen string
}

// triggerIdentityCatalog maps an event to the identity field of the triggers
// whose pattern matches it. Triggers that mark no identity are left out.
type triggerIdentityCatalog struct {
	entries atomic.Pointer[[]triggerIdentity]
}

func newTriggerIdentityCatalog() *triggerIdentityCatalog {
	c := &triggerIdentityCatalog{}
	c.entries.Store(&[]triggerIdentity{})
	return c
}

// emitsShape is the part of a trigger's emits the catalog reads: the identity
// annotations barkloader keeps on each field (ManifestDataShapeField in
// barkloader/lib_module/src/module_manifest.rs).
type emitsShape struct {
	Fields []struct {
		Path          string `json:"path"`
		Type          string `json:"type"`
		Identity      string `json:"identity"`
		AnonymousWhen string `json:"anonymousWhen"`
	} `json:"fields"`
}

// replace swaps the catalog for one built from triggers, and returns the
// error of each trigger whose emits it could not read. Such a trigger is left
// out, as if it marked no identity.
func (c *triggerIdentityCatalog) replace(triggers []*dbv1.Trigger) map[string]error {
	entries := make([]triggerIdentity, 0, len(triggers))
	failed := make(map[string]error)
	for _, trigger := range triggers {
		entry, marked, err := identityOf(trigger)
		if err != nil {
			failed[canonicalTriggerID(trigger)] = err
			continue
		}
		if marked {
			entries = append(entries, entry)
		}
	}
	c.entries.Store(&entries)
	return failed
}

// identityOf reads the identity annotations of a trigger's emits. marked is
// false when the trigger marks no identity field.
func identityOf(trigger *dbv1.Trigger) (entry triggerIdentity, marked bool, err error) {
	if trigger.GetEvent() == "" || strings.TrimSpace(trigger.GetEmits()) == "" {
		return triggerIdentity{}, false, nil
	}
	var shape emitsShape
	if err := json.Unmarshal([]byte(trigger.GetEmits()), &shape); err != nil {
		return triggerIdentity{}, false, fmt.Errorf("emits is not a data shape: %w", err)
	}
	entry = triggerIdentity{trigger: canonicalTriggerID(trigger), pattern: trigger.GetEvent()}
	identities := 0
	for _, field := range shape.Fields {
		if field.Identity != emitsIdentityViewer {
			continue
		}
		identities++
		if field.Type == "string" {
			entry.path = field.Path
			entry.anonymousWhen = field.AnonymousWhen
		}
	}
	if identities == 0 {
		return triggerIdentity{}, false, nil
	}
	if identities > 1 {
		entry.path = ""
		entry.anonymousWhen = ""
	}
	return entry, true, nil
}

func canonicalTriggerID(trigger *dbv1.Trigger) string {
	return trigger.GetCreatedByRef() + ":trigger:" + trigger.GetManifestId()
}

// lookup returns where the viewer sits in events of eventType. It reports
// false unless every trigger matching the event that marks an identity marks
// the same single string field: with none, or with triggers that disagree,
// the event does not say which of its fields is the viewer.
func (c *triggerIdentityCatalog) lookup(eventType string) (triggerIdentity, bool) {
	var found triggerIdentity
	matched := false
	for _, entry := range *c.entries.Load() {
		if !eventmatch.Matches(entry.pattern, eventType) {
			continue
		}
		if entry.path == "" {
			return triggerIdentity{}, false
		}
		if matched && (entry.path != found.path || entry.anonymousWhen != found.anonymousWhen) {
			return triggerIdentity{}, false
		}
		found = entry
		matched = true
	}
	return found, matched
}

// triggerCatalogReloader keeps the catalog current with the registered
// triggers, reloading on every trigger lifecycle event.
type triggerCatalogReloader struct {
	*reloadLoop
	catalog *triggerIdentityCatalog
	db      dbv1.ModuleService
	logger  tasks.Logger
	// The failures last logged, so that a retry or a periodic re-list that
	// fails the same way is silent.
	lastListErr string
	lastBad     map[string]string
}

func newTriggerCatalogReloader(catalog *triggerIdentityCatalog, db dbv1.ModuleService, logger tasks.Logger) *triggerCatalogReloader {
	if catalog == nil || db == nil || logger == nil {
		panic("viewer resolver: newTriggerCatalogReloader needs a catalog, a db client and a logger")
	}
	r := &triggerCatalogReloader{catalog: catalog, db: db, logger: logger, lastBad: make(map[string]string)}
	r.reloadLoop = newReloadLoop(r.reload)
	return r
}

func (r *triggerCatalogReloader) reload(ctx context.Context) bool {
	listCtx, cancel := context.WithTimeout(ctx, reconcileListTimeout)
	defer cancel()
	resp, err := r.db.ListTriggers(listCtx, &dbv1.ListTriggersRequest{})
	if err != nil {
		if err.Error() != r.lastListErr {
			r.lastListErr = err.Error()
			r.logger.Warn("Triggers unavailable; ${viewer.*} resolves as missing until they list", "error", err)
		}
		return false
	}
	if r.lastListErr != "" {
		r.lastListErr = ""
		r.logger.Info("Triggers listed after earlier failures")
	}
	r.reportBad(r.catalog.replace(resp.GetTriggers()))
	return true
}

func (r *triggerCatalogReloader) reportBad(failed map[string]error) {
	for trigger := range r.lastBad {
		if _, still := failed[trigger]; !still {
			delete(r.lastBad, trigger)
		}
	}
	ids := make([]string, 0, len(failed))
	for trigger := range failed {
		ids = append(ids, trigger)
	}
	sort.Strings(ids)
	for _, trigger := range ids {
		err := failed[trigger]
		if r.lastBad[trigger] == err.Error() {
			continue
		}
		r.lastBad[trigger] = err.Error()
		r.logger.Warn("Trigger's viewer cannot be read; ${viewer.*} is missing for its events",
			"trigger", trigger,
			"error", err)
	}
}

// errViewerReadsPaused marks a read skipped while the breaker considers the
// db proxy unreachable.
var errViewerReadsPaused = errors.New("viewer fact reads paused: db proxy unreachable")

// viewerFactReader is the engine's `${viewer.*}` source: the facts of the
// viewer named by the event's identity field, read from the db proxy.
type viewerFactReader struct {
	db      dbv1.ViewerFactService
	catalog *triggerIdentityCatalog
	breaker *proxyBreaker
	logger  tasks.Logger
	timeout time.Duration

	mu sync.Mutex
	// failing is set while reads fail, so that an outage is logged once
	// rather than once per run.
	failing bool
	// reserved is each fact id already logged for having an owner that is a
	// reserved key.
	reserved map[string]struct{}
}

func newViewerFactReader(db dbv1.ViewerFactService, catalog *triggerIdentityCatalog, logger tasks.Logger) *viewerFactReader {
	if db == nil || catalog == nil || logger == nil {
		panic("viewer resolver: newViewerFactReader needs a db client, a catalog and a logger")
	}
	return &viewerFactReader{
		db:       db,
		catalog:  catalog,
		breaker:  newProxyBreaker(logger, "Viewer fact reads paused; db proxy unreachable", "Viewer fact reads resumed"),
		logger:   logger,
		timeout:  viewerReadTimeout,
		reserved: make(map[string]struct{}),
	}
}

// Viewer returns `${viewer.*}` for the viewer event names: `id`, `platform`,
// `name` when the db knows the viewer's display name, and each fact the
// viewer has a value for, a fact `{owner}:fact:{slug}` at `{owner}.{slug}`.
// A session fact reads its current session's value. When the facts cannot be
// read, only `id` and `platform` are there.
func (r *viewerFactReader) Viewer(ctx context.Context, event *types.Event) map[string]any {
	subjectID, ok := r.viewerOf(event)
	if !ok {
		return nil
	}
	viewer := map[string]any{viewerKeyID: subjectID, viewerKeyPlatform: event.Platform}
	resp, err := r.read(ctx, event.Platform, subjectID)
	if err != nil {
		r.reportFailure(err, event)
		return viewer
	}
	r.reportSuccess()
	if name := resp.GetSubjectName(); name != "" {
		viewer[viewerKeyName] = name
	}
	r.reportReserved(addFactValues(viewer, resp.GetValues()))
	return viewer
}

// viewerOf returns the id of the one viewer event is about. An event without
// a platform cannot name a viewer, since a viewer id is only unique within
// its platform.
func (r *viewerFactReader) viewerOf(event *types.Event) (string, bool) {
	if event.Platform == "" {
		return "", false
	}
	identity, ok := r.catalog.lookup(event.Type)
	if !ok {
		return "", false
	}
	if identity.anonymousWhen != "" {
		if anonymous, err := expression.ResolvePath(event.Data, identity.anonymousWhen); err == nil && anonymous == true {
			return "", false
		}
	}
	raw, err := expression.ResolvePath(event.Data, identity.path)
	if err != nil {
		return "", false
	}
	id, ok := raw.(string)
	if !ok || id == "" {
		return "", false
	}
	return id, true
}

func (r *viewerFactReader) read(ctx context.Context, platform, subjectID string) (*dbv1.GetViewerFactsResponse, error) {
	if !r.breaker.allow() {
		return nil, errViewerReadsPaused
	}
	readCtx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	resp, err := r.db.GetViewerFacts(readCtx, &dbv1.GetViewerFactsRequest{Platform: platform, SubjectId: subjectID})
	r.breaker.observe(readCtx, err)
	return resp, err
}

func (r *viewerFactReader) reportFailure(err error, event *types.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failing {
		return
	}
	r.failing = true
	// The breaker logged when it paused reads.
	if errors.Is(err, errViewerReadsPaused) {
		return
	}
	r.logger.Warn("Viewer facts unreadable; ${viewer.*} facts resolve as missing",
		"error", err,
		"type", event.Type,
		"id", event.ID)
}

func (r *viewerFactReader) reportSuccess() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failing {
		r.failing = false
		r.logger.Info("Viewer facts readable again")
	}
}

// reportReserved logs, once per fact, each fact left out of `${viewer.*}`
// because its owner is a reserved key.
func (r *viewerFactReader) reportReserved(factIDs []string) {
	if len(factIDs) == 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, id := range factIDs {
		if _, logged := r.reserved[id]; logged {
			continue
		}
		r.reserved[id] = struct{}{}
		r.logger.Warn("Fact's owner is a reserved ${viewer.*} key; the fact cannot be read there",
			"fact", id,
			"reserved", []string{viewerKeyID, viewerKeyPlatform, viewerKeyName})
	}
}

// addFactValues adds each value at its fact's path, and returns the ids of
// the facts left out because their owner is a reserved key. A fact id that
// is not `{owner}:fact:{slug}` has no path and is left out too.
func addFactValues(viewer map[string]any, values []*dbv1.ViewerFactValue) (reserved []string) {
	for _, v := range values {
		parts := strings.Split(v.GetFactId(), ":")
		if len(parts) != 3 || parts[0] == "" || parts[1] != "fact" || parts[2] == "" {
			continue
		}
		owner, slug := parts[0], parts[2]
		if isReservedViewerKey(owner) {
			reserved = append(reserved, v.GetFactId())
			continue
		}
		value, ok := factValue(v)
		if !ok {
			continue
		}
		facts, _ := viewer[owner].(map[string]any)
		if facts == nil {
			facts = make(map[string]any)
			viewer[owner] = facts
		}
		facts[slug] = value
	}
	return reserved
}

// factValue is a stored value as expressions see it: a string fact's text,
// and every other kind's number, a timestamp as epoch milliseconds.
func factValue(v *dbv1.ViewerFactValue) (any, bool) {
	value := v.GetValue()
	if value == nil {
		return nil, false
	}
	if v.GetValueKind() == "string" {
		if value.Str == nil {
			return nil, false
		}
		return value.GetStr(), true
	}
	if value.Num == nil {
		return nil, false
	}
	return value.GetNum(), true
}
