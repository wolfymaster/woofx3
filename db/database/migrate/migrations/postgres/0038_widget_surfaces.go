package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWidgetSurfaces replaces `widgets.surface` with `widgets.surfaces`, the
// list of places a widget may be put, and adds `widgets.hosts_surface`.
//
// A single value cannot say "a scene or an alert", which Text and Image both
// need. Nothing ever wrote a surface other than "scene", so the new column's
// default is the complete backfill; rows pick up their declared surfaces when
// their module next registers widgets.
func AddWidgetSurfaces() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0038_widget_surfaces",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding widgets.surfaces and widgets.hosts_surface...")
			statements := []string{
				`ALTER TABLE public.widgets ADD COLUMN IF NOT EXISTS surfaces JSONB NOT NULL DEFAULT '["scene"]'`,
				`ALTER TABLE public.widgets ADD COLUMN IF NOT EXISTS hosts_surface TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE public.widgets DROP COLUMN IF EXISTS surface`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("Widget surfaces migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE public.widgets ADD COLUMN IF NOT EXISTS surface TEXT NOT NULL DEFAULT 'scene'`,
				`ALTER TABLE public.widgets DROP COLUMN IF EXISTS hosts_surface`,
				`ALTER TABLE public.widgets DROP COLUMN IF EXISTS surfaces`,
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
