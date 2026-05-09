package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateAssetsTable adds the `assets` table — the engine's registry of
// static media bundled with modules (images / audio / video / fonts /
// arbitrary data). Mirrors the `actions` and `triggers` tables in
// shape: decoupled from `modules` (identity comes from
// `created_by_type` + `created_by_ref` rather than a module_id FK) so
// asset rows survive module-state changes the same way action rows do.
//
// `repository_key` is the path the engine wrote the asset bytes to in
// its configured `Repository` (file, S3, etc. — see
// `barkloader/lib_repository`). The deployer's URL pipeline (CDN,
// signed URL service, local proxy) is responsible for turning that
// key into a public URL — the engine intentionally doesn't hold one.
//
// `manifest_path` is the original path declared in `manifest.json`
// preserved for diagnostics and editor display ("counter:victory →
// assets/victory.mp3").
func CreateAssetsTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0007_assets",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating assets table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.assets (
					id              UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					name            TEXT                                   NOT NULL,
					description     TEXT        DEFAULT ''                 NOT NULL,
					manifest_path   TEXT                                   NOT NULL,
					repository_key  TEXT                                   NOT NULL,
					kind            TEXT        DEFAULT ''                 NOT NULL,
					content_type    TEXT        DEFAULT ''                 NOT NULL,
					created_by_type TEXT        DEFAULT 'MODULE'           NOT NULL,
					created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					manifest_id     TEXT        DEFAULT ''                 NOT NULL,
					created_at      TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					updated_at      TIMESTAMPTZ DEFAULT NOW()              NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_assets_origin
					ON public.assets (created_by_type, created_by_ref)`,
				// Idempotent registration upserts on
				// (created_by_type, created_by_ref, manifest_id) — same
				// composite key the actions / triggers tables use to
				// dedupe install retries.
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_origin_manifest
					ON public.assets (created_by_type, created_by_ref, manifest_id)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("assets migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_assets_origin_manifest`,
				`DROP INDEX IF EXISTS idx_assets_origin`,
				`DROP TABLE IF EXISTS public.assets`,
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
