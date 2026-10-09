package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddViewerFacts creates the per-viewer fact tables: the definitions, the
// running values, and the events already applied to them.
//
// Shape decisions the readers depend on:
//
//   - A fact is data, not a column. Every fact's values share fact_values,
//     keyed (fact_id, platform, subject_id, window_key), so defining a fact
//     never needs a migration. window_key is empty for a lifetime value and the
//     stream session id for a session value; it is never NULL because a NULL
//     would make the primary key admit duplicates.
//
//   - A value is a number or a string. Timestamps (first_at, last_at) are
//     epoch milliseconds in num_value, so leaderboards and range reads sort one
//     column. Session aggregates keep their count in num_value and the last
//     session counted in str_value.
//
//   - value_at_ms is when the value was last folded, in epoch milliseconds:
//     the event time for most aggregates, and the start of the counted
//     session for the session aggregates. Events can arrive out of order (a
//     backfill replays old ones after live counting started), so `last` and
//     the session aggregates compare against it and ignore an older event.
//
//   - aggregate_fn repeats the definition's aggregate so applying an event
//     reads it without decoding the definition body.
//
//   - revision increments on every change to a definition, which also deletes
//     its values in the same transaction. A delta computed against an older
//     revision is dropped rather than applied to the reset values.
//
//   - fact_applied_events makes applying an event idempotent: the insert of
//     (source, event_id) is the first write of the applying transaction, and a
//     conflict means the event was applied before. Rows are pruned by
//     applied_at once redelivery can no longer happen.
//
//   - worker_events.entity_id is widened from 36 characters to 255: a
//     definition change is published through the outbox with the fact id as
//     its entity, and fact ids run to 255 characters. SQLite does not enforce
//     VARCHAR widths, so only Postgres needs it.
func AddViewerFacts() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0056_viewer_facts",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating viewer fact tables...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.fact_definitions (
					id                 VARCHAR(255)                   NOT NULL PRIMARY KEY,
					name               TEXT                           NOT NULL,
					description        TEXT        DEFAULT ''         NOT NULL,
					definition         JSONB                          NOT NULL,
					aggregate_fn       VARCHAR(20)                   NOT NULL CHECK (aggregate_fn IN ('count', 'sum', 'min', 'max', 'last', 'first_at', 'last_at', 'sessions', 'session_streak')),
					value_kind         VARCHAR(20)                    NOT NULL CHECK (value_kind IN ('number', 'string', 'timestamp')),
					window_kind        VARCHAR(20)                    NOT NULL CHECK (window_kind IN ('lifetime', 'session')),
					revision           BIGINT      DEFAULT 1          NOT NULL CHECK (revision >= 1),
					created_by_type    TEXT        DEFAULT 'USER'     NOT NULL,
					created_by_ref     TEXT        DEFAULT ''         NOT NULL,
					counting_since     TIMESTAMPTZ DEFAULT NOW()      NOT NULL,
					backfilled_through TIMESTAMPTZ                    NULL,
					created_at         TIMESTAMPTZ DEFAULT NOW()      NOT NULL,
					updated_at         TIMESTAMPTZ DEFAULT NOW()      NOT NULL
				)`,
				`CREATE TABLE IF NOT EXISTS public.fact_values (
					fact_id      VARCHAR(255)                NOT NULL REFERENCES public.fact_definitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					platform     VARCHAR(50)                 NOT NULL,
					subject_id   VARCHAR(100)                NOT NULL,
					window_key   VARCHAR(100) DEFAULT ''     NOT NULL,
					num_value    DOUBLE PRECISION            NULL,
					str_value    TEXT                        NULL,
					value_at_ms  BIGINT                      NULL,
					subject_name VARCHAR(100)                NULL,
					updated_at   TIMESTAMPTZ  DEFAULT NOW()  NOT NULL,
					PRIMARY KEY (fact_id, platform, subject_id, window_key)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_fact_values_fact_window_num
					ON public.fact_values (fact_id, window_key, num_value)`,
				`CREATE INDEX IF NOT EXISTS idx_fact_values_subject
					ON public.fact_values (platform, subject_id)`,
				`CREATE TABLE IF NOT EXISTS public.fact_applied_events (
					source     VARCHAR(255)               NOT NULL,
					event_id   VARCHAR(255)               NOT NULL,
					applied_at TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
					PRIMARY KEY (source, event_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_fact_applied_events_applied_at
					ON public.fact_applied_events (applied_at)`,
				`ALTER TABLE public.worker_events ALTER COLUMN entity_id TYPE VARCHAR(255)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("viewer fact tables migration complete")
			return nil
		},
		// entity_id stays widened: narrowing it fails once a longer id is stored.
		Rollback: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`DROP TABLE IF EXISTS public.fact_applied_events`,
				`DROP TABLE IF EXISTS public.fact_values`,
				`DROP TABLE IF EXISTS public.fact_definitions`,
			} {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
