package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateOverlayTokensTable adds the `overlay_tokens` table — capability
// tokens binding a public overlay URL to a scene.
//
// Design notes (see docs/superpowers/specs/2026-06-12-streamware-
// overlay-architecture-design.md section 2.1):
//
//   - `token` is stored plaintext: this is a local-first single-operator
//     database and the UI must reproduce working overlay URLs from a
//     list call. Hash-at-rest is a documented seam if the threat model
//     changes.
//
//   - Revocation is a tombstone (`status='revoked'` + `revoked_at`),
//     never a delete, so rotation history and operator bookkeeping
//     (`label`) survive.
//
//   - No FK to `scenes`: tombstones must outlive their scene the same
//     way widgets outlive their module rows. Resolution validates the
//     scene at read time.
func CreateOverlayTokensTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0017_overlay_tokens",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating overlay_tokens table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.overlay_tokens (
					id             UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					token          TEXT                                   NOT NULL,
					scene_id       UUID                                   NOT NULL,
					application_id UUID                                   NOT NULL,
					label          TEXT        DEFAULT ''                 NOT NULL,
					status         TEXT        DEFAULT 'active'           NOT NULL,
					created_at     TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					revoked_at     TIMESTAMPTZ,
					last_used_at   TIMESTAMPTZ
				)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_overlay_tokens_token
					ON public.overlay_tokens (token)`,
				`CREATE INDEX IF NOT EXISTS idx_overlay_tokens_scene_id
					ON public.overlay_tokens (scene_id)`,
				`CREATE INDEX IF NOT EXISTS idx_overlay_tokens_application_id
					ON public.overlay_tokens (application_id)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("overlay_tokens migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_overlay_tokens_application_id`,
				`DROP INDEX IF EXISTS idx_overlay_tokens_scene_id`,
				`DROP INDEX IF EXISTS idx_overlay_tokens_token`,
				`DROP TABLE IF EXISTS public.overlay_tokens`,
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
