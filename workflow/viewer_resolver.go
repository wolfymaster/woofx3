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
	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

const (
	// viewerReadTimeout bounds the fact read a trigger condition or step
	// waits on the first time it references `${viewer.*}`. A db proxy slower
	// than this leaves the viewer's facts unread for that event.
	viewerReadTimeout = time.Second

	// triggerCatalogStartTimeout bounds the trigger list made before
	// workflows subscribe. Until a list succeeds, every trigger condition
	// reading `${viewer.*}` fails, so start-up waits this long for one
	// rather than refusing the first events; after it, loading continues in
	// the background.
	triggerCatalogStartTimeout = 2 * time.Second

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

// triggerIdentity is where the viewer sits in the data of one trigger's
// events.
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
	// displayName is the emits path of the viewer's name, or empty.
	displayName string
}

// identityLookup is what the catalog knows about one trigger pattern.
type identityLookup int

const (
	// identityFound: the pattern's triggers name one viewer, at one path.
	identityFound identityLookup = iota
	// identityNone: no trigger with the pattern names exactly one viewer.
	identityNone
	// identityConflict: the pattern's triggers name the viewer at
	// different paths, so no path can be trusted.
	identityConflict
	// identityUnknown: the catalog has not loaded yet.
	identityUnknown
)

// triggerIdentityCatalog maps a registered trigger's event pattern to the
// identity field of the triggers registered with it. Triggers that mark no
// identity are left out.
type triggerIdentityCatalog struct {
	// entries is nil until the first load.
	entries atomic.Pointer[[]triggerIdentity]
}

func newTriggerIdentityCatalog() *triggerIdentityCatalog {
	return &triggerIdentityCatalog{}
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
		DisplayName   string `json:"displayName"`
	} `json:"fields"`
}

// replace swaps the catalog for one built from triggers, and returns the
// error of each trigger whose emits it could not read. Such a trigger is left
// out, as if it marked no identity. triggers must hold active triggers only;
// ListTriggers leaves archived ones out.
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
			entry.displayName = field.DisplayName
		}
	}
	if identities == 0 {
		return triggerIdentity{}, false, nil
	}
	if identities > 1 {
		entry.path = ""
		entry.anonymousWhen = ""
		entry.displayName = ""
	}
	return entry, true, nil
}

func canonicalTriggerID(trigger *dbv1.Trigger) string {
	return trigger.GetCreatedByRef() + ":trigger:" + trigger.GetManifestId()
}

// lookup returns where the viewer sits in the events of the triggers
// registered with pattern, the event a workflow's trigger listens for. Only
// triggers with exactly that pattern count: another trigger whose pattern
// also matches an event emits its own shape, not the one the workflow was
// written against. With a conflict, the ids of the triggers are returned.
func (c *triggerIdentityCatalog) lookup(pattern string) (triggerIdentity, identityLookup, []string) {
	entries := c.entries.Load()
	if entries == nil {
		return triggerIdentity{}, identityUnknown, nil
	}
	var matched []triggerIdentity
	for _, entry := range *entries {
		if entry.pattern == pattern {
			matched = append(matched, entry)
		}
	}
	if len(matched) == 0 {
		return triggerIdentity{}, identityNone, nil
	}
	first := matched[0]
	for _, entry := range matched[1:] {
		if entry.path != first.path || entry.anonymousWhen != first.anonymousWhen || entry.displayName != first.displayName {
			ids := make([]string, len(matched))
			for i, m := range matched {
				ids[i] = m.trigger
			}
			sort.Strings(ids)
			return triggerIdentity{}, identityConflict, ids
		}
	}
	if first.path == "" {
		return triggerIdentity{}, identityNone, nil
	}
	return first, identityFound, nil
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
			r.logger.Warn("Triggers unavailable; ${viewer.*} cannot name a viewer until they list", "error", err)
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

// errTriggersNotLoaded marks a viewer that cannot be named because the
// trigger catalog has not loaded yet.
var errTriggersNotLoaded = errors.New("triggers not listed yet")

// maxLoggedViewerErrors bounds the distinct read errors remembered as
// logged. An answered error can carry the viewer's id, so the set is cleared
// rather than left to grow with every viewer.
const maxLoggedViewerErrors = 256

// viewerFactReader is the engine's `${viewer.*}` source: the facts of the
// viewer named by the event's identity field, read from the db proxy.
type viewerFactReader struct {
	db      dbv1.ViewerFactService
	catalog *triggerIdentityCatalog
	breaker *proxyBreaker
	logger  tasks.Logger
	timeout time.Duration

	mu sync.Mutex
	// outage is set while the proxy cannot be reached, so that an outage is
	// logged once rather than once per run.
	outage bool
	// logged is each error the proxy answered with that was logged.
	logged map[string]struct{}
	// conflicts is each trigger pattern logged for triggers that disagree
	// on the viewer, with the ids of those triggers.
	conflicts map[string]string
	// reserved is each fact id already logged for having an owner that is a
	// reserved key.
	reserved map[string]struct{}
}

func newViewerFactReader(db dbv1.ViewerFactService, catalog *triggerIdentityCatalog, logger tasks.Logger) *viewerFactReader {
	if db == nil || catalog == nil || logger == nil {
		panic("viewer resolver: newViewerFactReader needs a db client, a catalog and a logger")
	}
	return &viewerFactReader{
		db:        db,
		catalog:   catalog,
		breaker:   newProxyBreaker(logger, "Viewer fact reads paused; db proxy unreachable", "Viewer fact reads resumed"),
		logger:    logger,
		timeout:   viewerReadTimeout,
		logged:    make(map[string]struct{}),
		conflicts: make(map[string]string),
		reserved:  make(map[string]struct{}),
	}
}

// Viewer returns `${viewer.*}` for the viewer event names: `id`, `platform`,
// `name` when the db or the event knows the viewer's display name, and each
// fact the viewer has a value for, a fact `{owner}:fact:{slug}` at
// `{owner}.{slug}`. A session fact reads its current session's value.
//
// It fails when the catalog has not loaded or the facts cannot be read; the
// data then holds only what the event says.
func (r *viewerFactReader) Viewer(ctx context.Context, trigger string, event *types.Event) (map[string]any, error) {
	identity, err := r.identityFor(trigger, event)
	if err != nil || identity.path == "" {
		return nil, err
	}
	subjectID, ok := viewerOf(identity, event)
	if !ok {
		return nil, nil
	}
	viewer := map[string]any{viewerKeyID: subjectID, viewerKeyPlatform: event.Platform}
	if identity.displayName != "" {
		if name, err := expression.ResolvePath(event.Data, identity.displayName); err == nil {
			if name, ok := name.(string); ok && name != "" {
				viewer[viewerKeyName] = name
			}
		}
	}
	resp, err := r.read(ctx, event.Platform, subjectID)
	if err != nil {
		r.reportFailure(err, event)
		return viewer, err
	}
	r.reportSuccess()
	if name := resp.GetSubjectName(); name != "" {
		viewer[viewerKeyName] = name
	}
	r.reportReserved(addFactValues(viewer, resp.GetValues()))
	return viewer, nil
}

// identityFor returns where the viewer sits in event, with an empty path when
// the event names no single viewer. An event without a platform cannot name a
// viewer, since a viewer id is only unique within its platform.
func (r *viewerFactReader) identityFor(trigger string, event *types.Event) (triggerIdentity, error) {
	if event.Platform == "" {
		return triggerIdentity{}, nil
	}
	identity, found, conflicting := r.catalog.lookup(trigger)
	switch found {
	case identityFound:
		return identity, nil
	case identityUnknown:
		return triggerIdentity{}, errTriggersNotLoaded
	case identityConflict:
		r.reportConflict(trigger, conflicting)
	}
	return triggerIdentity{}, nil
}

func viewerOf(identity triggerIdentity, event *types.Event) (string, bool) {
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

// reportFailure logs a failed read: an outage once until reads succeed
// again, and an error the proxy answered with once per distinct error.
func (r *viewerFactReader) reportFailure(err error, event *types.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if errors.Is(err, errViewerReadsPaused) || isUnreachable(err) {
		if r.outage {
			return
		}
		r.outage = true
		// The breaker logged when it paused reads.
		if errors.Is(err, errViewerReadsPaused) {
			return
		}
		r.logger.Warn("Viewer facts unreadable; db proxy unreachable",
			"error", err,
			"type", event.Type,
			"id", event.ID)
		return
	}
	if _, seen := r.logged[err.Error()]; seen {
		return
	}
	if len(r.logged) >= maxLoggedViewerErrors {
		clear(r.logged)
	}
	r.logged[err.Error()] = struct{}{}
	r.logger.Warn("Viewer facts read failed",
		"error", err,
		"type", event.Type,
		"id", event.ID)
}

func (r *viewerFactReader) reportSuccess() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.outage {
		r.outage = false
		r.logger.Info("Viewer facts readable again")
	}
}

// reportConflict logs, once per pattern and set of triggers, triggers that
// disagree on which field of their events names the viewer.
func (r *viewerFactReader) reportConflict(pattern string, triggers []string) {
	key := strings.Join(triggers, ",")
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conflicts[pattern] == key {
		return
	}
	r.conflicts[pattern] = key
	r.logger.Warn("Triggers disagree on which field names the viewer; ${viewer.*} is missing for their events",
		"event", pattern,
		"triggers", triggers)
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
