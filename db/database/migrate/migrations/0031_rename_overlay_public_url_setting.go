package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// RenameOverlayPublicUrlSetting renames the generic `settings` row keyed
// `overlay.publicUrl` to `scene.publicUrl`.
//
// Why: `overlay.publicUrl` was streamware/workflow's name for "this
// deployment's public base URL" — used to build absolute overlay/asset
// URLs. sceneManager (streamware's replacement) reuses the exact same
// setting for the exact same purpose (its own `PublicUrlResolver`,
// mirroring barkloader's `storage.publicUrl` pattern), but "overlay"
// terminology is being retired along with streamware's `/overlay/`
// route prefix — the key is renamed to match, not duplicated. Every
// current reader (streamware, workflow, api's engine routes,
// sceneManager) is updated in the same change to read the new key, so
// this is a true rename, not a fork: apply this migration together
// with those code changes, not independently.
//
// A data rename, not a schema change — no column/table shape changes.
func RenameOverlayPublicUrlSetting() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0031_rename_overlay_public_url_setting",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Renaming overlay.publicUrl setting to scene.publicUrl...")
			return tx.Exec(
				`UPDATE public.settings SET key = 'scene.publicUrl' WHERE key = 'overlay.publicUrl'`,
			).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(
				`UPDATE public.settings SET key = 'overlay.publicUrl' WHERE key = 'scene.publicUrl'`,
			).Error
		},
	}
}
