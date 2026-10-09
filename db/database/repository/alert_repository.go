package repository

import (
	"fmt"
	"sort"
	"strings"
	"time"

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

// NewAlert is what a caller decides about a row it records. The database
// supplies the row's timestamps and version (see Create).
type NewAlert struct {
	ID            uuid.UUID
	Payload       string
	WorkflowID    *uuid.UUID
	SourceEventID string
	EnvelopeID    string
}

// RecordAlertChange records a row a write changed, as it stands after the
// write, in the same transaction as the write. The service uses it to write the
// row's outbox entry, so a write and the entry that publishes it commit or roll
// back together. Returning an error rolls the write back.
type RecordAlertChange func(tx *gorm.DB, row *models.Alert) error

// Create inserts a row as sent and dispatched at the moment it is written,
// records it, and returns it as stored.
//
// created_at, updated_at and dispatched_at take one value (see writeClock),
// and RETURNING hands back what was stored in the same round trip, so a
// snapshot built from the result matches the row exactly.
func (r *AlertRepository) Create(a NewAlert, record RecordAlertChange) (*models.Alert, error) {
	var stored models.Alert
	err := r.db.Transaction(func(tx *gorm.DB) error {
		now, at := r.writeClock()
		res := tx.Raw(
			`INSERT INTO alerts (id, payload, workflow_id, source_event_id, envelope_id, status, error, version,
				dispatched_at, created_at, updated_at)
			VALUES (@id, @payload, @workflow_id, @source_event_id, @envelope_id, 'sent', '', 1, `+now+`, `+now+`, `+now+`)
			RETURNING *`,
			map[string]interface{}{
				"id":              a.ID,
				"payload":         a.Payload,
				"workflow_id":     a.WorkflowID,
				"source_event_id": a.SourceEventID,
				"envelope_id":     a.EnvelopeID,
				"now":             at,
			},
		).Scan(&stored)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return fmt.Errorf("insert alert %s returned %d rows", a.ID, res.RowsAffected)
		}
		return record(tx, &stored)
	})
	if err != nil {
		return nil, err
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

// alertsNewestFirst orders an envelope's rows so the first is the one its
// lifecycle reports concern: the newest. The id breaks a tie between rows
// written at the same instant, so every reader picks the same row.
const alertsNewestFirst = "created_at DESC, id DESC"

// GetByEnvelopeID looks up the most recent alert row for a given
// AlertPayload envelope id. Returns gorm.ErrRecordNotFound when no row
// matches.
func (r *AlertRepository) GetByEnvelopeID(envelopeID string) (*models.Alert, error) {
	if envelopeID == "" {
		return nil, fmt.Errorf("envelope_id is required")
	}
	return newestForEnvelope(r.db, envelopeID)
}

func newestForEnvelope(tx *gorm.DB, envelopeID string) (*models.Alert, error) {
	var a models.Alert
	err := tx.Where("envelope_id = ?", envelopeID).Order(alertsNewestFirst).First(&a).Error
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// The statuses an alert row can hold.
const (
	AlertStatusSent       = "sent"
	AlertStatusDispatched = "dispatched"
	AlertStatusPlaying    = "playing"
	AlertStatusCompleted  = "completed"
	AlertStatusFailed     = "failed"
	AlertStatusTimedOut   = "timed_out"
	AlertStatusSkipped    = "skipped"
	AlertStatusReplayed   = "replayed"
)

// Stages of an alert's lifecycle. A transition applies only when it moves the
// row to a later stage, or replaces a verdict alertVerdictReplacements lists.
const (
	alertStageInitial = iota
	alertStageDispatched
	alertStagePlaying
	alertStageVerdict
	alertStageReplayed
)

// alertLifecycleStages ranks every status an alert row can hold, and is the
// one list of them: the SQL rule and the RPC validators derive from it.
//
// Verdicts share a stage, so the first verdict stands apart from the
// replacements alertVerdictReplacements lists. `replayed` ranks above them: an
// operator superseded the row, and a straggling report for the original play
// does not undo that.
var alertLifecycleStages = map[string]int{
	AlertStatusSent:       alertStageInitial,
	AlertStatusDispatched: alertStageDispatched,
	AlertStatusPlaying:    alertStagePlaying,
	AlertStatusCompleted:  alertStageVerdict,
	AlertStatusFailed:     alertStageVerdict,
	AlertStatusTimedOut:   alertStageVerdict,
	AlertStatusSkipped:    alertStageVerdict,
	AlertStatusReplayed:   alertStageReplayed,
}

// alertVerdictReplacements lists, for each verdict, the verdicts it replaces
// although they share its stage. Any other verdict stands once written.
//
//   - `completed` replaces any other verdict. An alert fans out to every
//     widget that answers to its target, and one widget playing it to the end
//     means viewers saw it, whatever another widget or the queue reported.
//   - `failed` and `skipped` replace `timed_out`. The timeout is the engine
//     giving up on hearing back; a late report is the truth.
var alertVerdictReplacements = map[string][]string{
	AlertStatusCompleted: {AlertStatusFailed, AlertStatusTimedOut, AlertStatusSkipped},
	AlertStatusFailed:    {AlertStatusTimedOut},
	AlertStatusSkipped:   {AlertStatusTimedOut},
}

// IsEnvelopeLifecycleStatus reports whether `status` is one an overlay or the
// queue reports against an envelope (see UpdateLifecycle): every status but
// the one a row is created with and `replayed`, which is written by row id.
func IsEnvelopeLifecycleStatus(status string) bool {
	_, known := alertLifecycleStages[status]
	return known && status != AlertStatusSent && status != AlertStatusReplayed
}

// EnvelopeLifecycleStatuses lists the statuses IsEnvelopeLifecycleStatus
// accepts, in lifecycle order.
func EnvelopeLifecycleStatuses() []string {
	statuses := make([]string, 0, len(alertLifecycleStages))
	for status := range alertLifecycleStages {
		if IsEnvelopeLifecycleStatus(status) {
			statuses = append(statuses, status)
		}
	}
	sort.Slice(statuses, func(i, j int) bool {
		si, sj := alertLifecycleStages[statuses[i]], alertLifecycleStages[statuses[j]]
		if si != sj {
			return si < sj
		}
		return statuses[i] < statuses[j]
	})
	return statuses
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

// sqliteTimestampLayout is how a write stamps a SQLite timestamp column: UTC
// with six fractional digits and an explicit offset, a layout the driver
// decodes into time.Time. Fixed width and one zone, so stored values sort as
// text in time order; rows written before the engine used it are rewritten to
// it by migration 0055_alert_timestamps_utc, which must use the same layout.
const sqliteTimestampLayout = "2006-01-02 15:04:05.000000-07:00"

// writeClock is the clock one write stamps every timestamp column with: a SQL
// expression for the columns, and the value of the `@now` argument it may
// reference. Every write is a single statement, so each column it stamps gets
// the same value.
//
// Postgres: statement_timestamp(), at microsecond precision. It is read when
// the statement starts, which can be before the statement waits for a
// concurrent write to the same row to commit, so two racing writes may stamp
// `updated_at` out of the order they were applied in by a few microseconds.
// `version` is what orders a row's writes.
//
// SQLite: its own clock has only millisecond precision, so the time is read
// here, at microseconds, and bound as one argument. The engine holds a single
// SQLite connection and reads the clock inside the write's transaction, so
// writes are stamped in the order they were applied.
func (r *AlertRepository) writeClock() (string, string) {
	if r.isPostgres() {
		return "statement_timestamp()", ""
	}
	return "@now", time.Now().UTC().Truncate(time.Microsecond).Format(sqliteTimestampLayout)
}

func (r *AlertRepository) isPostgres() bool {
	return database.Dialect(r.db.Dialector.Name()) == database.DialectPostgres
}

// MarkReplayed moves the row with `id` to `replayed` under the same rule as
// UpdateLifecycle, so a row is marked replayed once. It returns the row as it
// stands and whether the write applied.
func (r *AlertRepository) MarkReplayed(id uuid.UUID, record RecordAlertChange) (*models.Alert, bool, error) {
	return r.transition(AlertStatusReplayed, "", record, alertTarget{
		sql:  "@id",
		args: map[string]interface{}{"id": id},
		current: func(tx *gorm.DB) (*models.Alert, error) {
			var a models.Alert
			if err := tx.Where("id = ?", id).First(&a).Error; err != nil {
				return nil, err
			}
			return &a, nil
		},
	})
}

// UpdateLifecycle moves the newest row for an envelope to a lifecycle status,
// under the rule in transitionUpdateSQL, and returns that row as it stands and
// whether the write applied.
//
// One envelope can have several rows, when a workflow pins the envelope id
// with `parameters.id` or an operator replays a row. Each row is a separate
// play of the alert, and an overlay's report names the envelope, not a row,
// so it concerns the newest play. An earlier row keeps the status it reached.
func (r *AlertRepository) UpdateLifecycle(
	envelopeID string,
	status string,
	errorMsg string,
	record RecordAlertChange,
) (*models.Alert, bool, error) {
	if envelopeID == "" {
		return nil, false, fmt.Errorf("envelope_id is required")
	}
	if !IsEnvelopeLifecycleStatus(status) {
		return nil, false, fmt.Errorf("unsupported envelope lifecycle status %q", status)
	}
	return r.transition(status, errorMsg, record, alertTarget{
		sql:  "(SELECT id FROM alerts WHERE envelope_id = @envelope_id ORDER BY " + alertsNewestFirst + " LIMIT 1)",
		args: map[string]interface{}{"envelope_id": envelopeID},
		current: func(tx *gorm.DB) (*models.Alert, error) {
			return newestForEnvelope(tx, envelopeID)
		},
	})
}

// alertTarget names the one row a transition writes: `sql` is a SQL
// expression for its id over `args`, and `current` reads the row as it stands.
type alertTarget struct {
	sql     string
	args    map[string]interface{}
	current func(tx *gorm.DB) (*models.Alert, error)
}

// transition applies one lifecycle write to the target row, and returns the
// row as it stands and whether the write applied.
//
// The write is a single conditional UPDATE: the forward-only check is in its
// WHERE clause, which the database re-evaluates against the latest version of
// a row a concurrent write changed, so concurrent writers cannot interleave
// around it. A refused write changes nothing and records nothing, because an
// entry for it would tell receivers the row moved when it did not. An applied
// write is recorded in its transaction, so it is published if and only if it
// commits.
func (r *AlertRepository) transition(
	status string,
	errorMsg string,
	record RecordAlertChange,
	target alertTarget,
) (*models.Alert, bool, error) {
	var row *models.Alert
	applied := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		now, at := r.writeClock()
		update, err := transitionUpdateSQL(status, target.sql, now)
		if err != nil {
			return err
		}
		args := map[string]interface{}{
			"status": status,
			"stage":  alertLifecycleStages[status],
			"error":  errorMsg,
			"now":    at,
		}
		for name, value := range target.args {
			args[name] = value
		}
		var updated models.Alert
		res := tx.Raw(update, args).Scan(&updated)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			current, err := target.current(tx)
			if err != nil {
				return err
			}
			row = current
			return nil
		}
		if err := record(tx, &updated); err != nil {
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

// transitionUpdateSQL is the conditional UPDATE that moves the row whose id is
// `target` to `status`, returning the row as stored when it applies. `now` is
// the write's clock (see writeClock).
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
// later stage than the current one, so the first verdict wins, apart from the
// replacements alertVerdictReplacements lists. A verdict always rewrites
// `error`, so a success that replaces a failure carries no error.
//
// This is the only place the rule is enforced. Receivers of the published
// snapshots keep the one with the highest version and do not re-check it.
//
// An applied write increments `version` and sets `updated_at` in the same
// statement. Lifecycle timestamps keep the first transition (COALESCE).
func transitionUpdateSQL(status string, target string, now string) (string, error) {
	sets := []string{"status = @status", "version = version + 1", "updated_at = " + now}
	switch status {
	case AlertStatusDispatched:
		sets = append(sets, "dispatched_at = COALESCE(dispatched_at, "+now+")")
	case AlertStatusPlaying:
		sets = append(sets, "played_at = COALESCE(played_at, "+now+")")
	case AlertStatusCompleted, AlertStatusSkipped:
		sets = append(sets, "completed_at = COALESCE(completed_at, "+now+")", "error = ''")
	case AlertStatusFailed, AlertStatusTimedOut:
		sets = append(sets, "completed_at = COALESCE(completed_at, "+now+")", "error = @error")
	case AlertStatusReplayed:
	default:
		return "", fmt.Errorf("unsupported lifecycle status %q", status)
	}
	where := alertStageSQL + " < @stage"
	if replaced := alertVerdictReplacements[status]; len(replaced) > 0 {
		where = "(" + where + " OR status IN (" + sqlStringList(replaced) + "))"
	}
	return "UPDATE alerts SET " + strings.Join(sets, ", ") +
		" WHERE id = " + target + " AND " + where + " RETURNING *", nil
}

// sqlStringList renders constant strings as a SQL list of literals. Only for
// values defined in this file: nothing is escaped.
func sqlStringList(values []string) string {
	quoted := make([]string, len(values))
	for i, value := range values {
		quoted[i] = "'" + value + "'"
	}
	return strings.Join(quoted, ", ")
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

// Delete removes the row with `id` and records it in the same transaction,
// with its version incremented past the row's last write: the deletion is the
// row's final write, and a receiver that keeps the highest version of each row
// takes it over every snapshot published before. Returns
// gorm.ErrRecordNotFound when no row matches.
func (r *AlertRepository) Delete(id uuid.UUID, record RecordAlertChange) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var deleted models.Alert
		res := tx.Raw(`DELETE FROM alerts WHERE id = @id RETURNING *`, map[string]interface{}{"id": id}).Scan(&deleted)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		deleted.Version++
		return record(tx, &deleted)
	})
}
