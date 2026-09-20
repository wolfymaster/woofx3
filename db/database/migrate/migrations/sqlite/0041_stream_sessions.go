package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateStreamSessionsTables adds the logical span a broadcast belongs to plus
// the online spans within it. See the postgres migration of the same ID for
// why the two partial unique indexes exist.
//
// SQLite has no `uuid_generate_v4()`, so ids are supplied by the service on
// insert rather than defaulted by the column.
func CreateStreamSessionsTables() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0041_stream_sessions",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating stream_sessions tables...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS stream_sessions (
					id             TEXT                               NOT NULL PRIMARY KEY,
					application_id TEXT                               NOT NULL REFERENCES applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					status         TEXT     DEFAULT 'open'            NOT NULL,
					started_at     TEXT     DEFAULT (datetime('now')) NOT NULL,
					ended_at       TEXT     NULL,
					created_at     TEXT     DEFAULT (datetime('now')) NOT NULL,
					updated_at     TEXT     DEFAULT (datetime('now')) NOT NULL,
					CONSTRAINT stream_sessions_status_check
						CHECK (status IN ('open', 'closed')),
					CONSTRAINT stream_sessions_ended_at_matches_status
						CHECK (
							(status = 'open' AND ended_at IS NULL)
							OR (status = 'closed' AND ended_at IS NOT NULL)
						)
				)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_sessions_one_open_per_app
					ON stream_sessions (application_id) WHERE status = 'open'`,
				`CREATE INDEX IF NOT EXISTS idx_stream_sessions_app_started_at
					ON stream_sessions (application_id, started_at DESC)`,

				`CREATE TABLE IF NOT EXISTS stream_session_segments (
					id                TEXT                               NOT NULL PRIMARY KEY,
					application_id    TEXT                               NOT NULL REFERENCES applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					stream_session_id TEXT                               NOT NULL REFERENCES stream_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					started_at        TEXT     DEFAULT (datetime('now')) NOT NULL,
					ended_at          TEXT     NULL,
					created_at        TEXT     DEFAULT (datetime('now')) NOT NULL,
					updated_at        TEXT     DEFAULT (datetime('now')) NOT NULL,
					CONSTRAINT stream_session_segments_ends_after_start
						CHECK (ended_at IS NULL OR ended_at >= started_at)
				)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_session_segments_one_open_per_app
					ON stream_session_segments (application_id) WHERE ended_at IS NULL`,
				`CREATE INDEX IF NOT EXISTS idx_stream_session_segments_session_started_at
					ON stream_session_segments (stream_session_id, started_at DESC)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("stream_sessions migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Segments first: they carry the FK into sessions.
			return execStatements(tx, []string{
				`DROP TABLE IF EXISTS stream_session_segments`,
				`DROP TABLE IF EXISTS stream_sessions`,
			})
		},
	}
}
