package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// RenameOverlayPublicUrlSetting renames settings key overlay.publicUrl
// to scene.publicUrl.
func RenameOverlayPublicUrlSetting() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0031_rename_overlay_public_url_setting",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Renaming overlay.publicUrl setting to scene.publicUrl...")
			return tx.Exec(
				`UPDATE settings SET key = 'scene.publicUrl' WHERE key = 'overlay.publicUrl'`,
			).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(
				`UPDATE settings SET key = 'overlay.publicUrl' WHERE key = 'scene.publicUrl'`,
			).Error
		},
	}
}
