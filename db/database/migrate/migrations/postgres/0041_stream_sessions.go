package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateStreamSessionsTables adds the logical span a broadcast belongs to,
// plus the online spans within it. A session may cover several
// online/offline cycles, so it is not the same thing as "the stream is live" —
// that is what segments record.
//
// Two partial unique indexes carry invariants the design depends on:
//
//   - At most one open session per application. "A session is always present
//     and only ends when a new one replaces it" is only true if nothing can
//     open a second one concurrently, and two engines racing on `stream.online`
//     is exactly how that would happen.
//
//   - At most one open segment per application. A duplicate `stream.online`
//     notification (Twitch redelivers them) must not leave two segments open,
//     because then "when did the stream last go down" has two answers.
//
// Enforcing both in the schema rather than in the resolver means a bug there
// fails a write instead of silently corrupting the history every future
// aggregate will be computed from.
func CreateStreamSessionsTables() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0041_stream_sessions",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating stream_sessions tables...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.stream_sessions (
					id             UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					application_id UUID                                    NOT NULL REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					status         TEXT         DEFAULT 'open'             NOT NULL,
					started_at     TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					ended_at       TIMESTAMPTZ  NULL,
					created_at     TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					updated_at     TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					CONSTRAINT stream_sessions_status_check
						CHECK (status IN ('open', 'closed')),
					-- An open session has not ended; a closed one has. Keeps
					-- the two columns from disagreeing about the same fact.
					CONSTRAINT stream_sessions_ended_at_matches_status
						CHECK (
							(status = 'open' AND ended_at IS NULL)
							OR (status = 'closed' AND ended_at IS NOT NULL)
						)
				)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_sessions_one_open_per_app
					ON public.stream_sessions (application_id) WHERE status = 'open'`,
				// Listing history is always newest-first within an application.
				`CREATE INDEX IF NOT EXISTS idx_stream_sessions_app_started_at
					ON public.stream_sessions (application_id, started_at DESC)`,

				`CREATE TABLE IF NOT EXISTS public.stream_session_segments (
					id                UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					application_id    UUID                                    NOT NULL REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					stream_session_id UUID                                    NOT NULL REFERENCES public.stream_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					started_at        TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					ended_at          TIMESTAMPTZ  NULL,
					created_at        TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					updated_at        TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					CONSTRAINT stream_session_segments_ends_after_start
						CHECK (ended_at IS NULL OR ended_at >= started_at)
				)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_session_segments_one_open_per_app
					ON public.stream_session_segments (application_id) WHERE ended_at IS NULL`,
				// The resolver's hot read: the most recent segment of a session,
				// to find out when the stream last went down.
				`CREATE INDEX IF NOT EXISTS idx_stream_session_segments_session_started_at
					ON public.stream_session_segments (stream_session_id, started_at DESC)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("stream_sessions migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Segments first: they carry the FK into sessions.
			statements := []string{
				`DROP TABLE IF EXISTS public.stream_session_segments`,
				`DROP TABLE IF EXISTS public.stream_sessions`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
