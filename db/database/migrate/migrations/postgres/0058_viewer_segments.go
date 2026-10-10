package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddViewerSegments creates the segment tables: the definitions, the facts
// each one reads, and the viewers currently in each.
//
// Shape decisions the readers depend on:
//
//   - A segment is a condition tree over one viewer's facts, stored as JSON in
//     `condition`. time_relative and window_kind are derived from it when it is
//     saved, so applying an event can tell how to diff membership without
//     decoding every tree: a time-relative segment (one with a within or
//     older_than atom) can change with time alone, and a segment reading any
//     session-window fact is kept per stream session.
//
//   - segment_facts lists the facts a segment reads, indexed by fact, which is
//     how an apply finds the segments a changed value can move. Its fact_id
//     restricts deletes: a fact a segment reads cannot be deleted from under it.
//
//   - segment_members holds one row per viewer in a segment. window_key is
//     empty for a lifetime segment and the stream session id for a session
//     segment; a row from an earlier session means "not a member", so a new
//     session empties a session segment without deleting (and announcing) every
//     row at the boundary. The key is (segment, viewer), not the window: a
//     viewer is in a segment's current window or not at all.
//
//   - revision increments when the condition changes, which refills the
//     membership in the same transaction.
//
//   - stale is true while the membership is not what the condition says of
//     the stored values: a refill was due while the segment was frozen (a fact
//     it reads was not active), so it was skipped. Such a segment is refilled
//     once everything it reads is active again.
//
// worker_events.extensions carries the CloudEvent extensions an engine event
// is published with, such as a segment edge's platform, which consumers read
// from the envelope rather than the data.
func AddViewerSegments() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0058_viewer_segments",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating viewer segment tables...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.segment_definitions (
					id              VARCHAR(255)                   NOT NULL PRIMARY KEY,
					name            TEXT                           NOT NULL,
					description     TEXT        DEFAULT ''         NOT NULL,
					condition       JSONB                          NOT NULL,
					window_kind     VARCHAR(20)                    NOT NULL CHECK (window_kind IN ('lifetime', 'session')),
					time_relative   BOOLEAN     DEFAULT FALSE      NOT NULL,
					stale           BOOLEAN     DEFAULT FALSE      NOT NULL,
					revision        BIGINT      DEFAULT 1          NOT NULL CHECK (revision >= 1),
					created_by_type TEXT        DEFAULT 'USER'     NOT NULL,
					created_by_ref  TEXT        DEFAULT ''         NOT NULL,
					created_at      TIMESTAMPTZ DEFAULT NOW()      NOT NULL,
					updated_at      TIMESTAMPTZ DEFAULT NOW()      NOT NULL
				)`,
				`CREATE TABLE IF NOT EXISTS public.segment_facts (
					segment_id VARCHAR(255) NOT NULL REFERENCES public.segment_definitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					fact_id    VARCHAR(255) NOT NULL REFERENCES public.fact_definitions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
					PRIMARY KEY (segment_id, fact_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_segment_facts_fact
					ON public.segment_facts (fact_id)`,
				`CREATE TABLE IF NOT EXISTS public.segment_members (
					segment_id VARCHAR(255)               NOT NULL REFERENCES public.segment_definitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					platform   VARCHAR(50)                NOT NULL,
					subject_id VARCHAR(100)               NOT NULL,
					window_key VARCHAR(100) DEFAULT ''    NOT NULL,
					entered_at TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
					PRIMARY KEY (segment_id, platform, subject_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_segment_members_subject
					ON public.segment_members (platform, subject_id)`,
				`ALTER TABLE public.worker_events ADD COLUMN IF NOT EXISTS extensions JSONB NULL`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("viewer segment tables migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`ALTER TABLE public.worker_events DROP COLUMN IF EXISTS extensions`,
				`DROP TABLE IF EXISTS public.segment_members`,
				`DROP TABLE IF EXISTS public.segment_facts`,
				`DROP TABLE IF EXISTS public.segment_definitions`,
			} {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
