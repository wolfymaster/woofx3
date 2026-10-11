package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWidgetBehaviors adds `widgets.behavior_kinds`: the transition and
// effect kinds a widget declares it plays on its own content (a text
// widget's typewriter), as `{"transitions": [{"id", "label"}], "effects":
// [...]}`. A composition may use these beside the kinds the overlay plays on
// every widget's box, and the overlay hands a widget only the kinds listed
// here.
//
// One JSON object keyed by behavior type rather than a column per type, so a
// later behavior type a widget can play needs no migration.
//
// Existing rows read as declaring nothing until their module next registers.
func AddWidgetBehaviors() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0059_widget_behaviors",
		Migrate: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.widgets ADD COLUMN IF NOT EXISTS behavior_kinds JSONB NOT NULL DEFAULT '{"transitions":[],"effects":[]}'`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.widgets DROP COLUMN IF EXISTS behavior_kinds`).Error
		},
	}
}
