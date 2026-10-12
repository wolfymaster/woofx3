package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWidgetBehaviors adds `widgets.behavior_kinds`. See the postgres
// migration of the same ID.
func AddWidgetBehaviors() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0059_widget_behaviors",
		Migrate: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE widgets ADD COLUMN IF NOT EXISTS behavior_kinds TEXT NOT NULL DEFAULT '{"transitions":[],"effects":[]}'`)
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE widgets DROP COLUMN IF EXISTS behavior_kinds`)
		},
	}
}
