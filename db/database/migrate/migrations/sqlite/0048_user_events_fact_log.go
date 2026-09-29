package sqlite

import (
	"fmt"
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// RebuildUserEventsAsFactLog replaces `user_events` with the append-only log of
// platform events that Analytics reads. See the postgres migration of the same
// ID for the shape decisions.
//
// SQLite has no `uuid_generate_v4()`, so ids are supplied by the service on
// insert rather than defaulted by the column.
//
// The timestamps are declared DATETIME rather than TEXT: the driver hands back a time.Time only for a column declared as a date or
// time type, and a string for TEXT, which GORM cannot scan into a time.Time.
func RebuildUserEventsAsFactLog() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0048_user_events_fact_log",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Rebuilding user_events as the platform event log...")
			if err := assertTableEmpty(tx, "user_events"); err != nil {
				return err
			}
			if err := execStatements(tx, []string{
				`DROP TABLE IF EXISTS user_events`,
				`CREATE TABLE user_events (
					id               TEXT                                NOT NULL PRIMARY KEY,
					event_id         VARCHAR(255)                        NOT NULL,
					source           VARCHAR(255)                        NOT NULL,
					event_type       VARCHAR(100)                        NOT NULL,
					platform         VARCHAR(50)                         NOT NULL,
					platform_user_id VARCHAR(100)                        NULL,
					user_name        VARCHAR(100)                        NULL,
					session_id       VARCHAR(100)                        NULL,
					amount           INTEGER                             NULL,
					event_value      TEXT     DEFAULT '{}'               NOT NULL,
					occurred_at      DATETIME                            NOT NULL,
					created_at       DATETIME DEFAULT (datetime('now'))  NOT NULL,
					CONSTRAINT uq_user_events_source_event_id UNIQUE (source, event_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_user_events_occurred_at
					ON user_events (occurred_at)`,
				`CREATE INDEX IF NOT EXISTS idx_user_events_session_occurred_at
					ON user_events (session_id, occurred_at)`,
				`CREATE INDEX IF NOT EXISTS idx_user_events_type_occurred_at
					ON user_events (event_type, occurred_at)`,
				`CREATE INDEX IF NOT EXISTS idx_user_events_viewer
					ON user_events (platform, platform_user_id) WHERE platform_user_id IS NOT NULL`,
			}); err != nil {
				return err
			}
			log.Println("user_events migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			if err := assertTableEmpty(tx, "user_events"); err != nil {
				return err
			}
			return execStatements(tx, []string{
				`DROP TABLE IF EXISTS user_events`,
				`CREATE TABLE user_events (
					id          TEXT        NOT NULL PRIMARY KEY,
					user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
					event_type  VARCHAR(50) NOT NULL,
					event_value TEXT,
					created_at  TEXT        DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,
			})
		},
	}
}

// assertTableEmpty refuses to continue when a table this migration drops
// holds rows, so recorded history is never discarded as a side effect.
func assertTableEmpty(tx *gorm.DB, table string) error {
	exists, err := tableExists(tx, table)
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}
	var count int64
	if err := tx.Raw(fmt.Sprintf(`SELECT COUNT(*) FROM %s`, table)).Scan(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("%s holds %d rows; this migration rebuilds it and will not discard them", table, count)
	}
	return nil
}
