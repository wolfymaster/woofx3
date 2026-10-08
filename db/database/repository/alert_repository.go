package repository

import (
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// AlertRepository wraps gorm.DB with Alert-specific helpers — same
// thin pattern as `WorkflowRepository` and `SceneRepository`.
type AlertRepository struct {
	db *gorm.DB
}

func NewAlertRepository(db *gorm.DB) *AlertRepository {
	return &AlertRepository{db: db}
}

func (r *AlertRepository) Create(a *models.Alert) error {
	return r.db.Create(a).Error
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

// UpdateStatus sets the row's `status` unconditionally, as a write that is
// published: it advances `version` and `updated_at` like a lifecycle write.
// Used by replay to mark the source row as having been replayed without
// inserting a duplicate envelope.
func (r *AlertRepository) UpdateStatus(id uuid.UUID, status string) error {
	now := r.nowSQL()
	return r.db.Exec(
		`UPDATE alerts SET status = ?, version = version + 1, updated_at = `+now+` WHERE id = ?`,
		status, id,
	).Error
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

// Stages of an alert's lifecycle. A lifecycle write applies only when it
// moves the row to a later stage (see UpdateLifecycle).
const (
	alertStageInitial = iota
	alertStageDispatched
	alertStagePlaying
	alertStageVerdict
	alertStageReplayed
)

// alertLifecycleStages ranks every status an alert row can hold.
//
// Verdicts share a stage because a late overlay report may replace an earlier
// verdict (a completion after a timeout). `replayed` ranks above them: an
// operator superseded the row, and a straggling report for the original play
// does not undo that.
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
//
// Write timestamps come from the database rather than from this process so
// that writes to one row are stamped in the order they were applied. On
// Postgres, clock_timestamp() is read when the row is written, after the row
// lock is taken. SQLite's clock has millisecond precision, written with an
// explicit UTC offset in a layout the driver decodes into time.Time.
func (r *AlertRepository) nowSQL() string {
	if database.Dialect(r.db.Dialector.Name()) == database.DialectPostgres {
		return "clock_timestamp()"
	}
	return "strftime('%Y-%m-%d %H:%M:%f+00:00', 'now')"
}

// UpdateLifecycle moves the newest row for an envelope to a lifecycle status
// and stamps the matching timestamp column. It returns the row and whether
// the write applied.
//
// Allowed states:
//   - "dispatched" → dispatched_at
//   - "playing"    → played_at      (an overlay started playing it)
//   - "completed"  → completed_at   (an overlay finished playing it)
//   - "failed"     → completed_at, error stamped
//   - "timed_out"  → completed_at, error stamped
//   - "skipped"    → completed_at   (an operator skipped it)
//
// Transitions only move forward, decided in the UPDATE itself so concurrent
// writers cannot interleave around the check. A write applies when the new
// status is at a later stage than the current one, or when it is a different
// verdict replacing a verdict, so a late overlay report still lands. Anything
// else is refused: a second widget starting the alert after it finished, a
// verdict reported again by another widget. A refused write changes nothing
// and returns the row as it is, with applied false; callers publish only
// applied writes.
//
// An applied write increments `version` and sets `updated_at` in the same
// statement. Lifecycle timestamps keep the first transition (COALESCE), and
// `error` is overwritten when a failing verdict applies.
func (r *AlertRepository) UpdateLifecycle(envelopeID string, status string, errorMsg string) (*models.Alert, bool, error) {
	if envelopeID == "" {
		return nil, false, fmt.Errorf("envelope_id is required")
	}
	now := r.nowSQL()
	sets := []string{"status = @status", "version = version + 1", "updated_at = " + now}
	switch status {
	case "dispatched":
		sets = append(sets, "dispatched_at = COALESCE(dispatched_at, "+now+")")
	case "playing":
		sets = append(sets, "played_at = COALESCE(played_at, "+now+")")
	case "completed", "skipped":
		sets = append(sets, "completed_at = COALESCE(completed_at, "+now+")")
	case "failed", "timed_out":
		sets = append(sets, "completed_at = COALESCE(completed_at, "+now+")", "error = @error")
	default:
		return nil, false, fmt.Errorf("unsupported lifecycle status %q", status)
	}
	stage := alertLifecycleStages[status]
	forward := alertStageSQL + " < @stage"
	if stage == alertStageVerdict {
		forward = "(" + forward + " OR (" + alertStageSQL + " = @stage AND status <> @status))"
	}
	update := "UPDATE alerts SET " + strings.Join(sets, ", ") + " WHERE id = @id AND " + forward

	var row *models.Alert
	applied := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		current, err := newestByEnvelopeID(tx, envelopeID)
		if err != nil {
			return err
		}
		res := tx.Exec(update, map[string]interface{}{
			"id":     current.ID,
			"status": status,
			"stage":  stage,
			"error":  errorMsg,
		})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			row = current
			return nil
		}
		var updated models.Alert
		if err := tx.Where("id = ?", current.ID).First(&updated).Error; err != nil {
			return err
		}
		row = &updated
		applied = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return row, applied, nil
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
