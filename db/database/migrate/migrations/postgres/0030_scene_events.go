package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateSceneEventsTables adds the durable, at-least-once scene event
// delivery pipeline: three tables that together let sceneManager
// guarantee every engine-triggered event reaches the browser session,
// survive its own restarts without losing track of what's unconfirmed,
// and keep a full, replayable timeline. This is a transactional-outbox
// pattern, not a queue — see docs on sceneManager's event delivery
// design for the full contract.
//
//   - `scene_events` (append-only): one row per originating engine
//     event — the "parent". `value` is the full CloudEvent-shaped
//     payload, kept verbatim so a historical event can be replayed.
//
//   - `scene_event_log` (append-only): the full timeline — one row per
//     state *transition* per (event, widget instance), never updated,
//     only inserted. "delivered" is written when the browser's
//     per-instance queue acks receipt+enqueue; "completed" is written
//     when that widget finishes (auto or explicit) — a second,
//     independent row, not an update to the first. `scene_event_id` is
//     "a reference to its single parent" per the design requirement.
//
//   - `scene_event_deliveries` (mutable, small — the *working set*,
//     not the historical record): one row per fan-out target, created
//     alongside the parent `scene_events` row so the full target set
//     is known durably before any ack arrives. Updated in place on
//     each ack; the row is deleted once `completed_at` is set. Because
//     it only ever holds *open* deliveries, this table stays small
//     regardless of total event volume — a full-table scan of it is
//     exactly "every currently-unconfirmed delivery", which is what
//     sceneManager loads into memory on startup.
func CreateSceneEventsTables() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0030_scene_events",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating scene_events, scene_event_log, scene_event_deliveries tables...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.scene_events (
					id             UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					scene_id       UUID                                    NOT NULL REFERENCES public.scenes(id) ON UPDATE CASCADE ON DELETE CASCADE,
					application_id UUID                                    NOT NULL REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					type           TEXT                                    NOT NULL,
					key            TEXT                                    NOT NULL,
					value          JSONB        DEFAULT '{}'::jsonb        NOT NULL,
					occurred_at    TIMESTAMPTZ                             NOT NULL,
					created_at     TIMESTAMPTZ  DEFAULT NOW()              NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_scene_events_scene_occurred
					ON public.scene_events (scene_id, occurred_at)`,

				`CREATE TABLE IF NOT EXISTS public.scene_event_log (
					id             UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					scene_event_id UUID                                    NOT NULL REFERENCES public.scene_events(id) ON UPDATE CASCADE ON DELETE CASCADE,
					scene_id       UUID                                    NOT NULL REFERENCES public.scenes(id) ON UPDATE CASCADE ON DELETE CASCADE,
					instance_id    TEXT                                    NOT NULL,
					kind           TEXT                                    NOT NULL,
					occurred_at    TIMESTAMPTZ                             NOT NULL,
					created_at     TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					CONSTRAINT scene_event_log_kind_check CHECK (kind IN ('delivered', 'completed', 'failed'))
				)`,
				// Replay/timeline-by-parent is the primary read path.
				`CREATE INDEX IF NOT EXISTS idx_scene_event_log_scene_event
					ON public.scene_event_log (scene_event_id)`,
				// Scene-scoped timeline (dashboard/replay browsing without
				// pinning to one event id).
				`CREATE INDEX IF NOT EXISTS idx_scene_event_log_scene_occurred
					ON public.scene_event_log (scene_id, occurred_at)`,

				`CREATE TABLE IF NOT EXISTS public.scene_event_deliveries (
					scene_event_id   UUID                       NOT NULL REFERENCES public.scene_events(id) ON UPDATE CASCADE ON DELETE CASCADE,
					scene_id         UUID                       NOT NULL REFERENCES public.scenes(id) ON UPDATE CASCADE ON DELETE CASCADE,
					instance_id      TEXT                       NOT NULL,
					delivered_at     TIMESTAMPTZ  NULL,
					completed_at     TIMESTAMPTZ  NULL,
					last_attempt_at  TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
					created_at       TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
					PRIMARY KEY (scene_event_id, instance_id)
				)`,
				// Startup hydration buckets the working set by scene; the
				// table is small (open deliveries only) so this index
				// mainly keeps per-scene reconnect replay cheap.
				`CREATE INDEX IF NOT EXISTS idx_scene_event_deliveries_scene
					ON public.scene_event_deliveries (scene_id)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("scene_events migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP TABLE IF EXISTS public.scene_event_deliveries`,
				`DROP TABLE IF EXISTS public.scene_event_log`,
				`DROP TABLE IF EXISTS public.scene_events`,
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
