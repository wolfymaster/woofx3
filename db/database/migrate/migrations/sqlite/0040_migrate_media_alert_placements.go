package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"

	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/scenewidgets"
)

// MigrateMediaAlertPlacements replaces every scene's media_alert placements
// with an alert widget named "default"; see
// scenewidgets.ReplaceMediaAlertPlacements.
func MigrateMediaAlertPlacements() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0040_migrate_media_alert_placements",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Replacing media_alert scene placements with alert widgets...")
			return scenewidgets.ReplaceMediaAlertPlacementsInScenes(
				tx,
				`SELECT id, widgets_json FROM scenes`,
				`UPDATE scenes SET widgets_json = ? WHERE id = ?`,
			)
		},
		// Nothing to restore: the media_alert widget no longer exists to place.
		Rollback: func(tx *gorm.DB) error {
			return nil
		},
	}
}
