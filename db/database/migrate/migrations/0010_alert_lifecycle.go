package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddAlertLifecycle widens the `alerts.status` enum and adds the lifecycle
// timestamp columns needed for the widget-completion ack flow.
//
// Status values after this migration: `sent` | `playing` | `completed` |
// `failed` (Phase 1). Phase 2 will add `pending` / `dispatched` /
// `timed_out` / `skipped` once the backend queue lands.
//
// `envelope_id` is a denormalisation of `payload->>'id'`. The UI's status
// reports key on the AlertPayload envelope id, not the alerts row id, so we
// need fast `WHERE envelope_id = ?` lookups when the UI acks. Populated on
// row insert by the api; the index is partial so existing rows without an
// envelope id (manual / legacy inserts) don't pollute the index.
//
// `error` captures the message from a `failed` ack (e.g. autoplay block,
// missing media). Empty string is the "no error" sentinel — same convention
// as `source_event_id`.
func AddAlertLifecycle() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0010_alert_lifecycle",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding alerts lifecycle columns...")
			statements := []string{
				`ALTER TABLE public.alerts
					ADD COLUMN IF NOT EXISTS envelope_id   TEXT        NOT NULL DEFAULT '',
					ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
					ADD COLUMN IF NOT EXISTS played_at     TIMESTAMPTZ,
					ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ,
					ADD COLUMN IF NOT EXISTS error         TEXT        NOT NULL DEFAULT ''`,
				`CREATE INDEX IF NOT EXISTS idx_alerts_envelope_id
					ON public.alerts (envelope_id)
					WHERE envelope_id <> ''`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("alerts lifecycle migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_alerts_envelope_id`,
				`ALTER TABLE public.alerts
					DROP COLUMN IF EXISTS error,
					DROP COLUMN IF EXISTS completed_at,
					DROP COLUMN IF EXISTS played_at,
					DROP COLUMN IF EXISTS dispatched_at,
					DROP COLUMN IF EXISTS envelope_id`,
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
