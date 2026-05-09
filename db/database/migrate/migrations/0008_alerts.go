package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateAlertsTable adds the `alerts` table — an append-only log of
// every alert envelope dispatched on `ui.notify.alert`. Used by the
// Convex alert-log page (replay UI) and as the source of truth for
// "show me what fired in the last 24 hours."
//
// Schema decisions:
//   - `payload` is JSONB and stores the full AlertPayload envelope
//     verbatim (`{ id, parameters, event }`). The engine treats it as
//     opaque on round-trip — replay re-publishes it byte-for-byte
//     (modulo the status update and a fresh wire id).
//   - `workflow_id` and `source_event_id` are nullable — the same
//     subject is used by manual triggers, debug alerts, and replays
//     where neither attribution is known.
//   - `status` defaults to `'sent'`. `replayed` is set on a row when
//     it's been re-fired from the UI; `failed` is reserved for a
//     future delivery-tracking pass.
//
// Retention is intentionally not handled here — alerts will accrete
// until a follow-up TTL/cleanup migration ships. That's a separate
// problem (operational policy, configurable per-application).
func CreateAlertsTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0008_alerts",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating alerts table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.alerts (
					id              UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					application_id  UUID                                    NOT NULL REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					payload         JSONB                                   NOT NULL,
					workflow_id     UUID,
					source_event_id TEXT         DEFAULT ''                 NOT NULL,
					status          VARCHAR(32)  DEFAULT 'sent'             NOT NULL,
					created_at      TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					updated_at      TIMESTAMPTZ  DEFAULT NOW()              NOT NULL
				)`,
				// Per-app reads sorted newest-first are the common case
				// for the alert-log page, so a composite index on
				// (application_id, created_at DESC) backs that path
				// without a full scan.
				`CREATE INDEX IF NOT EXISTS idx_alerts_application_created_at
					ON public.alerts (application_id, created_at DESC)`,
				`CREATE INDEX IF NOT EXISTS idx_alerts_workflow_id
					ON public.alerts (workflow_id) WHERE workflow_id IS NOT NULL`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("alerts migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_alerts_workflow_id`,
				`DROP INDEX IF EXISTS idx_alerts_application_created_at`,
				`DROP TABLE IF EXISTS public.alerts`,
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
