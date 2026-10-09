package sqlite

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database"
	"gorm.io/gorm"
)

// alertTimestampBatch is how many rows one read of the rewrite holds at once.
const alertTimestampBatch = 500

// alertTimestampColumns are the timestamp columns of `alerts`.
var alertTimestampColumns = []string{"created_at", "updated_at", "dispatched_at", "played_at", "completed_at"}

// NormaliseAlertTimestamps rewrites every timestamp in `alerts` to UTC in
// database.SQLiteTimestampLayout.
//
// SQLite stores a timestamp as text and compares it as text, so ORDER BY
// created_at is time order only while every row uses one layout and one zone.
// The alert repository writes that layout; rows the driver wrote hold Go's
// time.String() in the engine's local zone (with a varying number of
// fractional digits, and an offset that changes with daylight saving), and
// column defaults hold `datetime('now')`. Each is parsed and written back in
// the repository's layout, so the newest row of an envelope and the alert
// log's order are right across rows written before and after.
//
// Values are read as text and parsed here, in every layout the driver decodes
// (see parseStoredAlertTimestamp), rather than scanned through the driver: one
// value the driver cannot decode would fail the scan, and with it the
// migration and the engine's boot. A value that does not parse is logged and
// left as it is; only its row's order in the alert log can be wrong.
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

type alertTimestampText struct {
	ID           string
	CreatedAt    *string
	UpdatedAt    *string
	DispatchedAt *string
	PlayedAt     *string
	CompletedAt  *string
}

func (row alertTimestampText) values() []*string {
	return []*string{row.CreatedAt, row.UpdatedAt, row.DispatchedAt, row.PlayedAt, row.CompletedAt}
}

func normaliseAlertTimestamps(tx *gorm.DB) error {
	after := ""
	for {
		var rows []alertTimestampText
		err := tx.Raw(
			`SELECT id, CAST(created_at AS TEXT) AS created_at, CAST(updated_at AS TEXT) AS updated_at,
				CAST(dispatched_at AS TEXT) AS dispatched_at, CAST(played_at AS TEXT) AS played_at,
				CAST(completed_at AS TEXT) AS completed_at
			FROM alerts WHERE id > ? ORDER BY id LIMIT ?`,
			after, alertTimestampBatch,
		).Scan(&rows).Error
		if err != nil {
			return fmt.Errorf("read alert timestamps: %w", err)
		}
		for _, row := range rows {
			if err := rewriteAlertTimestamps(tx, row); err != nil {
				return err
			}
		}
		if len(rows) < alertTimestampBatch {
			return nil
		}
		after = rows[len(rows)-1].ID
	}
}

// rewriteAlertTimestamps writes back each of the row's timestamps that parses,
// in the repository's layout. NULLs and values that do not parse are left.
func rewriteAlertTimestamps(tx *gorm.DB, row alertTimestampText) error {
	sets := make([]string, 0, len(alertTimestampColumns))
	args := make([]interface{}, 0, len(alertTimestampColumns)+1)
	for i, value := range row.values() {
		if value == nil {
			continue
		}
		parsed, ok := parseStoredAlertTimestamp(*value)
		if !ok {
			log.Printf("0055_alert_timestamps_utc: alert %s: %s %q is not a timestamp; left as it is",
				row.ID, alertTimestampColumns[i], *value)
			continue
		}
		sets = append(sets, alertTimestampColumns[i]+" = ?")
		args = append(args, parsed.UTC().Format(database.SQLiteTimestampLayout))
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, row.ID)
	if err := tx.Exec(`UPDATE alerts SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...).Error; err != nil {
		return fmt.Errorf("rewrite timestamps of alert %s: %w", row.ID, err)
	}
	return nil
}

// timeStringLayout is the layout of Go's time.String() without its monotonic
// clock reading.
const timeStringLayout = "2006-01-02 15:04:05.999999999 -0700 MST"

// storedAlertTimestampLayouts are the layouts, other than time.String(), that
// the SQLite driver decodes (modernc.org/sqlite's parseTimeFormats). A value
// without an offset is UTC, as the driver reads it.
var storedAlertTimestampLayouts = []string{
	"2006-01-02 15:04:05.999999999-07:00",
	"2006-01-02T15:04:05.999999999-07:00",
	"2006-01-02 15:04:05.999999999",
	"2006-01-02T15:04:05.999999999",
	"2006-01-02 15:04",
	"2006-01-02T15:04",
	"2006-01-02",
}

// parseStoredAlertTimestamp parses a stored timestamp in any layout the driver
// decodes: time.String(), with or without its monotonic clock reading, or one
// of storedAlertTimestampLayouts, optionally ending in Z.
func parseStoredAlertTimestamp(value string) (time.Time, bool) {
	withoutMonotonic, _, _ := strings.Cut(value, " m=")
	if t, err := time.Parse(timeStringLayout, strings.TrimSpace(withoutMonotonic)); err == nil {
		return t, true
	}
	trimmed := strings.TrimSuffix(value, "Z")
	for _, layout := range storedAlertTimestampLayouts {
		if t, err := time.Parse(layout, trimmed); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
