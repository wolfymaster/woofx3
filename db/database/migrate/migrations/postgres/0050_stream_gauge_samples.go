package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddStreamGaugeSamples creates `stream_gauge_samples`, one row per minute of
// Helix-read levels while the stream is live (docs/services/analytics.md).
//
// Shape decisions the readers depend on:
//
//   - A row is keyed to the segment it was taken in, which is stable across
//     splits; `session_id` is the owner at write time and only informational.
//     Deleting a segment deletes its samples.
//
//   - (segment_id, sampled_at) is unique and sampled_at is a minute, so a
//     minute is sampled at most once and a missing row is a minute that was
//     not sampled.
//
//   - Each metric is nullable on its own, because each comes from a separate
//     Helix call that can fail alone. A row with every metric null would read
//     as "sampled" while saying nothing, so the table refuses it.
func AddStreamGaugeSamples() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0050_stream_gauge_samples",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating stream_gauge_samples...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.stream_gauge_samples (
					id                UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					segment_id        UUID                                   NOT NULL REFERENCES public.stream_session_segments(id) ON UPDATE CASCADE ON DELETE CASCADE,
					session_id        UUID                                   NOT NULL,
					sampled_at        TIMESTAMPTZ                            NOT NULL,
					viewer_count      BIGINT                                 NULL CHECK (viewer_count >= 0),
					follower_total    BIGINT                                 NULL CHECK (follower_total >= 0),
					subscriber_total  BIGINT                                 NULL CHECK (subscriber_total >= 0),
					subscriber_points BIGINT                                 NULL CHECK (subscriber_points >= 0),
					created_at        TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					CONSTRAINT uq_stream_gauge_samples_segment_minute UNIQUE (segment_id, sampled_at),
					CONSTRAINT stream_gauge_samples_has_a_metric CHECK (
						viewer_count IS NOT NULL OR follower_total IS NOT NULL
						OR subscriber_total IS NOT NULL OR subscriber_points IS NOT NULL
					)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_stream_gauge_samples_sampled_at
					ON public.stream_gauge_samples (sampled_at)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("stream_gauge_samples migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`DROP TABLE IF EXISTS public.stream_gauge_samples`).Error
		},
	}
}
