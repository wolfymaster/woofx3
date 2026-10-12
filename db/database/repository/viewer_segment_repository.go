package repository

import (
	"errors"
	"fmt"
	"hash/fnv"
	"slices"
	"strings"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ViewerSegmentRepository wraps gorm.DB with the segment tables: the
// definitions, the facts each reads, and the viewers in each.
//
// Its reads and writes are the primitives the segment service composes inside
// one transaction (an apply, a definition save); bind it to that transaction
// with WithDB.
type ViewerSegmentRepository struct {
	db *gorm.DB
}

func NewViewerSegmentRepository(db *gorm.DB) *ViewerSegmentRepository {
	return &ViewerSegmentRepository{db: db}
}

// Transaction runs fn in a transaction; bind the repository to it with
// WithDB.
func (r *ViewerSegmentRepository) Transaction(fn func(tx *gorm.DB) error) error {
	return r.db.Transaction(fn)
}

// WithDB returns a repository that runs on `db`, typically a transaction.
func (r *ViewerSegmentRepository) WithDB(db *gorm.DB) *ViewerSegmentRepository {
	return &ViewerSegmentRepository{db: db}
}

// ErrSegmentDefinitionOwned is returned when a definition is saved under an id
// a different creator already holds.
var ErrSegmentDefinitionOwned = errors.New("segment definition is owned by another creator")

// SegmentDefinitionWrite says what a definition write did.
type SegmentDefinitionWrite int

const (
	// SegmentDefinitionUnchanged: the stored definition was identical.
	SegmentDefinitionUnchanged SegmentDefinitionWrite = iota
	// SegmentDefinitionCreated: there was no definition with the id.
	SegmentDefinitionCreated
	// SegmentDefinitionRenamed: only the name or description changed, so the
	// revision and membership were kept.
	SegmentDefinitionRenamed
	// SegmentDefinitionRevised: the condition changed, so the revision was
	// incremented and the facts it reads rewritten.
	SegmentDefinitionRevised
	// SegmentDefinitionDeleted: the definition and its membership are gone.
	SegmentDefinitionDeleted
)

// RecordSegmentDefinitionChange runs inside a definition write's transaction
// with the definition as it stands after the write. The service uses it to
// refill membership and write the outbox entry, so the change, its
// membership and its announcement commit or roll back together. Returning an
// error rolls the write back.
type RecordSegmentDefinitionChange func(tx *gorm.DB, definition *models.SegmentDefinition, write SegmentDefinitionWrite) error

func (r *ViewerSegmentRepository) GetDefinition(id string) (*models.SegmentDefinition, error) {
	var definition models.SegmentDefinition
	if err := r.db.Where("id = ?", id).First(&definition).Error; err != nil {
		return nil, err
	}
	return &definition, nil
}

// ListDefinitions returns every definition ordered by id.
func (r *ViewerSegmentRepository) ListDefinitions() ([]*models.SegmentDefinition, error) {
	definitions := []*models.SegmentDefinition{}
	err := r.db.Order("id ASC").Find(&definitions).Error
	return definitions, err
}

// UpsertDefinition stores `in` under its id, with factIDs as the facts its
// condition reads, and returns the stored row.
//
// A change to Condition is a new revision: the revision increments and the
// segment's facts are rewritten. Conditions are compared as JSON values,
// since Postgres stores JSONB in its own key order and spacing. WindowKind
// and TimeRelative are written on every change, as they follow from the
// condition and the facts it reads.
//
// prepare runs in the transaction once the facts are locked, and may refuse
// the save or derive fields of `in` from the facts as they stand then (their
// kinds and windows cannot change until the transaction ends).
//
// Fails with a *SegmentFactsMissingError when a fact in factIDs does not
// exist, and with ErrSegmentDefinitionOwned when the id is held by a different
// (created_by_type, created_by_ref). record runs for every write and never for
// SegmentDefinitionUnchanged.
func (r *ViewerSegmentRepository) UpsertDefinition(in *models.SegmentDefinition, factIDs []string, prepare PrepareSegmentDefinition, record RecordSegmentDefinitionChange) (*models.SegmentDefinition, SegmentDefinitionWrite, error) {
	stored, write, err := r.upsertDefinitionOnce(in, factIDs, prepare, record)
	// Two first saves of one id both find no row; the loser's insert does
	// nothing. Its second attempt finds the winner's row and compares against
	// it like any later save.
	if errors.Is(err, errSegmentDefinitionCreatedConcurrently) {
		stored, write, err = r.upsertDefinitionOnce(in, factIDs, prepare, record)
	}
	return stored, write, err
}

// PrepareSegmentDefinition validates and completes a definition inside its
// save's transaction; see UpsertDefinition.
type PrepareSegmentDefinition func(tx *gorm.DB, in *models.SegmentDefinition) error

// SegmentFactsMissingError refuses a segment that reads facts which do not
// exist.
type SegmentFactsMissingError struct {
	FactIDs []string
}

func (e *SegmentFactsMissingError) Error() string {
	return fmt.Sprintf("no fact %s", strings.Join(e.FactIDs, ", "))
}

var errSegmentDefinitionCreatedConcurrently = errors.New("segment definition was created concurrently")

func (r *ViewerSegmentRepository) upsertDefinitionOnce(in *models.SegmentDefinition, factIDs []string, prepare PrepareSegmentDefinition, record RecordSegmentDefinitionChange) (*models.SegmentDefinition, SegmentDefinitionWrite, error) {
	if len(factIDs) == 0 {
		return nil, SegmentDefinitionUnchanged, fmt.Errorf("segment definition %s reads no facts", in.ID)
	}
	var stored models.SegmentDefinition
	write := SegmentDefinitionUnchanged
	err := r.db.Transaction(func(tx *gorm.DB) error {
		txRepo := r.WithDB(tx)
		now := time.Now().UTC()
		if err := txRepo.lockFacts(factIDs); err != nil {
			return err
		}
		if err := prepare(tx, in); err != nil {
			return err
		}
		var existing []models.SegmentDefinition
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", in.ID).Limit(1).Find(&existing).Error; err != nil {
			return err
		}

		if len(existing) == 0 {
			stored = *in
			stored.Revision = 1
			stored.CreatedAt = now
			stored.UpdatedAt = now
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&stored)
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected == 0 {
				return errSegmentDefinitionCreatedConcurrently
			}
			if err := txRepo.replaceFacts(stored.ID, factIDs); err != nil {
				return err
			}
			write = SegmentDefinitionCreated
			return record(tx, &stored, write)
		}

		stored = existing[0]
		if stored.CreatedByType != in.CreatedByType || stored.CreatedByRef != in.CreatedByRef {
			return fmt.Errorf("%w: %s is held by %s %q", ErrSegmentDefinitionOwned, in.ID, stored.CreatedByType, stored.CreatedByRef)
		}
		sameCondition, err := sameJSON(stored.Condition, in.Condition)
		if err != nil {
			return fmt.Errorf("segment definition %s: %w", in.ID, err)
		}
		revised := !sameCondition
		changed := revised ||
			stored.Name != in.Name ||
			stored.Description != in.Description ||
			stored.WindowKind != in.WindowKind ||
			stored.TimeRelative != in.TimeRelative
		if !changed {
			return nil
		}

		stored.Name = in.Name
		stored.Description = in.Description
		stored.WindowKind = in.WindowKind
		stored.TimeRelative = in.TimeRelative
		stored.UpdatedAt = now
		write = SegmentDefinitionRenamed
		if revised {
			stored.Condition = in.Condition
			stored.Revision++
			write = SegmentDefinitionRevised
			if err := txRepo.replaceFacts(stored.ID, factIDs); err != nil {
				return err
			}
		}
		if err := tx.Model(&models.SegmentDefinition{}).Where("id = ?", stored.ID).Updates(map[string]interface{}{
			"name":          stored.Name,
			"description":   stored.Description,
			"condition":     stored.Condition,
			"window_kind":   stored.WindowKind,
			"time_relative": stored.TimeRelative,
			"revision":      stored.Revision,
			"updated_at":    stored.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		return record(tx, &stored, write)
	})
	if err != nil {
		return nil, SegmentDefinitionUnchanged, err
	}
	return &stored, write, nil
}

// lockFacts takes share locks on the facts, in id order, the order a fact
// revision takes them in (its fact, then the segments reading it), so a
// segment write and a revision cannot deadlock. Fails with a
// *SegmentFactsMissingError when any does not exist.
func (r *ViewerSegmentRepository) lockFacts(factIDs []string) error {
	ids := slices.Compact(slices.Sorted(slices.Values(factIDs)))
	var found []string
	if err := r.db.Model(&models.FactDefinition{}).Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id IN ?", ids).Order("id ASC").Pluck("id", &found).Error; err != nil {
		return err
	}
	if len(found) == len(ids) {
		return nil
	}
	var missing []string
	for _, id := range ids {
		if !slices.Contains(found, id) {
			missing = append(missing, id)
		}
	}
	return &SegmentFactsMissingError{FactIDs: missing}
}

// LockForRefill locks a segment for a refill outside any save or revision:
// the facts it reads (share, in id order), then its row (update), the order
// a save takes them in. Returns nil when the segment no longer exists.
func (r *ViewerSegmentRepository) LockForRefill(id string) (*models.SegmentDefinition, error) {
	read, err := r.FactsRead([]string{id})
	if err != nil {
		return nil, err
	}
	if err := r.lockFacts(read[id]); err != nil {
		return nil, err
	}
	var segments []*models.SegmentDefinition
	if err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", id).Limit(1).Find(&segments).Error; err != nil {
		return nil, err
	}
	if len(segments) == 0 {
		return nil, nil
	}
	return segments[0], nil
}

// SetStale records whether a segment's membership is behind its condition.
func (r *ViewerSegmentRepository) SetStale(id string, stale bool) error {
	return r.db.Model(&models.SegmentDefinition{}).Where("id = ?", id).Update("stale", stale).Error
}

func (r *ViewerSegmentRepository) replaceFacts(segmentID string, factIDs []string) error {
	if err := r.db.Where("segment_id = ?", segmentID).Delete(&models.SegmentFact{}).Error; err != nil {
		return err
	}
	ids := slices.Clone(factIDs)
	slices.Sort(ids)
	ids = slices.Compact(ids)
	rows := make([]models.SegmentFact, len(ids))
	for i, id := range ids {
		rows[i] = models.SegmentFact{SegmentID: segmentID, FactID: id}
	}
	return r.db.Create(&rows).Error
}

// SetWindowKind updates a segment's window, which follows the windows of the
// facts it reads and so changes when one of them is revised.
func (r *ViewerSegmentRepository) SetWindowKind(id, windowKind string) error {
	return r.db.Model(&models.SegmentDefinition{}).Where("id = ?", id).
		Update("window_kind", windowKind).Error
}

// DeleteDefinition deletes a definition with its facts and members. They are
// deleted explicitly rather than left to the cascade, which SQLite applies
// only on connections that enabled foreign keys. Returns
// gorm.ErrRecordNotFound when there is no such definition.
func (r *ViewerSegmentRepository) DeleteDefinition(id string, record RecordSegmentDefinitionChange) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing models.SegmentDefinition
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", id).First(&existing).Error; err != nil {
			return err
		}
		if err := tx.Where("segment_id = ?", id).Delete(&models.SegmentMember{}).Error; err != nil {
			return err
		}
		if err := tx.Where("segment_id = ?", id).Delete(&models.SegmentFact{}).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ?", id).Delete(&models.SegmentDefinition{}).Error; err != nil {
			return err
		}
		return record(tx, &existing, SegmentDefinitionDeleted)
	})
}

// DependentSegments returns the segments whose condition reads any of
// factIDs, in id order, under a share lock: what an apply takes before it
// diffs their membership. A segment save or a fact revision rewriting that
// membership locks the rows for update, so it runs wholly before or after
// the apply. SQLite takes no row locks; its single writer serializes the
// transactions instead.
func (r *ViewerSegmentRepository) DependentSegments(factIDs []string) ([]*models.SegmentDefinition, error) {
	return r.dependentSegments(factIDs, "SHARE")
}

// DependentSegmentsForUpdate is DependentSegments locking the rows for
// update, in id order: what a fact revision takes before it refills their
// membership, excluding the applies that would diff it meanwhile.
func (r *ViewerSegmentRepository) DependentSegmentsForUpdate(factIDs []string) ([]*models.SegmentDefinition, error) {
	return r.dependentSegments(factIDs, "UPDATE")
}

func (r *ViewerSegmentRepository) dependentSegments(factIDs []string, strength string) ([]*models.SegmentDefinition, error) {
	segments := []*models.SegmentDefinition{}
	if len(factIDs) == 0 {
		return segments, nil
	}
	err := r.db.Clauses(clause.Locking{Strength: strength}).
		Where("id IN (?)", r.db.Model(&models.SegmentFact{}).Select("segment_id").Where("fact_id IN ?", factIDs)).
		Order("id ASC").
		Find(&segments).Error
	return segments, err
}

// SegmentIDsReading returns the ids of the segments whose condition reads
// factID, in id order.
func (r *ViewerSegmentRepository) SegmentIDsReading(factID string) ([]string, error) {
	ids := []string{}
	err := r.db.Model(&models.SegmentFact{}).
		Where("fact_id = ?", factID).
		Order("segment_id ASC").
		Pluck("segment_id", &ids).Error
	return ids, err
}

// FactsRead returns, for each of segmentIDs, the facts its condition reads in
// id order.
func (r *ViewerSegmentRepository) FactsRead(segmentIDs []string) (map[string][]string, error) {
	out := make(map[string][]string, len(segmentIDs))
	if len(segmentIDs) == 0 {
		return out, nil
	}
	var rows []models.SegmentFact
	if err := r.db.Where("segment_id IN ?", segmentIDs).
		Order("segment_id ASC, fact_id ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.SegmentID] = append(out[row.SegmentID], row.FactID)
	}
	return out, nil
}

// SegmentFactDefinition is what evaluating a segment needs of a fact it reads.
type SegmentFactDefinition struct {
	ID         string
	ValueKind  string
	WindowKind string
	Definition string
}

// FactDefinitions returns the named fact definitions, keyed by id.
func (r *ViewerSegmentRepository) FactDefinitions(ids []string) (map[string]SegmentFactDefinition, error) {
	out := make(map[string]SegmentFactDefinition, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	var rows []models.FactDefinition
	if err := r.db.Select("id", "value_kind", "window_kind", "definition").
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.ID] = SegmentFactDefinition{ID: row.ID, ValueKind: row.ValueKind, WindowKind: row.WindowKind, Definition: row.Definition}
	}
	return out, nil
}

// ViewerKey names one viewer.
type ViewerKey struct {
	Platform  string
	SubjectID string
}

// FactValues returns the stored values of factIDs in the lifetime window and
// in sessionKey, for one viewer when viewer is non-nil and for every viewer
// otherwise. A lifetime fact only has values in "" and a session fact only in
// session ids, so the two windows never return two values of one fact for
// one viewer.
func (r *ViewerSegmentRepository) FactValues(factIDs []string, sessionKey string, viewer *ViewerKey) ([]models.FactValue, error) {
	values := []models.FactValue{}
	if len(factIDs) == 0 {
		return values, nil
	}
	windows := []string{""}
	if sessionKey != "" {
		windows = append(windows, sessionKey)
	}
	query := r.db.Where("fact_id IN ? AND window_key IN ?", factIDs, windows)
	if viewer != nil {
		query = query.Where("platform = ? AND subject_id = ?", viewer.Platform, viewer.SubjectID)
	}
	err := query.Order("platform ASC, subject_id ASC, fact_id ASC").Find(&values).Error
	return values, err
}

// LockViewer serializes the membership diffs of one viewer across
// transactions until this one ends. Two events changing different facts of
// one viewer lock different value rows, so without it each could evaluate a
// segment reading both facts against the other's stale value and neither
// would see the viewer enter. On Postgres it is a transaction-scoped advisory
// lock on ViewerLockKey; SQLite's single writer already serializes the
// transactions. A transaction locking several viewers must lock them in
// ViewerLockKey order, so two cannot deadlock.
func (r *ViewerSegmentRepository) LockViewer(viewer ViewerKey) error {
	if r.db.Dialector.Name() != "postgres" {
		return nil
	}
	return r.db.Exec(`SELECT pg_advisory_xact_lock(?)`, ViewerLockKey(viewer)).Error
}

// ViewerLockKey is the advisory lock key of a viewer: FNV-1a of
// `platform|subject`. A collision only serializes two viewers needlessly.
func ViewerLockKey(viewer ViewerKey) int64 {
	hash := fnv.New64a()
	hash.Write([]byte(viewer.Platform + "|" + viewer.SubjectID))
	return int64(hash.Sum64())
}

// ViewerMembers returns one viewer's membership rows in segmentIDs, whatever
// their window.
func (r *ViewerSegmentRepository) ViewerMembers(viewer ViewerKey, segmentIDs []string) ([]models.SegmentMember, error) {
	members := []models.SegmentMember{}
	if len(segmentIDs) == 0 {
		return members, nil
	}
	err := r.db.Where("platform = ? AND subject_id = ? AND segment_id IN ?", viewer.Platform, viewer.SubjectID, segmentIDs).
		Order("segment_id ASC").
		Find(&members).Error
	return members, err
}

// Members returns every membership row of a segment, whatever its window.
func (r *ViewerSegmentRepository) Members(segmentID string) ([]models.SegmentMember, error) {
	members := []models.SegmentMember{}
	err := r.db.Where("segment_id = ?", segmentID).
		Order("platform ASC, subject_id ASC").
		Find(&members).Error
	return members, err
}

// Enter makes member the viewer's membership of its segment: a new row, or a
// row of an earlier window moved to member's window and entry time. Reports
// whether it wrote, which is false when the viewer was already a member in
// that window.
func (r *ViewerSegmentRepository) Enter(member models.SegmentMember) (bool, error) {
	result := r.db.Clauses(enterConflict()).Create(&member)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

// EnterAll is Enter for many members, in batches.
func (r *ViewerSegmentRepository) EnterAll(members []models.SegmentMember) error {
	if len(members) == 0 {
		return nil
	}
	return r.db.Clauses(enterConflict()).CreateInBatches(members, segmentMemberBatchSize).Error
}

func enterConflict() clause.OnConflict {
	return clause.OnConflict{
		Columns:   []clause.Column{{Name: "segment_id"}, {Name: "platform"}, {Name: "subject_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"window_key", "entered_at"}),
		Where: clause.Where{Exprs: []clause.Expression{
			clause.Expr{SQL: "segment_members.window_key <> excluded.window_key"},
		}},
	}
}

// Leave deletes the viewer's membership row of a segment, whatever its window,
// and reports whether there was one.
func (r *ViewerSegmentRepository) Leave(segmentID string, viewer ViewerKey) (bool, error) {
	result := r.db.Where("segment_id = ? AND platform = ? AND subject_id = ?", segmentID, viewer.Platform, viewer.SubjectID).
		Delete(&models.SegmentMember{})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

// LeaveAll is Leave for many viewers of one segment, in batches.
func (r *ViewerSegmentRepository) LeaveAll(segmentID string, viewers []ViewerKey) error {
	for start := 0; start < len(viewers); start += segmentMemberBatchSize {
		batch := viewers[start:min(start+segmentMemberBatchSize, len(viewers))]
		pairs := make([][]any, len(batch))
		for i, viewer := range batch {
			pairs[i] = []any{viewer.Platform, viewer.SubjectID}
		}
		if err := r.db.Where("segment_id = ? AND (platform, subject_id) IN ?", segmentID, pairs).
			Delete(&models.SegmentMember{}).Error; err != nil {
			return err
		}
	}
	return nil
}

// segmentMemberBatchSize bounds the rows one membership statement writes, and
// with them its bound parameters.
const segmentMemberBatchSize = 500

// ViewerMembership is one of a viewer's membership rows with the kinds of its
// segment.
type ViewerMembership struct {
	SegmentID    string
	WindowKind   string
	TimeRelative bool
	WindowKey    string
	EnteredAt    time.Time
}

// ViewerMemberships returns every membership row of one viewer with its
// segment's window and time-relativity, ordered by segment id. A row is a
// current membership only when its window_key is its segment's current
// window, which the caller decides.
func (r *ViewerSegmentRepository) ViewerMemberships(viewer ViewerKey) ([]ViewerMembership, error) {
	rows := []ViewerMembership{}
	err := r.db.Table("segment_members").
		Select(`segment_members.segment_id, segment_definitions.window_kind, segment_definitions.time_relative,
			segment_members.window_key, segment_members.entered_at`).
		Joins("JOIN segment_definitions ON segment_definitions.id = segment_members.segment_id").
		Where("segment_members.platform = ? AND segment_members.subject_id = ?", viewer.Platform, viewer.SubjectID).
		Order("segment_members.segment_id ASC").
		Scan(&rows).Error
	return rows, err
}
