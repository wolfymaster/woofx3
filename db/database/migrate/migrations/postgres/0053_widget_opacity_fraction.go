package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"

	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/scenewidgets"
)

// FractionWidgetOpacity rewrites every stored widget placement's opacity from
// a percent to a fraction 0–1; see scenewidgets.FractionPlacementOpacity.
//
// Placements are stored in a scene's published and draft widgets, and as the
// layout of an alert: on a workflow step, on a command action, and on every
// dispatched alert, which a replay plays again.
func FractionWidgetOpacity() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0053_widget_opacity_fraction",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Rewriting stored widget opacity as a fraction...")
			return scenewidgets.FractionOpacityInColumns(tx, []scenewidgets.OpacityColumn{
				{
					What: "scene",
					Select: `SELECT id::text AS id, widgets_json::text AS json FROM public.scenes
						WHERE widgets_json::text LIKE '%"opacity"%'`,
					Update:  `UPDATE public.scenes SET widgets_json = ?::jsonb WHERE id = ?::uuid`,
					Rewrite: scenewidgets.FractionPlacementsOpacity,
				},
				{
					What: "scene draft",
					Select: `SELECT id::text AS id, draft_widgets_json::text AS json FROM public.scenes
						WHERE draft_widgets_json::text LIKE '%"opacity"%'`,
					Update:  `UPDATE public.scenes SET draft_widgets_json = ?::jsonb WHERE id = ?::uuid`,
					Rewrite: scenewidgets.FractionPlacementsOpacity,
				},
				{
					What: "workflow",
					Select: `SELECT id::text AS id, steps::text AS json FROM public.workflow_definitions
						WHERE steps::text LIKE '%"opacity"%'`,
					Update:  `UPDATE public.workflow_definitions SET steps = ?::jsonb WHERE id = ?::uuid`,
					Rewrite: scenewidgets.FractionStepsOpacity,
				},
				{
					What: "command",
					Select: `SELECT id::text AS id, actions::text AS json FROM public.commands
						WHERE actions::text LIKE '%"opacity"%'`,
					Update:  `UPDATE public.commands SET actions = ?::jsonb WHERE id = ?::uuid`,
					Rewrite: scenewidgets.FractionStepsOpacity,
				},
				{
					What: "alert",
					Select: `SELECT id::text AS id, payload::text AS json FROM public.alerts
						WHERE payload::text LIKE '%"opacity"%'`,
					Update:  `UPDATE public.alerts SET payload = ?::jsonb WHERE id = ?::uuid`,
					Rewrite: scenewidgets.FractionAlertPayloadOpacity,
				},
			})
		},
		// Nothing to restore: a fraction is what every reader expects.
		Rollback: func(tx *gorm.DB) error {
			return nil
		},
	}
}
