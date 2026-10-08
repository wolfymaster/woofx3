package repository

import (
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AlertRepository wraps gorm.DB with Alert-specific helpers — same
// thin pattern as `WorkflowRepository` and `SceneRepository`.
type AlertRepository struct {
	db *gorm.DB
}

func NewAlertRepository(db *gorm.DB) *AlertRepository {
	return &AlertRepository{db: db}
}

// NewAlert is what a caller decides about a row it records. The database
// supplies the row's timestamps and version (see Create).
type NewAlert struct {
	ID            uuid.UUID
	Payload       string
	WorkflowID    *uuid.UUID
	SourceEventID string
	EnvelopeID    string
}

// Create inserts a row as sent and dispatched at the moment it is written,
// and returns it as stored.
//
// created_at, updated_at and dispatched_at take one value from the database's
// clock (see nowSQL), and RETURNING hands back what was stored in the same
// round trip, so a snapshot built from the result matches the row exactly.
func (r *AlertRepository) Create(a NewAlert) (*models.Alert, error) {
	now := r.nowSQL()
	var stored models.Alert
	res := r.db.Raw(
		`INSERT INTO alerts (id, payload, workflow_id, source_event_id, envelope_id, status, error, version,
			dispatched_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'sent', '', 1, `+now+`, `+now+`, `+now+`)
		RETURNING *`,
		a.ID, a.Payload, a.WorkflowID, a.SourceEventID, a.EnvelopeID,
	).Scan(&stored)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected != 1 {
		return nil, fmt.Errorf("insert alert %s returned %d rows", a.ID, res.RowsAffected)
	}
	return &stored, nil
}

func (r *AlertRepository) GetByID(id uuid.UUID) (*models.Alert, error) {
	var a models.Alert
	err := r.db.Where("id = ?", id).First(&a).Error
	return &a, err
}

// List returns alerts ordered newest-first — backed by the index
// `idx_alerts_created_at`.
//
// `limit <= 0` means "no limit" (returns the full history). Callers
// driving the alert-log UI should always pass a finite limit + offset;
// the no-limit path is for tooling / one-off scripts.
func (r *AlertRepository) List(limit, offset int) ([]*models.Alert, error) {
	var alerts []*models.Alert
	q := r.db.Order("created_at DESC")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&alerts).Error
	return alerts, err
}

// Count returns the total count for pagination headers.
func (r *AlertRepository) Count() (int64, error) {
	var n int64
	err := r.db.Model(&models.Alert{}).Count(&n).Error
	return n, err
}

// GetByEnvelopeID looks up the most recent alert row for a given
// AlertPayload envelope id. Returns gorm.ErrRecordNotFound when no row
// matches.
func (r *AlertRepository) GetByEnvelopeID(envelopeID string) (*models.Alert, error) {
	if envelopeID == "" {
		return nil, fmt.Errorf("envelope_id is required")
	}
	return newestByEnvelopeID(r.db, envelopeID)
}

func newestByEnvelopeID(db *gorm.DB, envelopeID string) (*models.Alert, error) {
	var a models.Alert
	err := db.
		Where("envelope_id = ?", envelopeID).
		Order("created_at DESC").
		First(&a).Error
	return &a, err
}

// Stages of an alert's lifecycle. A transition applies only when it moves the
// row to a later stage, with the one exception in transitionUpdateSQL.
const (
	alertStageInitial = iota
	alertStageDispatched
	alertStagePlaying
	alertStageVerdict
	alertStageReplayed
)

// alertLifecycleStages ranks every status an alert row can hold.
//
// Verdicts share a stage, so the first verdict stands and later ones are
// refused. `replayed` ranks above them: an operator superseded the row, and a
// straggling report for the original play does not undo that.
var alertLifecycleStages = map[string]int{
	"sent":       alertStageInitial,
	"dispatched": alertStageDispatched,
	"playing":    alertStagePlaying,
	"completed":  alertStageVerdict,
	"failed":     alertStageVerdict,
	"timed_out":  alertStageVerdict,
	"skipped":    alertStageVerdict,
	"replayed":   alertStageReplayed,
}

// alertStageSQL is the stage of a row's current status as a SQL expression.
// A status outside alertLifecycleStages ranks as initial, so a row holding
// one can still move forward.
var alertStageSQL = func() string {
	statuses := make([]string, 0, len(alertLifecycleStages))
	for status := range alertLifecycleStages {
		statuses = append(statuses, status)
	}
	sort.Strings(statuses)
	var b strings.Builder
	b.WriteString("CASE status")
	for _, status := range statuses {
		fmt.Fprintf(&b, " WHEN '%s' THEN %d", status, alertLifecycleStages[status])
	}
	fmt.Fprintf(&b, " ELSE %d END", alertStageInitial)
	return b.String()
}()

// nowSQL is the database's clock as a SQL expression for a timestamp column.
// Every timestamp a write sets uses it, so one write stamps all of its columns
// with a single value.
//
// Postgres: statement_timestamp() is fixed for the whole statement. A
// transition locks its row before issuing the UPDATE (see transition), so the
// statement starts after any earlier write to the row committed, and the
// row's writes are stamped in the order they were applied. SQLite: 'now' is
// fixed for the whole statement too, at millisecond precision, written with an
// explicit UTC offset in a layout the driver decodes into time.Time.
func (r *AlertRepository) nowSQL() string {
	if r.isPostgres() {
		return "statement_timestamp()"
	}
	return "strftime('%Y-%m-%d %H:%M:%f+00:00', 'now')"
}

func (r *AlertRepository) isPostgres() bool {
	return database.Dialect(r.db.Dialector.Name()) == database.DialectPostgres
}

// forUpdate makes a read inside a transaction lock the rows it returns.
// SQLite has no row locks; its single writer serialises transitions instead.
func (r *AlertRepository) forUpdate(tx *gorm.DB) *gorm.DB {
	if r.isPostgres() {
		return tx.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	return tx
}

// UpdateStatus moves the row with `id` to `status` under the same rule as
// UpdateLifecycle and returns the row and whether the write applied. Replay
// uses it to mark the source row `replayed`.
func (r *AlertRepository) UpdateStatus(id uuid.UUID, status string) (*models.Alert, bool, error) {
	return r.transition(status, "", func(tx *gorm.DB) (*models.Alert, error) {
		var a models.Alert
		err := r.forUpdate(tx).Where("id = ?", id).First(&a).Error
		return &a, err
	})
}

// UpdateLifecycle moves the newest row for an envelope to a lifecycle status
// and returns the row and whether the write applied. See transitionUpdateSQL
// for what each status stamps and which transitions apply.
func (r *AlertRepository) UpdateLifecycle(envelopeID string, status string, errorMsg string) (*models.Alert, bool, error) {
	if envelopeID == "" {
		return nil, false, fmt.Errorf("envelope_id is required")
	}
	return r.transition(status, errorMsg, func(tx *gorm.DB) (*models.Alert, error) {
		return newestByEnvelopeID(r.forUpdate(tx), envelopeID)
	})
}

// transition applies one lifecycle write to the row `find` locks.
//
// The forward-only check is part of the UPDATE itself, so concurrent writers
// cannot interleave around it. A refused write changes nothing and returns
// the row as it stands, with applied false; callers publish only applied
// writes, because a callback for a refused one would tell receivers the row
// moved when it did not.
func (r *AlertRepository) transition(
	status string,
	errorMsg string,
	find func(tx *gorm.DB) (*models.Alert, error),
) (*models.Alert, bool, error) {
	update, err := r.transitionUpdateSQL(status)
	if err != nil {
		return nil, false, err
	}
	var row *models.Alert
	applied := false
	err = r.db.Transaction(func(tx *gorm.DB) error {
		current, err := find(tx)
		if err != nil {
			return err
		}
		var updated models.Alert
		res := tx.Raw(update, map[string]interface{}{
			"id":     current.ID,
			"status": status,
			"stage":  alertLifecycleStages[status],
			"error":  errorMsg,
		}).Scan(&updated)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 1 {
			row = &updated
			applied = true
			return nil
		}
		// Read the row again rather than returning `current`: the refused
		// UPDATE holds the write lock on either database, so this read is the
		// row as it stands.
		var unchanged models.Alert
		if err := tx.Where("id = ?", current.ID).First(&unchanged).Error; err != nil {
			return err
		}
		row = &unchanged
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return row, applied, nil
}

// transitionUpdateSQL is the conditional UPDATE that moves a row to `status`,
// returning the row as stored when it applies.
//
// What each status stamps:
//   - "dispatched" → dispatched_at
//   - "playing"    → played_at      (an overlay started playing it)
//   - "completed"  → completed_at   (an overlay finished playing it), error cleared
//   - "failed"     → completed_at, error stamped
//   - "timed_out"  → completed_at, error stamped
//   - "skipped"    → completed_at   (an operator skipped it), error cleared
//   - "replayed"   → nothing else   (an operator replayed it as a new row)
//
// Which transitions apply: a write applies only when the new status is at a
// later stage than the current one, so the first verdict wins. The single
// exception is a real verdict (completed, failed, skipped) replacing
// `timed_out`: the timeout is the engine giving up on hearing back, and a
// late report from the overlay is the truth. A verdict always rewrites
// `error`, so a success that replaces a timeout carries no error.
//
// An applied write increments `version` and sets `updated_at` in the same
// statement. Lifecycle timestamps keep the first transition (COALESCE).
func (r *AlertRepository) transitionUpdateSQL(status string) (string, error) {
	now := r.nowSQL()
	sets := []string{"status = @status", "version = version + 1", "updated_at = " + now}
	where := alertStageSQL + " < @stage"
	switch status {
	case "dispatched":
		sets = append(sets, "dispatched_at = COALESCE(dispatched_at, "+now+")")
	case "playing":
		sets = append(sets, "played_at = COALESCE(played_at, "+now+")")
	case "completed", "skipped":
		sets = append(sets, "completed_at = COALESCE(completed_at, "+now+")", "error = ''")
		where = "(" + where + " OR status = 'timed_out')"
	case "failed":
		sets = append(sets, "completed_at = COALESCE(completed_at, "+now+")", "error = @error")
		where = "(" + where + " OR status = 'timed_out')"
	case "timed_out":
		sets = append(sets, "completed_at = COALESCE(completed_at, "+now+")", "error = @error")
	case "replayed":
	default:
		return "", fmt.Errorf("unsupported lifecycle status %q", status)
	}
	return "UPDATE alerts SET " + strings.Join(sets, ", ") + " WHERE id = @id AND " + where + " RETURNING *", nil
}

// ListPending returns alerts that have never been
// dispatched, in chronological order. Used by AlertQueueManager on
// boot to hydrate the in-memory queue from the persistent backstop.
func (r *AlertRepository) ListPending() ([]*models.Alert, error) {
	var alerts []*models.Alert
	err := r.db.
		Where("status = ?", "pending").
		Order("created_at ASC").
		Find(&alerts).Error
	return alerts, err
}

func (r *AlertRepository) Delete(id uuid.UUID) error {
	return r.db.Where("id = ?", id).Delete(&models.Alert{}).Error
}
