package postgres

import (
	"fmt"
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// RebuildUserEventsAsFactLog replaces `user_events` with the append-only log of
// platform events that Analytics reads (docs/services/analytics.md).
//
// The table it replaces never had a writer, and its shape could not serve the
// log: every row needed a `users` row, which an anonymous cheer does not have,
// and it held neither the session an event happened in nor anything to dedupe a
// redelivery on. It is rebuilt rather than altered, and refuses to drop rows it
// did not expect to find.
//
// Shape decisions the readers depend on:
//
//   - The viewer is stored as the platform's own id and display name rather
//     than a `users` foreign key. Writing a fact must not depend on first
//     creating a user, and "delete everything about this viewer" is one
//     predicate on this table. A null platform_user_id means the event is not
//     attributable to anyone: anonymous cheers and gifts land there, so a
//     leaderboard cannot credit them to somebody.
//
//   - `amount` is a real column, not a key inside event_value, because every
//     aggregate sums it and SQLite's JSON extraction is far weaker than
//     Postgres's. Null when the event carries no quantity.
//
//   - (source, event_id) is unique: CloudEvents defines that pair as an
//     event's identity, so a redelivered event is a conflict, not a second row.
//
//   - `session_id` is the stamp the event carried, not a foreign key. It is not
//     a stable key (a split moves segments between sessions afterwards), and a
//     fact must still be recorded when its stamp is missing or unknown.
//
//   - `occurred_at` is when the event happened; `created_at` is when it was
//     written. The time axis every reader groups on is occurred_at.
func RebuildUserEventsAsFactLog() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0048_user_events_fact_log",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Rebuilding user_events as the platform event log...")
			if err := assertTableEmpty(tx, "public.user_events"); err != nil {
				return err
			}
			statements := []string{
				`DROP TABLE IF EXISTS public.user_events`,
				`CREATE TABLE public.user_events (
					id               UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					event_id         VARCHAR(255)                            NOT NULL,
					source           VARCHAR(255)                            NOT NULL,
					event_type       VARCHAR(100)                            NOT NULL,
					platform         VARCHAR(50)                             NOT NULL,
					platform_user_id VARCHAR(100)                            NULL,
					user_name        VARCHAR(100)                            NULL,
					session_id       VARCHAR(100)                            NULL,
					amount           BIGINT                                  NULL,
					event_value      JSONB        DEFAULT '{}'               NOT NULL,
					occurred_at      TIMESTAMPTZ                             NOT NULL,
					created_at       TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					CONSTRAINT uq_user_events_source_event_id UNIQUE (source, event_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_user_events_occurred_at
					ON public.user_events (occurred_at)`,
				`CREATE INDEX IF NOT EXISTS idx_user_events_session_occurred_at
					ON public.user_events (session_id, occurred_at)`,
				`CREATE INDEX IF NOT EXISTS idx_user_events_type_occurred_at
					ON public.user_events (event_type, occurred_at)`,
				`CREATE INDEX IF NOT EXISTS idx_user_events_viewer
					ON public.user_events (platform, platform_user_id) WHERE platform_user_id IS NOT NULL`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("user_events migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			if err := assertTableEmpty(tx, "public.user_events"); err != nil {
				return err
			}
			statements := []string{
				`DROP TABLE IF EXISTS public.user_events`,
				`CREATE TABLE public.user_events (
					id          UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					user_id     UUID                                   NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
					event_type  VARCHAR(50)                            NOT NULL,
					event_value JSONB,
					created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,
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

// assertTableEmpty refuses to continue when a table this migration drops
// holds rows, so recorded history is never discarded as a side effect.
func assertTableEmpty(tx *gorm.DB, table string) error {
	var exists bool
	if err := tx.Raw(`SELECT to_regclass(?) IS NOT NULL`, table).Row().Scan(&exists); err != nil {
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
