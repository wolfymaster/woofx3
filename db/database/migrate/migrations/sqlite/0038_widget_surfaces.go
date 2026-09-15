package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWidgetSurfaces replaces `widgets.surface` with `widgets.surfaces` and
// adds `widgets.hosts_surface`. See the postgres migration of the same name
// for the full rationale.
func AddWidgetSurfaces() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0038_widget_surfaces",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding widgets.surfaces and widgets.hosts_surface...")
			if err := execStatements(tx, []string{
				`ALTER TABLE widgets ADD COLUMN IF NOT EXISTS surfaces TEXT NOT NULL DEFAULT '["scene"]'`,
				`ALTER TABLE widgets ADD COLUMN IF NOT EXISTS hosts_surface TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE widgets DROP COLUMN IF EXISTS surface`,
			}); err != nil {
				return err
			}
			log.Println("Widget surfaces migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{
				`ALTER TABLE widgets ADD COLUMN IF NOT EXISTS surface TEXT NOT NULL DEFAULT 'scene'`,
				`ALTER TABLE widgets DROP COLUMN IF EXISTS hosts_surface`,
				`ALTER TABLE widgets DROP COLUMN IF EXISTS surfaces`,
			})
		},
	}
}
