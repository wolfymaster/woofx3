package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddSessionCompaction creates the permanent per-session copies of what the
// analytics reads need from user_events. See the postgres migration of the
// same ID for the shape decisions.
//
// Timestamps are DATETIME so the driver returns them as a time.Time. The
// compaction copies them from user_events and stream_sessions as stored, so
// they compare as text against the rows they came from.
func AddSessionCompaction() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0061_session_compaction",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating session compaction tables...")
			if err := execStatements(tx, []string{
				`CREATE TABLE IF NOT EXISTS stream_session_compactions (
					session_id        TEXT     NOT NULL PRIMARY KEY REFERENCES stream_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					window_started_at DATETIME NOT NULL,
					window_ended_at   DATETIME NOT NULL,
					compacted_at      DATETIME NOT NULL,
					pruned_at         DATETIME NULL,
					CONSTRAINT stream_session_compactions_window CHECK (window_ended_at >= window_started_at)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_stream_session_compactions_window
					ON stream_session_compactions (window_started_at, window_ended_at)`,
				`CREATE TABLE IF NOT EXISTS viewer_session_totals (
					session_id       TEXT                    NOT NULL REFERENCES stream_session_compactions(session_id) ON UPDATE CASCADE ON DELETE CASCADE,
					platform         VARCHAR(50)             NOT NULL,
					platform_user_id VARCHAR(100)            NOT NULL,
					user_name        VARCHAR(100)            NULL,
					last_named_at    DATETIME                NULL,
					bits             INTEGER      DEFAULT 0  NOT NULL CHECK (bits >= 0),
					cheers           INTEGER      DEFAULT 0  NOT NULL CHECK (cheers >= 0),
					gifted_subs      INTEGER      DEFAULT 0  NOT NULL CHECK (gifted_subs >= 0),
					gifts            INTEGER      DEFAULT 0  NOT NULL CHECK (gifts >= 0),
					subs             INTEGER      DEFAULT 0  NOT NULL CHECK (subs >= 0),
					PRIMARY KEY (session_id, platform, platform_user_id),
					CONSTRAINT viewer_session_totals_name_has_time CHECK ((user_name IS NULL) = (last_named_at IS NULL))
				)`,
				`CREATE INDEX IF NOT EXISTS idx_viewer_session_totals_viewer
					ON viewer_session_totals (platform, platform_user_id)`,
				`CREATE TABLE IF NOT EXISTS session_timeline_events (
					session_id         TEXT         NOT NULL REFERENCES stream_session_compactions(session_id) ON UPDATE CASCADE ON DELETE CASCADE,
					user_event_id      TEXT         NOT NULL,
					event_id           VARCHAR(255) NOT NULL,
					source             VARCHAR(255) NOT NULL,
					event_type         VARCHAR(100) NOT NULL,
					platform           VARCHAR(50)  NOT NULL,
					platform_user_id   VARCHAR(100) NULL,
					user_name          VARCHAR(100) NULL,
					stamped_session_id VARCHAR(100) NULL,
					amount             INTEGER      NULL,
					occurred_at        DATETIME     NOT NULL,
					recorded_at        DATETIME     NOT NULL,
					PRIMARY KEY (session_id, user_event_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_session_timeline_events_order
					ON session_timeline_events (session_id, occurred_at, user_event_id)`,
			}); err != nil {
				return err
			}
			log.Println("session compaction migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{
				`DROP TABLE IF EXISTS session_timeline_events`,
				`DROP TABLE IF EXISTS viewer_session_totals`,
				`DROP TABLE IF EXISTS stream_session_compactions`,
			})
		},
	}
}
