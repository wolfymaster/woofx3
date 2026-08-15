package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateSceneEventsTables adds scene_events, scene_event_log, and
// scene_event_deliveries.
func CreateSceneEventsTables() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0030_scene_events",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating scene_events, scene_event_log, scene_event_deliveries tables...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS scene_events (
					id             TEXT         NOT NULL PRIMARY KEY,
					scene_id       TEXT         NOT NULL REFERENCES scenes(id) ON UPDATE CASCADE ON DELETE CASCADE,
					application_id TEXT         NOT NULL REFERENCES applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					type           TEXT                                    NOT NULL,
					key            TEXT                                    NOT NULL,
					value          TEXT         DEFAULT '{}'               NOT NULL,
					occurred_at    TEXT                                    NOT NULL,
					created_at     TEXT         DEFAULT (datetime('now'))  NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_scene_events_scene_occurred
					ON scene_events (scene_id, occurred_at)`,

				`CREATE TABLE IF NOT EXISTS scene_event_log (
					id             TEXT         NOT NULL PRIMARY KEY,
					scene_event_id TEXT         NOT NULL REFERENCES scene_events(id) ON UPDATE CASCADE ON DELETE CASCADE,
					scene_id       TEXT         NOT NULL REFERENCES scenes(id) ON UPDATE CASCADE ON DELETE CASCADE,
					instance_id    TEXT                                    NOT NULL,
					kind           TEXT                                    NOT NULL,
					occurred_at    TEXT                                    NOT NULL,
					created_at     TEXT         DEFAULT (datetime('now'))  NOT NULL,
					CONSTRAINT scene_event_log_kind_check CHECK (kind IN ('delivered', 'completed', 'failed'))
				)`,
				`CREATE INDEX IF NOT EXISTS idx_scene_event_log_scene_event
					ON scene_event_log (scene_event_id)`,
				`CREATE INDEX IF NOT EXISTS idx_scene_event_log_scene_occurred
					ON scene_event_log (scene_id, occurred_at)`,

				`CREATE TABLE IF NOT EXISTS scene_event_deliveries (
					scene_event_id   TEXT                       NOT NULL REFERENCES scene_events(id) ON UPDATE CASCADE ON DELETE CASCADE,
					scene_id         TEXT                       NOT NULL REFERENCES scenes(id) ON UPDATE CASCADE ON DELETE CASCADE,
					instance_id      TEXT                       NOT NULL,
					delivered_at     TEXT  NULL,
					completed_at     TEXT  NULL,
					last_attempt_at  TEXT  DEFAULT (datetime('now')) NOT NULL,
					created_at       TEXT  DEFAULT (datetime('now')) NOT NULL,
					PRIMARY KEY (scene_event_id, instance_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_scene_event_deliveries_scene
					ON scene_event_deliveries (scene_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("scene_events migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP TABLE IF EXISTS scene_event_deliveries`,
				`DROP TABLE IF EXISTS scene_event_log`,
				`DROP TABLE IF EXISTS scene_events`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
