package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// twitchPlatformModuleRef is the created_by_ref of the Twitch platform
// module's trigger rows: its manifest id in woofx3-modules
// (modules/platform/twitch/manifest.json).
const twitchPlatformModuleRef = "woofx3_twitch"

// AddTriggerPlatform introduces `triggers.platform`: the platform whose
// events alone fire the trigger (a manifest trigger's `platform`). Empty means
// any platform, which every existing row reads as until its module next
// registers, except the Twitch platform module's: its triggers predate the
// field and only ever fire on Twitch, so they are pinned here rather than
// left firing on every platform until the module is next installed.
func AddTriggerPlatform() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0083_trigger_platform",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding triggers.platform...")
			if err := tx.Exec(`ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT ''`).Error; err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE public.triggers SET platform = 'twitch' WHERE created_by_ref = ? AND platform = ''`, twitchPlatformModuleRef).Error; err != nil {
				return err
			}
			log.Println("Trigger platform migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.triggers DROP COLUMN IF EXISTS platform`).Error
		},
	}
}
