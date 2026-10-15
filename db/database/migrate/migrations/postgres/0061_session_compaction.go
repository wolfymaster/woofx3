package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddSessionCompaction creates the permanent per-session copies of what the
// analytics reads need from user_events, so the raw log can be pruned once a
// session has ended (docs/services/analytics.md).
//
// Shape decisions the readers depend on:
//
//   - stream_session_compactions is the record that a session was compacted,
//     and of the span of time its rows cover: the session's bounds when it was
//     compacted. A raw event inside a recorded window is read from the compact
//     tables, never from user_events, so the reads give the same answer
//     whether the raw row has been pruned yet or not. Closed sessions tile time
//     and their bounds do not move, so windows never overlap.
//
//   - compacted_at is the db proxy's clock, the same clock user_events.created_at
//     is written with. A raw row recorded into a window after its compaction
//     (a write retried across the session's end) is newer than compacted_at,
//     which is how the cleaner finds a session to compact again and why it
//     never prunes such a row.
//
//   - pruned_at is set, before the first raw row of the window is deleted,
//     once the cleaner prunes it. From then on the copy is the only record of
//     the session and is never rebuilt from what is left of the raw log.
//
//   - viewer_session_totals holds one row per viewer with any event in the
//     session, whatever its type, because the name a viewer is shown under is
//     the one on their latest named event of any type. last_named_at is when
//     the session's latest named event happened, so the latest name across
//     sessions can still be picked after the raw rows are gone.
//
//   - session_timeline_events is exactly the rows the session timeline lists,
//     without event_value: everything a UserEvent carries besides its payload.
//     user_event_id is the raw row's id, which orders events at one instant.
//
//   - Children reference the compaction record, so dropping a record drops
//     what it covered, and a record exists for every compacted row.
func AddSessionCompaction() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0061_session_compaction",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating session compaction tables...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.stream_session_compactions (
					session_id        UUID        NOT NULL PRIMARY KEY REFERENCES public.stream_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					window_started_at TIMESTAMPTZ NOT NULL,
					window_ended_at   TIMESTAMPTZ NOT NULL,
					compacted_at      TIMESTAMPTZ NOT NULL,
					pruned_at         TIMESTAMPTZ NULL,
					CONSTRAINT stream_session_compactions_window CHECK (window_ended_at >= window_started_at)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_stream_session_compactions_window
					ON public.stream_session_compactions (window_started_at, window_ended_at)`,
				`CREATE TABLE IF NOT EXISTS public.viewer_session_totals (
					session_id       UUID                    NOT NULL REFERENCES public.stream_session_compactions(session_id) ON UPDATE CASCADE ON DELETE CASCADE,
					platform         VARCHAR(50)             NOT NULL,
					platform_user_id VARCHAR(100)            NOT NULL,
					user_name        VARCHAR(100)            NULL,
					last_named_at    TIMESTAMPTZ             NULL,
					bits             BIGINT       DEFAULT 0  NOT NULL CHECK (bits >= 0),
					cheers           BIGINT       DEFAULT 0  NOT NULL CHECK (cheers >= 0),
					gifted_subs      BIGINT       DEFAULT 0  NOT NULL CHECK (gifted_subs >= 0),
					gifts            BIGINT       DEFAULT 0  NOT NULL CHECK (gifts >= 0),
					subs             BIGINT       DEFAULT 0  NOT NULL CHECK (subs >= 0),
					PRIMARY KEY (session_id, platform, platform_user_id),
					CONSTRAINT viewer_session_totals_name_has_time CHECK ((user_name IS NULL) = (last_named_at IS NULL))
				)`,
				`CREATE INDEX IF NOT EXISTS idx_viewer_session_totals_viewer
					ON public.viewer_session_totals (platform, platform_user_id)`,
				`CREATE TABLE IF NOT EXISTS public.session_timeline_events (
					session_id         UUID         NOT NULL REFERENCES public.stream_session_compactions(session_id) ON UPDATE CASCADE ON DELETE CASCADE,
					user_event_id      UUID         NOT NULL,
					event_id           VARCHAR(255) NOT NULL,
					source             VARCHAR(255) NOT NULL,
					event_type         VARCHAR(100) NOT NULL,
					platform           VARCHAR(50)  NOT NULL,
					platform_user_id   VARCHAR(100) NULL,
					user_name          VARCHAR(100) NULL,
					stamped_session_id VARCHAR(100) NULL,
					amount             BIGINT       NULL,
					occurred_at        TIMESTAMPTZ  NOT NULL,
					recorded_at        TIMESTAMPTZ  NOT NULL,
					PRIMARY KEY (session_id, user_event_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_session_timeline_events_order
					ON public.session_timeline_events (session_id, occurred_at, user_event_id)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("session compaction migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`DROP TABLE IF EXISTS public.session_timeline_events`,
				`DROP TABLE IF EXISTS public.viewer_session_totals`,
				`DROP TABLE IF EXISTS public.stream_session_compactions`,
			} {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
