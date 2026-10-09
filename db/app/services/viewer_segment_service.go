package services

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// Segment statuses, resolved on every read.
const (
	segmentStatusActive  = "active"
	segmentStatusInvalid = "invalid"
)

const maxSegmentIDLength = 255

// segmentFact is what evaluating a segment needs of a fact it reads.
type segmentFact struct {
	valueKind  string
	windowKind string
	// active is false when the fact's definition does not resolve against the
	// triggers registered now. A segment reading it is then frozen (see
	// segmentFrozen).
	active bool
}

func (s *viewerFactService) UpsertSegmentDefinition(ctx context.Context, req *client.UpsertSegmentDefinitionRequest) (*client.SegmentDefinitionResponse, error) {
	id := strings.TrimSpace(req.Id)
	if id == "" {
		return nil, twirp.RequiredArgumentError("id")
	}
	if len(id) > maxSegmentIDLength {
		return nil, twirp.InvalidArgumentError("id", fmt.Sprintf("must be at most %d characters", maxSegmentIDLength))
	}
	if _, kind, _, err := parseCanonicalID(id); err != nil || kind != "segment" {
		return nil, twirp.InvalidArgumentError("id", fmt.Sprintf("expected a segment id `{owner}:segment:{slug}`, got %q", id))
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, twirp.RequiredArgumentError("name")
	}
	createdByType, err := parseCreatedByType(req.CreatedByType)
	if err != nil {
		return nil, twirp.InvalidArgumentError("created_by_type", err.Error())
	}

	condition, canonical, err := parseSegmentCondition(req.When)
	if err != nil {
		return nil, twirp.InvalidArgumentError("when", err.Error())
	}
	factIDs := condition.facts()
	facts, err := loadSegmentFacts(s.segments, s.triggers, factIDs)
	if err != nil {
		return nil, twirp.InternalErrorWith(err)
	}
	if err := condition.checkFacts(facts); err != nil {
		return nil, twirp.InvalidArgumentError("when", err.Error())
	}

	stored, write, err := s.segments.UpsertDefinition(&models.SegmentDefinition{
		ID:            id,
		Name:          name,
		Description:   req.Description,
		Condition:     canonical,
		WindowKind:    segmentWindow(factIDs, facts),
		TimeRelative:  condition.timeRelative(),
		CreatedByType: createdByType,
		CreatedByRef:  req.CreatedByRef,
	}, factIDs, s.recordSegmentChange("upserted"))
	if errors.Is(err, repo.ErrSegmentDefinitionOwned) {
		return nil, twirp.NewError(twirp.FailedPrecondition, err.Error())
	}
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("save segment definition %s: %w", id, err))
	}

	message := map[repo.SegmentDefinitionWrite]string{
		repo.SegmentDefinitionUnchanged: "Segment definition unchanged",
		repo.SegmentDefinitionCreated:   "Segment definition created; its members were filled",
		repo.SegmentDefinitionRenamed:   "Segment definition renamed",
		repo.SegmentDefinitionRevised:   "Segment definition revised; its members were refilled",
	}[write]
	return &client.SegmentDefinitionResponse{
		Status:     &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: message},
		Definition: segmentDefinitionToProto(stored, factIDs, facts),
	}, nil
}

func (s *viewerFactService) DeleteSegmentDefinition(ctx context.Context, req *client.DeleteSegmentDefinitionRequest) (*client.ResponseStatus, error) {
	if req.Id == "" {
		return nil, twirp.RequiredArgumentError("id")
	}
	err := s.segments.DeleteDefinition(req.Id, s.recordSegmentChange("deleted"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, twirp.NotFoundError(fmt.Sprintf("no segment definition %q", req.Id))
	}
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("delete segment definition %s: %w", req.Id, err))
	}
	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Segment definition deleted"}, nil
}

func (s *viewerFactService) ListSegmentDefinitions(ctx context.Context, req *client.ListSegmentDefinitionsRequest) (*client.ListSegmentDefinitionsResponse, error) {
	definitions, err := s.segments.ListDefinitions()
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("list segment definitions: %w", err))
	}
	ids := make([]string, len(definitions))
	for i, definition := range definitions {
		ids[i] = definition.ID
	}
	read, err := s.segments.FactsRead(ids)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("list segment facts: %w", err))
	}
	var factIDs []string
	for _, ids := range read {
		factIDs = append(factIDs, ids...)
	}
	slices.Sort(factIDs)
	facts, err := loadSegmentFacts(s.segments, s.triggers, slices.Compact(factIDs))
	if err != nil {
		return nil, twirp.InternalErrorWith(err)
	}
	out := make([]*client.SegmentDefinition, len(definitions))
	for i, definition := range definitions {
		out[i] = segmentDefinitionToProto(definition, read[definition.ID], facts)
	}
	return &client.ListSegmentDefinitionsResponse{
		Status:      &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Segment definitions retrieved"},
		Definitions: out,
	}, nil
}

func (s *viewerFactService) GetViewerSegments(ctx context.Context, req *client.GetViewerSegmentsRequest) (*client.GetViewerSegmentsResponse, error) {
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
	rows, err := s.segments.ViewerMemberships(repo.ViewerKey{Platform: req.Platform, SubjectID: req.SubjectId})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("read viewer segments: %w", err))
	}
	out := []*client.ViewerSegment{}
	for _, row := range rows {
		current := row.WindowKey == ""
		if row.WindowKind == models.FactWindowSession {
			current = sessionID != "" && row.WindowKey == sessionID
		}
		if !current {
			continue
		}
		out = append(out, &client.ViewerSegment{
			SegmentId:    row.SegmentID,
			WindowKey:    row.WindowKey,
			EnteredAt:    timestamppb.New(row.EnteredAt),
			TimeRelative: row.TimeRelative,
		})
	}
	return &client.GetViewerSegmentsResponse{
		Status:    &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Viewer segments retrieved"},
		SessionId: sessionID,
		Segments:  out,
	}, nil
}

// recordSegmentChange runs inside a segment write's transaction: a created
// or revised segment's membership is filled silently from the stored values,
// then the `op` outbox event is written. Without a publisher it records no
// event.
func (s *viewerFactService) recordSegmentChange(op string) repo.RecordSegmentDefinitionChange {
	return func(tx *gorm.DB, definition *models.SegmentDefinition, write repo.SegmentDefinitionWrite) error {
		if write == repo.SegmentDefinitionCreated || write == repo.SegmentDefinitionRevised {
			if err := s.fillSegment(tx, definition, s.now()); err != nil {
				return fmt.Errorf("fill segment %s: %w", definition.ID, err)
			}
		}
		if s.publisher == nil {
			return nil
		}
		return s.publisher.PublishIn(tx, workers.PublishOptions{
			EntityType: "viewer.segment",
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

// refillSegmentsReading silently refills the membership of every segment
// reading factID, inside the transaction that revised the fact and deleted its
// values. The segments are locked for update, so no apply diffs their
// membership against the values while they are refilled.
func (s *viewerFactService) refillSegmentsReading(tx *gorm.DB, factID string) error {
	dependents, err := s.segments.WithDB(tx).DependentSegmentsForUpdate([]string{factID})
	if err != nil {
		return err
	}
	for _, segment := range dependents {
		if err := s.fillSegment(tx, segment, s.now()); err != nil {
			return fmt.Errorf("refill segment %s: %w", segment.ID, err)
		}
	}
	return nil
}

// fillSegment makes a segment's membership what its condition says at `now`
// for every viewer holding a value of any fact it reads, entering and leaving
// viewers without announcing them: a save is not something viewers did, and
// announcing it would run every workflow on the segment for every viewer at
// once. A viewer with no value of any fact it reads is never a member, even
// of a condition such as not_exists that such a viewer would satisfy.
//
// The segment's window follows the facts it reads, which a fact revision can
// change, so it is rewritten here when it moved. A frozen segment (see
// segmentFrozen) is left exactly as it is.
func (s *viewerFactService) fillSegment(tx *gorm.DB, segment *models.SegmentDefinition, now time.Time) error {
	segments := s.segments.WithDB(tx)
	read, err := segments.FactsRead([]string{segment.ID})
	if err != nil {
		return err
	}
	factIDs := read[segment.ID]
	facts, err := loadSegmentFacts(segments, repo.NewModuleRepository(tx), factIDs)
	if err != nil {
		return err
	}
	condition, _, err := parseSegmentCondition(segment.Condition)
	if err != nil {
		return fmt.Errorf("stored condition: %w", err)
	}
	if segmentFrozen(condition, factIDs, facts) {
		return nil
	}
	window := segmentWindow(factIDs, facts)
	if window != segment.WindowKind {
		if err := segments.SetWindowKind(segment.ID, window); err != nil {
			return err
		}
		segment.WindowKind = window
	}

	sessionID := ""
	if window == models.FactWindowSession {
		session, err := repo.NewViewerFactRepository(tx).SessionAt(now, "")
		if err != nil {
			return err
		}
		sessionID = session.ID
	}
	qualifying := map[repo.ViewerKey]bool{}
	// A session segment has no window before the first session starts, so
	// nobody is in it.
	if window == models.FactWindowLifetime || sessionID != "" {
		values, err := segments.FactValues(activeFactIDs(factIDs, facts), sessionID, nil)
		if err != nil {
			return err
		}
		for viewer, readings := range readingsByViewer(values, facts, sessionID) {
			if condition.evaluate(readings, now) {
				qualifying[viewer] = true
			}
		}
	}

	existing, err := segments.Members(segment.ID)
	if err != nil {
		return err
	}
	current := make(map[repo.ViewerKey]bool, len(existing))
	var leave []repo.ViewerKey
	for _, member := range existing {
		viewer := repo.ViewerKey{Platform: member.Platform, SubjectID: member.SubjectID}
		if !qualifying[viewer] {
			leave = append(leave, viewer)
			continue
		}
		current[viewer] = member.WindowKey == sessionID
	}
	var enter []models.SegmentMember
	for viewer := range qualifying {
		if current[viewer] {
			continue
		}
		enter = append(enter, models.SegmentMember{
			SegmentID: segment.ID,
			Platform:  viewer.Platform,
			SubjectID: viewer.SubjectID,
			WindowKey: sessionID,
			EnteredAt: now.UTC(),
		})
	}
	slices.SortFunc(enter, func(a, b models.SegmentMember) int {
		return strings.Compare(a.Platform+"\x00"+a.SubjectID, b.Platform+"\x00"+b.SubjectID)
	})
	if err := segments.EnterAll(enter); err != nil {
		return err
	}
	return segments.LeaveAll(segment.ID, leave)
}

// diffSegments runs inside an apply's transaction once its deltas are folded.
// For each viewer whose values changed, it evaluates the segments reading a
// changed fact, updates their membership, and, when `announce`, publishes an
// edge for each viewer that entered or left.
//
// A segment without a time-relative atom compares the new state with the
// stored membership, so a viewer enters once however many more events keep it
// in. A time-relative segment can change with time alone, so its stored
// membership may be stale; it compares the state before the event's changes
// with the state after, both at the event's time, and keeps the membership in
// step. That is what announces "last seen older than 30 days" as left when
// the viewer returns.
//
// A frozen segment is skipped, and a session segment is skipped for an event
// of any session but the current one (see segmentApply.sessionCurrent).
func (s *viewerFactService) diffSegments(tx *gorm.DB, batch repo.FactBatch, changes []repo.FactChange, session func() (repo.SessionRef, error), announce bool) error {
	segments := s.segments.WithDB(tx)
	changedFacts := make([]string, 0, len(changes))
	byViewer := map[repo.ViewerKey][]repo.FactChange{}
	for _, change := range changes {
		changedFacts = append(changedFacts, change.FactID)
		viewer := repo.ViewerKey{Platform: change.Platform, SubjectID: change.SubjectID}
		byViewer[viewer] = append(byViewer[viewer], change)
	}
	slices.Sort(changedFacts)
	changedFacts = slices.Compact(changedFacts)

	dependents, err := segments.DependentSegments(changedFacts)
	if err != nil || len(dependents) == 0 {
		return err
	}
	segmentIDs := make([]string, len(dependents))
	for i, segment := range dependents {
		segmentIDs[i] = segment.ID
	}
	read, err := segments.FactsRead(segmentIDs)
	if err != nil {
		return err
	}
	var factIDs []string
	for _, segment := range dependents {
		factIDs = append(factIDs, read[segment.ID]...)
	}
	slices.Sort(factIDs)
	factIDs = slices.Compact(factIDs)
	// One status resolution for every fact any reached segment reads, with
	// each trigger looked up once.
	facts, err := loadSegmentFacts(segments, repo.NewModuleRepository(tx), factIDs)
	if err != nil {
		return err
	}
	live := make([]*models.SegmentDefinition, 0, len(dependents))
	conditions := make(map[string]*segmentCondition, len(dependents))
	for _, segment := range dependents {
		condition, _, err := parseSegmentCondition(segment.Condition)
		if err != nil {
			return fmt.Errorf("segment %s: stored condition: %w", segment.ID, err)
		}
		if segmentFrozen(condition, read[segment.ID], facts) {
			continue
		}
		conditions[segment.ID] = condition
		live = append(live, segment)
	}
	if len(live) == 0 {
		return nil
	}

	apply := &segmentApply{
		service:  s,
		tx:       tx,
		segments: segments,
		batch:    batch,
		facts:    facts,
		read:     read,
		session:  session,
		announce: announce,
	}
	viewers := make([]repo.ViewerKey, 0, len(byViewer))
	for viewer := range byViewer {
		viewers = append(viewers, viewer)
	}
	// Viewer locks are taken in key order, so two applies cannot deadlock on
	// them.
	slices.SortFunc(viewers, func(a, b repo.ViewerKey) int {
		return cmp.Or(
			cmp.Compare(repo.ViewerLockKey(a), repo.ViewerLockKey(b)),
			strings.Compare(a.Platform, b.Platform),
			strings.Compare(a.SubjectID, b.SubjectID),
		)
	})
	for _, viewer := range viewers {
		if err := apply.viewer(viewer, byViewer[viewer], live, conditions); err != nil {
			return err
		}
	}
	return nil
}

// segmentFrozen reports whether a segment must be left as it is: a fact it
// reads is missing or not active, or its condition no longer fits the facts'
// kinds. Evaluating it then would move every viewer whose stored value the
// inactive fact hides, so a module upgrade that drops a trigger for a moment
// would announce a storm of edges, and another when it comes back. The
// segment resumes once everything it reads is active again.
func segmentFrozen(condition *segmentCondition, factIDs []string, facts map[string]segmentFact) bool {
	for _, id := range factIDs {
		if fact, ok := facts[id]; !ok || !fact.active {
			return true
		}
	}
	return condition.checkFacts(facts) != nil
}

// segmentApply is the segment side of one apply: what every viewer's pass
// shares, with the sessions resolved at most once and only when needed.
type segmentApply struct {
	service  *viewerFactService
	tx       *gorm.DB
	segments *repo.ViewerSegmentRepository
	batch    repo.FactBatch
	facts    map[string]segmentFact
	read     map[string][]string
	session  func() (repo.SessionRef, error)
	announce bool

	current *string
}

// eventSession is the stream session the event belongs to, as the fold
// resolved it, or "" when none had started and the event carried no stamp.
func (a *segmentApply) eventSession() (string, error) {
	session, err := a.session()
	return session.ID, err
}

// sessionCurrent reports whether the event belongs to the current stream
// session. Only then may it move a session segment's membership: an event of
// an earlier session (late, or replayed by a backfill) would otherwise
// evaluate that session's values and replace or drop a membership of the
// current one.
func (a *segmentApply) sessionCurrent() (bool, error) {
	event, err := a.eventSession()
	if err != nil || event == "" {
		return false, err
	}
	if a.current == nil {
		current, err := repo.NewViewerFactRepository(a.tx).SessionAt(a.service.now(), a.batch.SessionStamp)
		if err != nil {
			return false, err
		}
		a.current = &current.ID
	}
	return event == *a.current, nil
}

func (a *segmentApply) viewer(viewer repo.ViewerKey, changes []repo.FactChange, live []*models.SegmentDefinition, conditions map[string]*segmentCondition) error {
	changed := make(map[string]bool, len(changes))
	for _, change := range changes {
		changed[change.FactID] = true
	}
	var affected []*models.SegmentDefinition
	var needed []string
	session := ""
	for _, segment := range live {
		if !slices.ContainsFunc(a.read[segment.ID], func(id string) bool { return changed[id] }) {
			continue
		}
		if segmentWindow(a.read[segment.ID], a.facts) == models.FactWindowSession {
			current, err := a.sessionCurrent()
			if err != nil {
				return err
			}
			if !current {
				continue
			}
			if session, err = a.eventSession(); err != nil {
				return err
			}
		}
		affected = append(affected, segment)
		needed = append(needed, a.read[segment.ID]...)
	}
	if len(affected) == 0 {
		return nil
	}
	slices.Sort(needed)
	needed = slices.Compact(needed)

	if err := a.segments.LockViewer(viewer); err != nil {
		return err
	}
	values, err := a.segments.FactValues(needed, session, &viewer)
	if err != nil {
		return err
	}
	after := readingsByViewer(values, a.facts, session)[viewer]
	if after == nil {
		after = map[string]*factReading{}
	}
	before := make(map[string]*factReading, len(after))
	for id, reading := range after {
		before[id] = reading
	}
	viewerName := ""
	for _, change := range changes {
		if viewerName == "" && change.SubjectName != nil {
			viewerName = *change.SubjectName
		}
		fact, ok := a.facts[change.FactID]
		if !ok || change.WindowKey != factWindowKey(fact, session) {
			continue
		}
		before[change.FactID] = readingOf(change.Before)
	}

	affectedIDs := make([]string, len(affected))
	for i, segment := range affected {
		affectedIDs[i] = segment.ID
	}
	rows, err := a.segments.ViewerMembers(viewer, affectedIDs)
	if err != nil {
		return err
	}
	stored := make(map[string]models.SegmentMember, len(rows))
	for _, row := range rows {
		stored[row.SegmentID] = row
	}

	now := a.batch.OccurredAt
	for _, segment := range affected {
		windowKey := ""
		if segmentWindow(a.read[segment.ID], a.facts) == models.FactWindowSession {
			windowKey = session
		}
		condition := conditions[segment.ID]
		isIn := condition.evaluate(after, now)
		row, hasRow := stored[segment.ID]
		member := hasRow && row.WindowKey == windowKey

		edge := ""
		if isIn && !member {
			entered, err := a.segments.Enter(models.SegmentMember{
				SegmentID: segment.ID,
				Platform:  viewer.Platform,
				SubjectID: viewer.SubjectID,
				WindowKey: windowKey,
				EnteredAt: now.UTC(),
			})
			if err != nil {
				return err
			}
			if entered {
				edge = string(cloudevents.SubjectViewerSegmentEntered)
			}
		}
		if !isIn && hasRow {
			left, err := a.segments.Leave(segment.ID, viewer)
			if err != nil {
				return err
			}
			// A row from an earlier session is not a membership, so dropping
			// it is the silent reset at a session boundary, not a leave.
			if left && member {
				edge = string(cloudevents.SubjectViewerSegmentLeft)
			}
		}
		if segment.TimeRelative {
			edge = ""
			wasIn := condition.evaluate(before, now)
			if !wasIn && isIn {
				edge = string(cloudevents.SubjectViewerSegmentEntered)
			}
			if wasIn && !isIn {
				edge = string(cloudevents.SubjectViewerSegmentLeft)
			}
		}
		if edge == "" || !a.announce || a.service.publisher == nil {
			continue
		}
		// The edge names the event's session even for a lifetime segment;
		// resolving it only here keeps it off the path of events that move
		// nobody.
		eventSession, err := a.eventSession()
		if err != nil {
			return err
		}
		edgeData := a.edgeEvent(segment.ID, viewer, viewerName, eventSession, before, after)
		if err := a.service.publisher.PublishEventIn(a.tx, edge, segment.ID, edgeExtensions(viewer, eventSession), edgeData); err != nil {
			return err
		}
	}
	return nil
}

// segmentEdgeEvent is the data of viewer.segment.entered and
// viewer.segment.left.
type segmentEdgeEvent struct {
	SegmentID  string                     `json:"segmentId"`
	Platform   string                     `json:"platform"`
	ViewerID   string                     `json:"viewerId"`
	ViewerName string                     `json:"viewerName"`
	SessionID  string                     `json:"sessionId"`
	Facts      map[string]segmentEdgeFact `json:"facts"`
	Cause      segmentEdgeCause           `json:"cause"`
}

// segmentEdgeFact is one fact the segment reads, before and after the event:
// a number (timestamps in epoch milliseconds), a string, or null for a value
// the viewer does not have.
type segmentEdgeFact struct {
	Before any `json:"before"`
	After  any `json:"after"`
}

type segmentEdgeCause struct {
	Source  string `json:"source"`
	EventID string `json:"eventId"`
}

// edgeExtensions are the CloudEvent extensions an edge carries besides its
// data: the workflow service reads an event's platform and stream session
// from the envelope.
func edgeExtensions(viewer repo.ViewerKey, session string) map[string]string {
	extensions := map[string]string{"platform": viewer.Platform}
	if session != "" {
		extensions["sessionid"] = session
	}
	return extensions
}

func (a *segmentApply) edgeEvent(segmentID string, viewer repo.ViewerKey, viewerName, session string, before, after map[string]*factReading) segmentEdgeEvent {
	facts := make(map[string]segmentEdgeFact, len(a.read[segmentID]))
	for _, id := range a.read[segmentID] {
		kind := a.facts[id].valueKind
		facts[id] = segmentEdgeFact{Before: plainReading(before[id], kind), After: plainReading(after[id], kind)}
	}
	return segmentEdgeEvent{
		SegmentID:  segmentID,
		Platform:   viewer.Platform,
		ViewerID:   viewer.SubjectID,
		ViewerName: viewerName,
		SessionID:  session,
		Facts:      facts,
		Cause:      segmentEdgeCause{Source: a.batch.Source, EventID: a.batch.EventID},
	}
}

func plainReading(reading *factReading, valueKind string) any {
	if reading == nil {
		return nil
	}
	if valueKind == models.FactValueKindString {
		if reading.str == nil {
			return nil
		}
		return *reading.str
	}
	if reading.num == nil {
		return nil
	}
	return *reading.num
}

func readingOf(state *repo.FactValueState) *factReading {
	if state == nil {
		return nil
	}
	return &factReading{num: state.Num, str: state.Str}
}

// loadSegmentFacts reads the named facts' kinds and resolves whether each is
// active. A fact that does not exist is absent from the result.
func loadSegmentFacts(segments *repo.ViewerSegmentRepository, triggers activeTriggers, ids []string) (map[string]segmentFact, error) {
	definitions, err := segments.FactDefinitions(ids)
	if err != nil {
		return nil, fmt.Errorf("read segment facts: %w", err)
	}
	triggers = newMemoTriggers(triggers)
	out := make(map[string]segmentFact, len(definitions))
	for id, definition := range definitions {
		resolved, err := resolveStoredFact(triggers, definition.Definition, definition.WindowKind, definition.ValueKind)
		if err != nil {
			return nil, fmt.Errorf("resolve fact %s: %w", id, err)
		}
		out[id] = segmentFact{
			valueKind:  definition.ValueKind,
			windowKind: definition.WindowKind,
			active:     resolved.status == factStatusActive,
		}
	}
	return out, nil
}

// segmentWindow is `session` when any of the facts is kept per session.
func segmentWindow(factIDs []string, facts map[string]segmentFact) string {
	for _, id := range factIDs {
		if facts[id].windowKind == models.FactWindowSession {
			return models.FactWindowSession
		}
	}
	return models.FactWindowLifetime
}

// factWindowKey is the window a fact's current value is kept under.
func factWindowKey(fact segmentFact, session string) string {
	if fact.windowKind == models.FactWindowSession {
		return session
	}
	return ""
}

func activeFactIDs(ids []string, facts map[string]segmentFact) []string {
	active := make([]string, 0, len(ids))
	for _, id := range ids {
		if facts[id].active {
			active = append(active, id)
		}
	}
	return active
}

// readingsByViewer groups values by viewer, keeping each fact's value in its
// current window only and leaving out facts that are not active.
func readingsByViewer(values []models.FactValue, facts map[string]segmentFact, session string) map[repo.ViewerKey]map[string]*factReading {
	out := map[repo.ViewerKey]map[string]*factReading{}
	for _, value := range values {
		fact, ok := facts[value.FactID]
		if !ok || !fact.active || value.WindowKey != factWindowKey(fact, session) {
			continue
		}
		viewer := repo.ViewerKey{Platform: value.Platform, SubjectID: value.SubjectID}
		if out[viewer] == nil {
			out[viewer] = map[string]*factReading{}
		}
		out[viewer][value.FactID] = &factReading{num: value.NumValue, str: value.StrValue}
	}
	return out
}

func segmentDefinitionToProto(definition *models.SegmentDefinition, factIDs []string, facts map[string]segmentFact) *client.SegmentDefinition {
	out := &client.SegmentDefinition{
		Id:            definition.ID,
		Name:          definition.Name,
		Description:   definition.Description,
		When:          definition.Condition,
		Facts:         factIDs,
		WindowKind:    definition.WindowKind,
		TimeRelative:  definition.TimeRelative,
		Revision:      definition.Revision,
		CreatedByType: definition.CreatedByType,
		CreatedByRef:  definition.CreatedByRef,
		CreatedAt:     timestamppb.New(definition.CreatedAt),
		UpdatedAt:     timestamppb.New(definition.UpdatedAt),
		Status:        segmentStatusActive,
	}
	if out.Facts == nil {
		out.Facts = []string{}
	}
	condition, _, err := parseSegmentCondition(definition.Condition)
	if err == nil {
		err = condition.checkFacts(facts)
	}
	if err != nil {
		out.Status = segmentStatusInvalid
		out.Reason = err.Error()
	}
	return out
}
