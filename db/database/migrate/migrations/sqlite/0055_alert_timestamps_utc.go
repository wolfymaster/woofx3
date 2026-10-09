package sqlite

import (
	"fmt"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// alertTimestampLayout is the one layout every alert timestamp is stored in.
// Must match sqliteTimestampLayout in database/repository/alert_repository.go.
const alertTimestampLayout = "2006-01-02 15:04:05.000000-07:00"

// alertTimestampBatch is how many rows one read of the rewrite holds at once.
const alertTimestampBatch = 500

// NormaliseAlertTimestamps rewrites every timestamp in `alerts` to UTC in one
// fixed-width layout.
//
// SQLite stores a timestamp as text and compares it as text, so ORDER BY
// created_at is time order only while every row uses one layout and one zone.
// The alert repository writes UTC at six fractional digits; rows the driver
// wrote hold Go's time.String() in the engine's local zone (with a varying
// number of fractional digits, and an offset that changes with daylight
// saving), and column defaults hold `datetime('now')`. Each is read through
// the driver, which decodes all of them, and written back in the repository's
// layout, so the newest row of an envelope and the alert log's order are right
// across rows written before and after.
//
// SQLite's own date functions are not used: they parse neither time.String()
// nor more than millisecond precision.
func NormaliseAlertTimestamps() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0055_alert_timestamps_utc",
		Migrate: func(tx *gorm.DB) error {
			return tx.Transaction(normaliseAlertTimestamps)
		},
		Rollback: func(tx *gorm.DB) error {
			// The rewritten values are the same instants, which every reader
			// decodes; there is nothing to undo.
			return nil
		},
	}
}

type alertTimestamps struct {
	ID           string
	CreatedAt    *time.Time
	UpdatedAt    *time.Time
	DispatchedAt *time.Time
	PlayedAt     *time.Time
	CompletedAt  *time.Time
}

func normaliseAlertTimestamps(tx *gorm.DB) error {
	after := ""
	for {
		var rows []alertTimestamps
		err := tx.Raw(
			`SELECT id, created_at, updated_at, dispatched_at, played_at, completed_at
			FROM alerts WHERE id > ? ORDER BY id LIMIT ?`,
			after, alertTimestampBatch,
		).Scan(&rows).Error
		if err != nil {
			return fmt.Errorf("read alert timestamps: %w", err)
		}
		for _, row := range rows {
			err := tx.Exec(
				`UPDATE alerts SET created_at = ?, updated_at = ?, dispatched_at = ?, played_at = ?, completed_at = ?
				WHERE id = ?`,
				formatAlertTimestamp(row.CreatedAt),
				formatAlertTimestamp(row.UpdatedAt),
				formatAlertTimestamp(row.DispatchedAt),
				formatAlertTimestamp(row.PlayedAt),
				formatAlertTimestamp(row.CompletedAt),
				row.ID,
			).Error
			if err != nil {
				return fmt.Errorf("rewrite timestamps of alert %s: %w", row.ID, err)
			}
		}
		if len(rows) < alertTimestampBatch {
			return nil
		}
		after = rows[len(rows)-1].ID
	}
}

// formatAlertTimestamp is a timestamp in alertTimestampLayout, or NULL for
// one the row does not have.
func formatAlertTimestamp(t *time.Time) interface{} {
	if t == nil {
		return nil
	}
	return t.UTC().Format(alertTimestampLayout)
}
