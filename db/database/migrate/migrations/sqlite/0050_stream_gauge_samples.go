package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddStreamGaugeSamples creates `stream_gauge_samples`, one row per minute of
// Helix-read levels while the stream is live. See the postgres migration of
// the same ID for the shape decisions.
//
// Ids are supplied by the service on insert, since SQLite has no
// `uuid_generate_v4()`, and the timestamps are DATETIME so the driver returns
// them as a time.Time.
func AddStreamGaugeSamples() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0050_stream_gauge_samples",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating stream_gauge_samples...")
			if err := execStatements(tx, []string{
				`CREATE TABLE IF NOT EXISTS stream_gauge_samples (
					id                TEXT                                NOT NULL PRIMARY KEY,
					segment_id        TEXT                                NOT NULL REFERENCES stream_session_segments(id) ON UPDATE CASCADE ON DELETE CASCADE,
					session_id        TEXT                                NOT NULL,
					sampled_at        DATETIME                            NOT NULL,
					viewer_count      INTEGER                             NULL CHECK (viewer_count >= 0),
					follower_total    INTEGER                             NULL CHECK (follower_total >= 0),
					subscriber_total  INTEGER                             NULL CHECK (subscriber_total >= 0),
					subscriber_points INTEGER                             NULL CHECK (subscriber_points >= 0),
					created_at        DATETIME DEFAULT (datetime('now'))  NOT NULL,
					CONSTRAINT uq_stream_gauge_samples_segment_minute UNIQUE (segment_id, sampled_at),
					CONSTRAINT stream_gauge_samples_has_a_metric CHECK (
						viewer_count IS NOT NULL OR follower_total IS NOT NULL
						OR subscriber_total IS NOT NULL OR subscriber_points IS NOT NULL
					)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_stream_gauge_samples_sampled_at
					ON stream_gauge_samples (sampled_at)`,
			}); err != nil {
				return err
			}
			log.Println("stream_gauge_samples migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{`DROP TABLE IF EXISTS stream_gauge_samples`})
		},
	}
}
