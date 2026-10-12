package facts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// apiSource is the CloudEvents source the api republishes dashboard
// simulations under. A simulated event is not something a viewer did, so it
// never counts toward a fact. Must match API_SOURCE in
// api/src/user-event-recorder.ts.
const apiSource = "api"

// Projector turns events into fact deltas and sends them to the db. Safe for
// concurrent use: definitions are swapped in whole and events only read them.
type Projector struct {
	client Client
	index  atomic.Pointer[index]
	now    func() time.Time
	// replaceMu orders listing and swapping, so a list that started earlier
	// can never overwrite the index built from a later one.
	replaceMu sync.Mutex
}

// NewProjector returns a projector with no definitions; it produces nothing
// until Load or Replace gives it some.
func NewProjector(client Client) *Projector {
	if client == nil {
		panic("facts: NewProjector needs a client")
	}
	p := &Projector{client: client, now: time.Now}
	p.index.Store(&index{exact: map[string][]*compiledSource{}})
	return p
}

// Load lists the definitions from the db and replaces the projector's with
// them. See Replace for what an error after a successful list means.
func (p *Projector) Load(ctx context.Context) error {
	p.replaceMu.Lock()
	defer p.replaceMu.Unlock()
	defs, err := p.client.ListFactDefinitions(ctx)
	if err != nil {
		return fmt.Errorf("list fact definitions: %w", err)
	}
	return p.replaceLocked(defs)
}

// Replace compiles defs and swaps them in. Definitions that do not compile
// are left out and named in the returned error; the rest are in use either
// way.
func (p *Projector) Replace(defs []FactDefinition) error {
	p.replaceMu.Lock()
	defer p.replaceMu.Unlock()
	return p.replaceLocked(defs)
}

func (p *Projector) replaceLocked(defs []FactDefinition) error {
	idx, err := buildIndex(defs)
	p.index.Store(idx)
	return err
}

// Patterns returns every event pattern an active definition listens for, the
// subjects the projector needs to receive.
func (p *Projector) Patterns() []string {
	return append([]string(nil), p.index.Load().patterns...)
}

// Project sends the db every delta the event causes, in one call, and makes
// no call when it causes none. listened reports whether the event is one a
// definition counts from at all, whether or not it passed the definition's
// filters. An error from a single source (a value of the wrong type) is a
// *SourceError, returned alongside the deltas of every other source rather
// than in place of them.
func (p *Projector) Project(ctx context.Context, event *types.Event) (listened bool, err error) {
	req, listened, projectErr := p.request(event)
	if req == nil {
		return listened, projectErr
	}
	if err := p.client.ApplyFactDeltas(ctx, req); err != nil {
		return listened, errors.Join(fmt.Errorf("apply fact deltas for event %s: %w", event.ID, err), projectErr)
	}
	return listened, projectErr
}

// Request builds the batch for one event, or nil when the event causes no
// delta.
func (p *Projector) Request(event *types.Event) (*ApplyFactDeltasRequest, error) {
	req, _, err := p.request(event)
	return req, err
}

func (p *Projector) request(event *types.Event) (*ApplyFactDeltasRequest, bool, error) {
	if event == nil {
		panic("facts: Request needs an event")
	}
	// A dry run must not change anything, and an event without a platform
	// cannot name the viewer a fact belongs to.
	if event.Source == apiSource || event.DryRun || event.Platform == "" {
		return nil, false, nil
	}
	idx := p.index.Load()
	sources := idx.sourcesFor(event.Type)
	if len(sources) == 0 {
		return nil, false, nil
	}

	occurredAt := event.Time
	if occurredAt.IsZero() {
		occurredAt = p.now()
	}
	pe := &projection{
		idx:        idx,
		event:      event,
		occurredAt: occurredAt,
		atoms:      make([]atomResult, len(idx.atoms)),
	}
	var errs []error
	for _, cs := range sources {
		if err := pe.project(cs); err != nil {
			errs = append(errs, &SourceError{FactID: cs.factID, Revision: cs.revision, Trigger: cs.source.Trigger, Err: err})
		}
	}
	err := errors.Join(errs...)
	if len(pe.deltas) == 0 {
		return nil, true, err
	}
	return &ApplyFactDeltasRequest{
		Source:       event.Source,
		EventID:      event.ID,
		OccurredAt:   occurredAt,
		SessionStamp: event.SessionID,
		Deltas:       pe.deltas,
	}, true, err
}

// SourceError is a source of a definition that could not read an event: a
// value of the wrong type at one of its paths. It is a property of the
// definition and the trigger's payload rather than of one event, so the same
// error recurs on every matching event until the definition's Revision
// changes.
type SourceError struct {
	FactID   string
	Revision int64
	Trigger  string
	Err      error
}

func (e *SourceError) Error() string {
	return fmt.Sprintf("fact %s from %s: %v", e.FactID, e.Trigger, e.Err)
}

func (e *SourceError) Unwrap() error {
	return e.Err
}

type atomResult int8

const (
	atomUndecided atomResult = iota
	atomFalse
	atomTrue
)

// deltaKey is one viewer's fact. Several sources of one definition can match
// the same event for the same viewer; the event still counts once.
type deltaKey struct {
	factID    string
	subjectID string
}

// projection is the state of projecting one event.
type projection struct {
	idx        *index
	event      *types.Event
	occurredAt time.Time
	atoms      []atomResult
	// identities caches subjects by identity path, since every definition
	// counting the same trigger reads the same one.
	identities map[string]identityRead
	seen       map[deltaKey]struct{}
	deltas     []FactDelta
}

type identityRead struct {
	subjects []subject
	err      error
}

func (pe *projection) project(cs *compiledSource) error {
	data := pe.event.Data
	if cs.source.Where != nil {
		matched, err := cs.source.Where.EvaluateAtoms(func(atom *expression.ConditionTree) (bool, error) {
			slot, ok := cs.atomIDs[atom]
			if !ok {
				panic(fmt.Sprintf("facts: atom %s of fact %s has no pooled slot", atom.Path, cs.factID))
			}
			return pe.decide(slot)
		})
		if err != nil || !matched {
			return err
		}
	}
	if cs.source.AnonymousWhenPath != "" {
		if anonymous, _ := lookup(data, cs.source.AnonymousWhenPath); anonymous == true {
			return nil
		}
	}
	subjects, err := pe.subjects(cs.source)
	if err != nil || len(subjects) == 0 {
		return err
	}
	num, str, ok, err := pe.value(cs)
	if err != nil || !ok {
		return err
	}
	if pe.seen == nil {
		pe.seen = make(map[deltaKey]struct{})
	}
	for _, subject := range subjects {
		key := deltaKey{factID: cs.factID, subjectID: subject.id}
		if _, dup := pe.seen[key]; dup {
			continue
		}
		pe.seen[key] = struct{}{}
		pe.deltas = append(pe.deltas, FactDelta{
			FactID:      cs.factID,
			Revision:    cs.revision,
			Platform:    pe.event.Platform,
			SubjectID:   subject.id,
			SubjectName: subject.name,
			Op:          cs.fn,
			Num:         num,
			Str:         str,
		})
	}
	return nil
}

// decide returns a pooled atom's result for this event, evaluating it the
// first time any source asks.
func (pe *projection) decide(slot int) (bool, error) {
	switch pe.atoms[slot] {
	case atomTrue:
		return true, nil
	case atomFalse:
		return false, nil
	}
	atom := pe.idx.atoms[slot]
	actual, _ := lookup(pe.event.Data, atom.path)
	var matched bool
	if atom.re != nil {
		// Same reading of the value as the operator's own regex check, with
		// the pattern compiled once per index instead of once per event.
		switch v := actual.(type) {
		case nil:
			matched = false
		case string:
			matched = atom.re.MatchString(v)
		default:
			matched = atom.re.MatchString(fmt.Sprintf("%v", v))
		}
	} else {
		var err error
		matched, err = expression.EvaluateAtomValue(atom.op, actual, atom.expected)
		if err != nil {
			return false, err
		}
	}
	if matched {
		pe.atoms[slot] = atomTrue
	} else {
		pe.atoms[slot] = atomFalse
	}
	return matched, nil
}

type subject struct {
	id   string
	name string
}

// subjects reads the viewer ids a source names: one id, or a list of ids to
// fan out to. An event without the id is not about a viewer and yields none,
// and an empty or null entry in a list is passed over.
func (pe *projection) subjects(src FactSource) ([]subject, error) {
	key := src.IdentityPath + "\x00" + src.DisplayNamePath
	if read, ok := pe.identities[key]; ok {
		return read.subjects, read.err
	}
	subjects, err := readSubjects(pe.event.Data, src)
	if pe.identities == nil {
		pe.identities = make(map[string]identityRead)
	}
	pe.identities[key] = identityRead{subjects: subjects, err: err}
	return subjects, err
}

func readSubjects(data map[string]any, src FactSource) ([]subject, error) {
	raw, found := lookup(data, src.IdentityPath)
	if !found || raw == nil {
		return nil, nil
	}
	switch ids := raw.(type) {
	case string:
		if ids == "" {
			return nil, nil
		}
		s := subject{id: ids}
		if src.DisplayNamePath != "" {
			name, _ := lookup(data, src.DisplayNamePath)
			s.name, _ = name.(string)
		}
		return []subject{s}, nil
	case []any:
		out := make([]subject, 0, len(ids))
		for i, item := range ids {
			if item == nil {
				continue
			}
			id, ok := item.(string)
			if !ok {
				return nil, fmt.Errorf("identity %s[%d] is %T, not a string", src.IdentityPath, i, item)
			}
			if id == "" {
				continue
			}
			out = append(out, subject{id: id})
		}
		return out, nil
	default:
		return nil, fmt.Errorf("identity %s is %T, not a string or a list", src.IdentityPath, raw)
	}
}

// value is what one delta of the source carries. ok is false when the event
// has no value to aggregate, which skips the source for this event.
func (pe *projection) value(cs *compiledSource) (num *float64, str *string, ok bool, err error) {
	switch cs.fn {
	case AggregateCount:
		return float(1), nil, true, nil
	case AggregateFirstAt, AggregateLastAt, AggregateSessions, AggregateSessionStreak:
		return float(float64(pe.occurredAt.UnixMilli())), nil, true, nil
	}

	raw, found := lookup(pe.event.Data, cs.valuePath)
	if !found || raw == nil {
		return nil, nil, false, nil
	}
	if n, isNum := toFloat64(raw); isNum {
		return float(n), nil, true, nil
	}
	if cs.fn != AggregateLast {
		return nil, nil, false, fmt.Errorf("%s value %s is %T, not a number", cs.fn, cs.valuePath, raw)
	}
	switch v := raw.(type) {
	case string:
		return nil, &v, true, nil
	case bool:
		s := strconv.FormatBool(v)
		return nil, &s, true, nil
	default:
		encoded, err := json.Marshal(v)
		if err != nil {
			return nil, nil, false, fmt.Errorf("last value %s does not encode: %w", cs.valuePath, err)
		}
		s := string(encoded)
		return nil, &s, true, nil
	}
}

// lookup reads a path from event data, reporting whether it was there.
func lookup(data map[string]any, path string) (any, bool) {
	v, err := expression.ResolvePath(data, path)
	if err != nil {
		return nil, false
	}
	return v, true
}

func float(n float64) *float64 {
	return &n
}

func toFloat64(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}
