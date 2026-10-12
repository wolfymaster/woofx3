package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// viewerFactService implements `client.ViewerFactService` (Twirp-generated).
//
// Definitions are validated against the `emits` of the triggers they read,
// at save and again whenever they are listed, since a module upgrade can
// change what a trigger emits after a definition was saved against it.
//
// Outbox publishing is opt-in via `publisher`. When set, every definition
// write records a `db.viewer.fact.<op>.system` event in the write's
// transaction, which is how the workflow service learns to recompile.
type viewerFactService struct {
	facts     *repo.ViewerFactRepository
	triggers  *repo.ModuleRepository
	publisher *workers.EventPublisher
	now       func() time.Time
}

func NewViewerFactService(
	facts *repo.ViewerFactRepository,
	triggers *repo.ModuleRepository,
	publisher *workers.EventPublisher,
) client.ViewerFactService {
	return &viewerFactService{
		facts:     facts,
		triggers:  triggers,
		publisher: publisher,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

// Provenances a definition may be saved under. Only a module-declared
// definition may name a trigger that is not registered: a module can declare
// a fact over another module's trigger before that module is installed, but
// a fact saved from the UI over a missing trigger would silently count
// nothing.
const (
	factCreatedByUser   = "USER"
	factCreatedByModule = "MODULE"
	factCreatedBySystem = "SYSTEM"
)

// Definition statuses, resolved on every read.
const (
	factStatusActive     = "active"
	factStatusUnresolved = "unresolved"
	factStatusInvalid    = "invalid"
)

// Column widths of the fact tables, and the session id a session stamp
// becomes as a window key. Postgres refuses a longer value and SQLite stores
// it, so they are checked here for both.
const (
	maxFactIDLength       = 255
	maxFactPlatformLength = 50
	maxFactSubjectLength  = 100
	maxFactEventIDLength  = 255
	maxFactSessionLength  = 100
)

// Identity annotation values on an emits field. They must match
// DATA_SHAPE_IDENTITIES in barkloader/lib_module/src/module_manifest.rs.
const emitsIdentityViewer = "viewer"

func (s *viewerFactService) UpsertFactDefinition(ctx context.Context, req *client.UpsertFactDefinitionRequest) (*client.FactDefinitionResponse, error) {
	id := strings.TrimSpace(req.Id)
	if id == "" {
		return nil, twirp.RequiredArgumentError("id")
	}
	if len(id) > maxFactIDLength {
		return nil, twirp.InvalidArgumentError("id", fmt.Sprintf("must be at most %d characters", maxFactIDLength))
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, twirp.RequiredArgumentError("name")
	}
	createdByType := strings.ToUpper(strings.TrimSpace(req.CreatedByType))
	if createdByType == "" {
		createdByType = factCreatedByUser
	}
	switch createdByType {
	case factCreatedByUser, factCreatedByModule, factCreatedBySystem:
	default:
		return nil, twirp.InvalidArgumentError("created_by_type", fmt.Sprintf("must be %s, %s or %s, got %q",
			factCreatedByUser, factCreatedByModule, factCreatedBySystem, req.CreatedByType))
	}

	body, canonical, err := parseFactBody(req.Definition)
	if err != nil {
		return nil, twirp.InvalidArgumentError("definition", err.Error())
	}
	if err := validateFactShape(body, req.WindowKind); err != nil {
		return nil, twirp.InvalidArgumentError("definition", err.Error())
	}
	resolved, err := s.resolve(body)
	if err != nil {
		return nil, twirp.InternalErrorWith(err)
	}
	if resolved.status == factStatusInvalid {
		return nil, twirp.InvalidArgumentError("definition", resolved.reason)
	}
	if resolved.status == factStatusUnresolved && createdByType != factCreatedByModule {
		return nil, twirp.NewError(twirp.FailedPrecondition, resolved.reason)
	}
	if resolved.valueKind == "" {
		return nil, twirp.NewError(twirp.FailedPrecondition,
			"the value kind of a last fact comes from its value field, and none of its sources' triggers is registered")
	}

	stored, write, err := s.facts.UpsertDefinition(&models.FactDefinition{
		ID:            id,
		Name:          name,
		Description:   req.Description,
		Definition:    canonical,
		AggregateFn:   body.Aggregate.Fn,
		ValueKind:     resolved.valueKind,
		WindowKind:    req.WindowKind,
		CreatedByType: createdByType,
		CreatedByRef:  req.CreatedByRef,
	}, s.recordDefinitionChange("upserted"))
	if errors.Is(err, repo.ErrFactDefinitionOwned) {
		return nil, twirp.NewError(twirp.FailedPrecondition, err.Error())
	}
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("save fact definition %s: %w", id, err))
	}

	out, err := s.definitionToProto(stored)
	if err != nil {
		return nil, twirp.InternalErrorWith(err)
	}
	message := map[repo.FactDefinitionWrite]string{
		repo.FactDefinitionUnchanged: "Fact definition unchanged",
		repo.FactDefinitionCreated:   "Fact definition created",
		repo.FactDefinitionRenamed:   "Fact definition renamed",
		repo.FactDefinitionRevised:   "Fact definition revised; its values were reset",
	}[write]
	return &client.FactDefinitionResponse{
		Status:     &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: message},
		Definition: out,
	}, nil
}

func (s *viewerFactService) DeleteFactDefinition(ctx context.Context, req *client.DeleteFactDefinitionRequest) (*client.ResponseStatus, error) {
	if req.Id == "" {
		return nil, twirp.RequiredArgumentError("id")
	}
	err := s.facts.DeleteDefinition(req.Id, s.recordDefinitionChange("deleted"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, twirp.NotFoundError(fmt.Sprintf("no fact definition %q", req.Id))
	}
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("delete fact definition %s: %w", req.Id, err))
	}
	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Fact definition deleted"}, nil
}

func (s *viewerFactService) ListFactDefinitions(ctx context.Context, req *client.ListFactDefinitionsRequest) (*client.ListFactDefinitionsResponse, error) {
	definitions, err := s.facts.ListDefinitions()
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("list fact definitions: %w", err))
	}
	out := make([]*client.FactDefinition, len(definitions))
	for i, definition := range definitions {
		out[i], err = s.definitionToProto(definition)
		if err != nil {
			return nil, twirp.InternalErrorWith(err)
		}
	}
	return &client.ListFactDefinitionsResponse{
		Status:      &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Fact definitions retrieved"},
		Definitions: out,
	}, nil
}

func (s *viewerFactService) ApplyFactDeltas(ctx context.Context, req *client.ApplyFactDeltasRequest) (*client.ApplyFactDeltasResponse, error) {
	if req.OccurredAt == nil {
		return nil, twirp.RequiredArgumentError("occurred_at")
	}
	if !req.Silent {
		if req.Source == "" {
			return nil, twirp.RequiredArgumentError("source")
		}
		if req.EventId == "" {
			return nil, twirp.RequiredArgumentError("event_id")
		}
	}
	if len(req.Source) > maxFactEventIDLength {
		return nil, twirp.InvalidArgumentError("source", fmt.Sprintf("must be at most %d characters", maxFactEventIDLength))
	}
	if len(req.EventId) > maxFactEventIDLength {
		return nil, twirp.InvalidArgumentError("event_id", fmt.Sprintf("must be at most %d characters", maxFactEventIDLength))
	}
	if len(req.SessionStamp) > maxFactSessionLength {
		return nil, twirp.InvalidArgumentError("session_stamp", fmt.Sprintf("must be at most %d characters", maxFactSessionLength))
	}
	deltas := make([]repo.FactDelta, len(req.Deltas))
	for i, in := range req.Deltas {
		if err := validateFactDelta(in); err != nil {
			return nil, twirp.InvalidArgumentError(fmt.Sprintf("deltas[%d]", i), err.Error())
		}
		// A backfill rebuilds one fact; spanning several would let one
		// replay reach facts whose own backfill state says otherwise.
		if req.Silent && in.FactId != req.Deltas[0].FactId {
			return nil, twirp.InvalidArgumentError("deltas", "a silent apply covers one fact")
		}
		deltas[i] = repo.FactDelta{
			FactID:      in.FactId,
			Revision:    in.Revision,
			Platform:    in.Platform,
			SubjectID:   in.SubjectId,
			SubjectName: in.SubjectName,
			Op:          in.Op,
			Num:         in.Num,
			Str:         in.Str,
		}
	}

	result, err := s.facts.Apply(repo.FactBatch{
		Source:       req.Source,
		EventID:      req.EventId,
		OccurredAt:   req.OccurredAt.AsTime().UTC(),
		SessionStamp: req.SessionStamp,
		SkipDedupe:   req.Silent,
		Deltas:       deltas,
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("apply fact deltas: %w", err))
	}

	changes := make([]*client.FactValueChange, len(result.Changes))
	for i, change := range result.Changes {
		changes[i] = &client.FactValueChange{
			FactId:      change.FactID,
			Platform:    change.Platform,
			SubjectId:   change.SubjectID,
			WindowKey:   change.WindowKey,
			SubjectName: change.SubjectName,
			Before:      factValueToProto(change.Before),
			After:       factValueToProto(change.After),
		}
	}
	return &client.ApplyFactDeltasResponse{
		Status:  &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Fact deltas applied"},
		Applied: result.Applied,
		Dropped: int32(result.Dropped),
		Invalid: int32(result.Invalid),
		Skipped: int32(result.Skipped),
		Changes: changes,
	}, nil
}

func (s *viewerFactService) GetViewerFacts(ctx context.Context, req *client.GetViewerFactsRequest) (*client.GetViewerFactsResponse, error) {
	if req.Platform == "" {
		return nil, twirp.RequiredArgumentError("platform")
	}
	if req.SubjectId == "" {
		return nil, twirp.RequiredArgumentError("subject_id")
	}
	sessionID, err := s.facts.SessionKeyAt(s.now(), "")
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("resolve current session: %w", err))
	}
	values, err := s.facts.ViewerValues(req.Platform, req.SubjectId, sessionID)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("read viewer facts: %w", err))
	}

	out := make([]*client.ViewerFactValue, len(values))
	var name *string
	var nameAt time.Time
	for i, value := range values {
		out[i] = &client.ViewerFactValue{
			FactId:     value.FactID,
			WindowKind: value.WindowKind,
			ValueKind:  value.ValueKind,
			Value:      &client.FactValue{Num: value.NumValue, Str: value.StrValue},
			UpdatedAt:  timestamppb.New(value.UpdatedAt),
		}
		if value.SubjectName != nil && (name == nil || value.UpdatedAt.After(nameAt)) {
			name = value.SubjectName
			nameAt = value.UpdatedAt
		}
	}
	return &client.GetViewerFactsResponse{
		Status:      &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Viewer facts retrieved"},
		SessionId:   sessionID,
		SubjectName: name,
		Values:      out,
	}, nil
}

// recordDefinitionChange writes the `op` outbox event for a definition inside
// the write's transaction. Without a publisher it records nothing.
func (s *viewerFactService) recordDefinitionChange(op string) repo.RecordFactDefinitionChange {
	return func(tx *gorm.DB, definition *models.FactDefinition) error {
		if s.publisher == nil {
			return nil
		}
		return s.publisher.PublishIn(tx, workers.PublishOptions{
			EntityType: "viewer.fact",
			EntityID:   definition.ID,
			Operation:  op,
			Data: map[string]interface{}{
				"id":       definition.ID,
				"revision": definition.Revision,
			},
			AutoAcknowledge: true,
		})
	}
}

func (s *viewerFactService) definitionToProto(definition *models.FactDefinition) (*client.FactDefinition, error) {
	out := &client.FactDefinition{
		Id:            definition.ID,
		Name:          definition.Name,
		Description:   definition.Description,
		Definition:    definition.Definition,
		ValueKind:     definition.ValueKind,
		WindowKind:    definition.WindowKind,
		Revision:      definition.Revision,
		CreatedByType: definition.CreatedByType,
		CreatedByRef:  definition.CreatedByRef,
		Aggregate:     definition.AggregateFn,
		CountingSince: timestamppb.New(definition.CountingSince),
		CreatedAt:     timestamppb.New(definition.CreatedAt),
		UpdatedAt:     timestamppb.New(definition.UpdatedAt),
		Sources:       []*client.ResolvedFactSource{},
	}
	if definition.BackfilledThrough != nil {
		out.BackfilledThrough = timestamppb.New(*definition.BackfilledThrough)
	}

	body, _, err := parseFactBody(definition.Definition)
	if err == nil {
		err = validateFactShape(body, definition.WindowKind)
	}
	if err != nil {
		out.Status = factStatusInvalid
		out.Reason = err.Error()
		return out, nil
	}
	resolved, err := s.resolve(body)
	if err != nil {
		return nil, err
	}
	out.Sources = resolved.sources
	out.Status = resolved.status
	out.Reason = resolved.reason
	if resolved.status == factStatusActive && resolved.valueKind != definition.ValueKind {
		out.Status = factStatusInvalid
		out.Reason = fmt.Sprintf("the value field is now a %s, and the fact stores a %s; save the definition again to reset it",
			resolved.valueKind, definition.ValueKind)
	}
	return out, nil
}

func factValueToProto(state *repo.FactValueState) *client.FactValue {
	if state == nil {
		return nil
	}
	return &client.FactValue{Num: state.Num, Str: state.Str}
}

func validateFactDelta(delta *client.FactDelta) error {
	switch {
	case delta.FactId == "":
		return errors.New("fact_id is required")
	case delta.Revision < 1:
		return errors.New("revision must be at least 1")
	case delta.Platform == "":
		return errors.New("platform is required")
	case len(delta.Platform) > maxFactPlatformLength:
		return fmt.Errorf("platform must be at most %d characters", maxFactPlatformLength)
	case delta.SubjectId == "":
		return errors.New("subject_id is required")
	case len(delta.SubjectId) > maxFactSubjectLength:
		return fmt.Errorf("subject_id must be at most %d characters", maxFactSubjectLength)
	case delta.SubjectName != nil && len(*delta.SubjectName) > maxFactSubjectLength:
		return fmt.Errorf("subject_name must be at most %d characters", maxFactSubjectLength)
	case !models.ValidFactAggregate(delta.Op):
		return fmt.Errorf("unknown op %q", delta.Op)
	}
	return nil
}

// parseFactBody decodes a definition body, refusing unknown keys so a
// misspelt field fails the save rather than being dropped, and returns it
// with its canonical JSON, which is what revisions are compared on.
func parseFactBody(raw string) (*models.FactDefinitionBody, string, error) {
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	var body models.FactDefinitionBody
	if err := decoder.Decode(&body); err != nil {
		return nil, "", fmt.Errorf("not a fact definition: %w", err)
	}
	if decoder.More() {
		return nil, "", errors.New("not a fact definition: trailing data after the object")
	}
	for i := range body.Sources {
		where := body.Sources[i].Where
		if len(where) == 0 {
			continue
		}
		var compact bytes.Buffer
		if err := json.Compact(&compact, where); err != nil {
			return nil, "", fmt.Errorf("sources[%d].where: %w", i, err)
		}
		if compact.String() == "null" {
			body.Sources[i].Where = nil
			continue
		}
		body.Sources[i].Where = compact.Bytes()
	}
	canonical, err := json.Marshal(&body)
	if err != nil {
		return nil, "", err
	}
	return &body, string(canonical), nil
}

// aggregateValue says what an aggregate reads from a source's value field.
type aggregateValue int

const (
	// readsNothing: count, first_at, last_at and the session aggregates fold
	// the event's occurrence, not a field of it.
	readsNothing aggregateValue = iota
	readsNumber
	readsNumberOrString
)

func aggregateReads(fn string) aggregateValue {
	switch fn {
	case models.FactAggregateSum, models.FactAggregateMin, models.FactAggregateMax:
		return readsNumber
	case models.FactAggregateLast:
		return readsNumberOrString
	default:
		return readsNothing
	}
}

// validateFactShape checks what a definition says without reading any
// trigger: the aggregate, the window, and that each source names a trigger,
// a subject, a value exactly when the aggregate reads one, and a well-formed
// condition tree.
func validateFactShape(body *models.FactDefinitionBody, windowKind string) error {
	fn := body.Aggregate.Fn
	if !models.ValidFactAggregate(fn) {
		return fmt.Errorf("aggregate.fn %q is not one of count, sum, min, max, last, first_at, last_at, sessions, session_streak", fn)
	}
	switch windowKind {
	case models.FactWindowLifetime:
	case models.FactWindowSession:
		// Within one session either aggregate is always 1.
		if fn == models.FactAggregateSessions || fn == models.FactAggregateSessionStreak {
			return fmt.Errorf("%s counts sessions, so it needs the lifetime window", fn)
		}
	default:
		return fmt.Errorf("window %q is not lifetime or session", windowKind)
	}
	if len(body.Sources) == 0 {
		return errors.New("a fact needs at least one source")
	}
	reads := aggregateReads(fn)
	for i, source := range body.Sources {
		if _, err := parseTriggerID(source.Trigger); err != nil {
			return fmt.Errorf("sources[%d].trigger: %w", i, err)
		}
		if source.Subject == "" {
			return fmt.Errorf("sources[%d].subject is required", i)
		}
		if reads == readsNothing && source.Value != "" {
			return fmt.Errorf("sources[%d].value: %s reads no value", i, fn)
		}
		if reads != readsNothing && source.Value == "" {
			return fmt.Errorf("sources[%d].value is required by %s", i, fn)
		}
		if len(source.Where) > 0 {
			tree, err := parseFactCondition(source.Where)
			if err != nil {
				return fmt.Errorf("sources[%d].where: %w", i, err)
			}
			if err := tree.validate(); err != nil {
				return fmt.Errorf("sources[%d].where: %w", i, err)
			}
		}
	}
	return nil
}

type triggerID struct {
	moduleID   string
	manifestID string
}

func parseTriggerID(canonical string) (triggerID, error) {
	moduleID, kind, manifestID, err := parseCanonicalID(canonical)
	if err != nil {
		return triggerID{}, err
	}
	if kind != "trigger" {
		return triggerID{}, fmt.Errorf("expected a trigger id `{moduleId}:trigger:{manifestId}`, got %q", canonical)
	}
	return triggerID{moduleID: moduleID, manifestID: manifestID}, nil
}

// factCondition is the condition tree a source's events must satisfy. The
// workflow service evaluates it and owns the operators; what is checked here
// is its shape and that every path it reads is one the trigger emits.
type factCondition struct {
	All   []factCondition `json:"all,omitempty"`
	Any   []factCondition `json:"any,omitempty"`
	Not   *factCondition  `json:"not,omitempty"`
	Path  string          `json:"path,omitempty"`
	Op    string          `json:"op,omitempty"`
	Value json.RawMessage `json:"value,omitempty"`
}

// parseFactCondition decodes a condition tree, refusing unknown keys on every
// node so a misspelt key fails the save rather than being dropped.
func parseFactCondition(raw json.RawMessage) (*factCondition, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var tree factCondition
	if err := decoder.Decode(&tree); err != nil {
		return nil, err
	}
	return &tree, nil
}

func (c *factCondition) validate() error {
	kinds := 0
	if c.All != nil {
		kinds++
	}
	if c.Any != nil {
		kinds++
	}
	if c.Not != nil {
		kinds++
	}
	isAtom := c.Path != "" || c.Op != "" || len(c.Value) > 0
	if isAtom {
		kinds++
	}
	if kinds != 1 {
		return fmt.Errorf("a condition node sets exactly one of all, any, not or {path, op, value}; this one sets %d", kinds)
	}
	switch {
	case c.All != nil, c.Any != nil:
		children, name := c.All, "all"
		if c.Any != nil {
			children, name = c.Any, "any"
		}
		if len(children) == 0 {
			return fmt.Errorf("%s has no conditions", name)
		}
		for i := range children {
			if err := children[i].validate(); err != nil {
				return fmt.Errorf("%s[%d]: %w", name, i, err)
			}
		}
	case c.Not != nil:
		if err := c.Not.validate(); err != nil {
			return fmt.Errorf("not: %w", err)
		}
	default:
		if c.Path == "" {
			return errors.New("condition has no path")
		}
		if c.Op == "" {
			return fmt.Errorf("%s: condition has no op", c.Path)
		}
	}
	return nil
}

func (c *factCondition) paths(into []string) []string {
	for i := range c.All {
		into = c.All[i].paths(into)
	}
	for i := range c.Any {
		into = c.Any[i].paths(into)
	}
	if c.Not != nil {
		into = c.Not.paths(into)
	}
	if c.Path != "" {
		into = append(into, c.Path)
	}
	return into
}

// emitsField is one field of a trigger's emits shape, with the identity
// annotations barkloader keeps on it (ManifestDataShapeField in
// barkloader/lib_module/src/module_manifest.rs).
type emitsField struct {
	Path          string `json:"path"`
	Type          string `json:"type"`
	Identity      string `json:"identity"`
	AnonymousWhen string `json:"anonymousWhen"`
	DisplayName   string `json:"displayName"`
}

type emitsShape struct {
	Fields []emitsField `json:"fields"`
}

func (e *emitsShape) field(path string) (emitsField, bool) {
	for _, field := range e.Fields {
		if field.Path == path {
			return field, true
		}
	}
	return emitsField{}, false
}

type resolvedFact struct {
	sources []*client.ResolvedFactSource
	status  string
	reason  string
	// valueKind is what the fact stores, or "" when it depends on a value
	// field none of whose triggers resolved.
	valueKind string
}

// resolve looks each source's trigger up and checks the source against what
// that trigger emits. A source that does not fit makes the definition
// invalid; a trigger that is not registered makes it unresolved, unless
// another source is invalid. The error is a failure to read the triggers.
func (s *viewerFactService) resolve(body *models.FactDefinitionBody) (resolvedFact, error) {
	out := resolvedFact{sources: make([]*client.ResolvedFactSource, len(body.Sources)), status: factStatusActive}
	fn := body.Aggregate.Fn
	switch aggregateReads(fn) {
	case readsNothing:
		out.valueKind = models.FactValueKindNumber
		if fn == models.FactAggregateFirstAt || fn == models.FactAggregateLastAt {
			out.valueKind = models.FactValueKindTimestamp
		}
	case readsNumber:
		out.valueKind = models.FactValueKindNumber
	}

	var unresolved []string
	for i, source := range body.Sources {
		resolved := &client.ResolvedFactSource{
			Trigger:     source.Trigger,
			SubjectPath: source.Subject,
			ValuePath:   source.Value,
			Where:       string(source.Where),
		}
		out.sources[i] = resolved

		id, err := parseTriggerID(source.Trigger)
		if err != nil {
			return invalidFact(out, fmt.Errorf("sources[%d].trigger: %w", i, err)), nil
		}
		trigger, err := s.triggers.GetActiveTriggerByModuleAndManifestID(id.moduleID, id.manifestID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			unresolved = append(unresolved, source.Trigger)
			continue
		}
		if err != nil {
			return out, fmt.Errorf("look up trigger %s: %w", source.Trigger, err)
		}
		resolved.Event = trigger.Event

		var emits emitsShape
		if err := json.Unmarshal([]byte(trigger.Emits), &emits); err != nil {
			return invalidFact(out, fmt.Errorf("sources[%d]: trigger %s emits no readable shape: %w", i, source.Trigger, err)), nil
		}
		kind, err := checkSourceAgainstEmits(source, fn, &emits, resolved)
		if err != nil {
			return invalidFact(out, fmt.Errorf("sources[%d] (%s): %w", i, source.Trigger, err)), nil
		}
		if kind != "" {
			if out.valueKind != "" && out.valueKind != kind {
				return invalidFact(out, fmt.Errorf("sources[%d].value is a %s where another source's is a %s; last keeps one kind", i, kind, out.valueKind)), nil
			}
			out.valueKind = kind
		}
	}
	if len(unresolved) > 0 {
		out.status = factStatusUnresolved
		out.reason = fmt.Sprintf("no trigger is registered as %s", strings.Join(unresolved, ", "))
	}
	return out, nil
}

func invalidFact(out resolvedFact, err error) resolvedFact {
	out.status = factStatusInvalid
	out.reason = err.Error()
	return out
}

// checkSourceAgainstEmits fills the identity annotations into resolved and
// returns the value kind the source's value field gives a `last` fact, or ""
// for any other aggregate.
func checkSourceAgainstEmits(source models.FactSource, fn string, emits *emitsShape, resolved *client.ResolvedFactSource) (string, error) {
	subject, ok := emits.field(source.Subject)
	if !ok {
		return "", fmt.Errorf("subject %q is not a field the trigger emits", source.Subject)
	}
	if subject.Identity != emitsIdentityViewer {
		return "", fmt.Errorf("subject %q does not identify a viewer; mark it \"identity\": %q in the trigger's emits", source.Subject, emitsIdentityViewer)
	}
	switch subject.Type {
	case "string":
	case "array":
		resolved.SubjectIsArray = true
	default:
		return "", fmt.Errorf("subject %q is a %s; a viewer id is a string or an array of them", source.Subject, subject.Type)
	}
	resolved.AnonymousWhen = subject.AnonymousWhen
	resolved.DisplayName = subject.DisplayName

	if len(source.Where) > 0 {
		tree, err := parseFactCondition(source.Where)
		if err != nil {
			return "", fmt.Errorf("where: %w", err)
		}
		for _, path := range tree.paths(nil) {
			if _, ok := emits.field(path); !ok {
				return "", fmt.Errorf("where reads %q, which the trigger does not emit", path)
			}
		}
	}

	reads := aggregateReads(fn)
	if reads == readsNothing {
		return "", nil
	}
	value, ok := emits.field(source.Value)
	if !ok {
		return "", fmt.Errorf("value %q is not a field the trigger emits", source.Value)
	}
	if reads == readsNumber {
		if value.Type != "number" {
			return "", fmt.Errorf("%s needs a number, and value %q is a %s", fn, source.Value, value.Type)
		}
		return "", nil
	}
	switch value.Type {
	case "number":
		return models.FactValueKindNumber, nil
	case "string":
		return models.FactValueKindString, nil
	default:
		return "", fmt.Errorf("last keeps a number or a string, and value %q is a %s", source.Value, value.Type)
	}
}
