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
//   - revision increments on every change to a definition, which also deletes
//     its values in the same transaction. A delta computed against an older
//     revision is dropped rather than applied to the reset values.
//
//   - fact_applied_events makes applying an event idempotent: the insert of
//     (source, event_id) is the first write of the applying transaction, and a
//     conflict means the event was applied before. Rows are pruned by
//     applied_at once redelivery can no longer happen.
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
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("viewer fact tables migration complete")
			return nil
		},
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
