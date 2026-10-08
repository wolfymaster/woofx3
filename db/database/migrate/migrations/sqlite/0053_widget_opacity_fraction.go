package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"

	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/scenewidgets"
)

// FractionWidgetOpacity rewrites every stored widget placement's opacity from
// a percent to a fraction 0–1. See the postgres migration of the same ID.
func FractionWidgetOpacity() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0053_widget_opacity_fraction",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Rewriting stored widget opacity as a fraction...")
			return scenewidgets.FractionOpacityInColumns(tx, []scenewidgets.OpacityColumn{
				{
					What:    "scene",
					Select:  `SELECT id, widgets_json AS json FROM scenes WHERE widgets_json LIKE '%"opacity"%'`,
					Update:  `UPDATE scenes SET widgets_json = ? WHERE id = ?`,
					Rewrite: scenewidgets.FractionPlacementsOpacity,
				},
				{
					What: "scene draft",
					Select: `SELECT id, draft_widgets_json AS json FROM scenes
						WHERE draft_widgets_json LIKE '%"opacity"%'`,
					Update:  `UPDATE scenes SET draft_widgets_json = ? WHERE id = ?`,
					Rewrite: scenewidgets.FractionPlacementsOpacity,
				},
				{
					What:    "workflow",
					Select:  `SELECT id, steps AS json FROM workflow_definitions WHERE steps LIKE '%"opacity"%'`,
					Update:  `UPDATE workflow_definitions SET steps = ? WHERE id = ?`,
					Rewrite: scenewidgets.FractionStepsOpacity,
				},
				{
					What:    "command",
					Select:  `SELECT id, actions AS json FROM commands WHERE actions LIKE '%"opacity"%'`,
					Update:  `UPDATE commands SET actions = ? WHERE id = ?`,
					Rewrite: scenewidgets.FractionStepsOpacity,
				},
				{
					What:    "alert",
					Select:  `SELECT id, payload AS json FROM alerts WHERE payload LIKE '%"opacity"%'`,
					Update:  `UPDATE alerts SET payload = ? WHERE id = ?`,
					Rewrite: scenewidgets.FractionAlertPayloadOpacity,
				},
			})
		},
		// Nothing to restore; see the postgres migration.
		Rollback: func(tx *gorm.DB) error {
			return nil
		},
	}
}
