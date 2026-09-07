package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateResourcesTable adds the generic user-asset store: arbitrary
// files a streamer uploads (photos, video, audio) plus the folders that
// organize them. Distinct from `assets` (static files bundled inside an
// installed module, scoped by module_id) and from `module_resources`
// (installed-module bookkeeping) — neither of those is user-owned
// content.
//
// Design note — one table with `is_folder`, rather than a separate
// `resource_folders` table:
//
//   - `parent_id` has to reference *one* table. With folders split out,
//     every resource row needs a FK into `resource_folders` AND every
//     folder row needs a self-FK, which is two hierarchies to keep
//     consistent instead of one. Listing "what is in this folder" then
//     becomes a UNION of two differently-shaped selects, and the
//     "folders first, then files" ordering the UI wants has to be
//     re-derived in application code on every page.
//
//   - Rename and move are the same operation for both kinds. One table
//     means one UpdateResource RPC and one sibling-name-uniqueness
//     check, not two of each that must not drift.
//
//   - The cost is a handful of columns that are always empty for
//     folders (`repository_key`, `content_type`, `size`,
//     `thumbnail_repository_key`). That is cheap and, more importantly,
//     honest: a folder genuinely is a resource with no bytes. The
//     alternative trades four nullable columns for a duplicated tree.
//
// Thumbnails are deliberately NOT rows in this table. A generated
// thumbnail is `thumbnail_repository_key` on the resource that produced
// it, so no read path can accidentally surface a derived artifact as a
// peer of a user's upload — the acceptance criterion is structural
// rather than a filter each query has to remember.
func CreateResourcesTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0032_resources",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating resources table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.resources (
					id                       UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					application_id           UUID                                    NOT NULL REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					parent_id                UUID         NULL                       REFERENCES public.resources(id) ON UPDATE CASCADE ON DELETE CASCADE,
					is_folder                BOOLEAN      DEFAULT FALSE              NOT NULL,
					name                     TEXT                                    NOT NULL,
					kind                     TEXT         DEFAULT 'other'            NOT NULL,
					content_type             TEXT         DEFAULT ''                 NOT NULL,
					repository_key           TEXT         DEFAULT ''                 NOT NULL,
					thumbnail_repository_key TEXT         DEFAULT ''                 NOT NULL,
					size                     BIGINT       DEFAULT 0                  NOT NULL,
					status                   TEXT         DEFAULT 'pending'          NOT NULL,
					created_at               TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					updated_at               TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					CONSTRAINT resources_kind_check
						CHECK (kind IN ('image', 'video', 'audio', 'other', 'folder')),
					CONSTRAINT resources_status_check
						CHECK (status IN ('pending', 'ready', 'failed')),
					-- A folder has no bytes; a file must name some. Keeps
					-- the "folders are resources with no content" claim
					-- from silently degrading into half-populated rows.
					CONSTRAINT resources_folder_has_no_bytes
						CHECK (
							(is_folder AND repository_key = '' AND thumbnail_repository_key = '')
							OR (NOT is_folder AND repository_key <> '')
						)
				)`,
				// Browsing a folder is the only hot read path: every
				// listing is "children of (application, parent)".
				`CREATE INDEX IF NOT EXISTS idx_resources_app_parent
					ON public.resources (application_id, parent_id)`,
				// Supports the kind filter on a folder listing.
				`CREATE INDEX IF NOT EXISTS idx_resources_app_kind
					ON public.resources (application_id, kind)`,
				// The upload-completion webhook and the asset proxy both
				// arrive holding only a repository key.
				`CREATE INDEX IF NOT EXISTS idx_resources_repository_key
					ON public.resources (repository_key)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("resources migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`DROP TABLE IF EXISTS public.resources`).Error
		},
	}
}
