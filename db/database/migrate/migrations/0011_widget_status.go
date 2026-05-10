package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateWidgetStatusTable adds the `widget_status` table — the durable
// per-widget-instance state surface that Phase 4 of the widget-completion
// plan requires.
//
// Each row is the latest value reported via `widgetHost.reportStatus(key,
// value)` from a widget running inside a scene overlay. Keyed by
// `(application_id, instance_id, key)` so reports upsert in place — the
// dashboard / a workflow trigger reading "what is raid_counter:count
// right now?" gets a single answer without scanning history.
//
// Symmetry note: this table parallels the existing `module_storage`
// table the same way `widgetHost.reportStatus` parallels
// `ctx.storage.set` on the module side. Module storage is keyed by
// `(module_id, key)` (one shared value across every consumer); widget
// status is keyed by `(application_id, instance_id, key)` because each
// scene placement has its own state.
//
// `module_id` and `widget_canonical_id` are denormalised from the
// scene's `widgets_json` blob so queries can group by widget definition
// without parsing every scene row. They are best-effort metadata —
// tolerant of empty strings for legacy / pre-Phase-4 placements.
func CreateWidgetStatusTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0011_widget_status",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating widget_status table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.widget_status (
					id                  UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					application_id      UUID                                    NOT NULL REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					module_id           TEXT         DEFAULT ''                 NOT NULL,
					instance_id         TEXT                                    NOT NULL,
					widget_canonical_id TEXT         DEFAULT ''                 NOT NULL,
					key                 TEXT                                    NOT NULL,
					value               JSONB                                   NOT NULL,
					occurred_at         TIMESTAMPTZ                             NOT NULL,
					created_at          TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					updated_at          TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					CONSTRAINT widget_status_unique UNIQUE (application_id, instance_id, key)
				)`,
				// Lookup-by-instance is the dashboard's hot read path
				// ("show me every status row for raid_counter:inst-7").
				// Application id is implied by the unique constraint
				// but a dedicated index keeps grouped queries cheap
				// without touching the unique-index B-tree.
				`CREATE INDEX IF NOT EXISTS idx_widget_status_application_module
					ON public.widget_status (application_id, module_id)`,
				`CREATE INDEX IF NOT EXISTS idx_widget_status_application_canonical
					ON public.widget_status (application_id, widget_canonical_id)
					WHERE widget_canonical_id <> ''`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("widget_status migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_widget_status_application_canonical`,
				`DROP INDEX IF EXISTS idx_widget_status_application_module`,
				`DROP TABLE IF EXISTS public.widget_status`,
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
