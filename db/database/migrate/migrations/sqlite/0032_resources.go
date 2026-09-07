package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateResourcesTable adds the generic user-asset store (uploads plus
// the folders that organize them). See the postgres migration of the
// same ID for the design note on why folders live in this table behind
// an `is_folder` flag rather than in a table of their own.
func CreateResourcesTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0032_resources",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating resources table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS resources (
					id                       TEXT                              NOT NULL PRIMARY KEY,
					application_id           TEXT                              NOT NULL REFERENCES applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					parent_id                TEXT     NULL                     REFERENCES resources(id) ON UPDATE CASCADE ON DELETE CASCADE,
					is_folder                INTEGER  DEFAULT 0                NOT NULL,
					name                     TEXT                              NOT NULL,
					kind                     TEXT     DEFAULT 'other'          NOT NULL,
					content_type             TEXT     DEFAULT ''               NOT NULL,
					repository_key           TEXT     DEFAULT ''               NOT NULL,
					thumbnail_repository_key TEXT     DEFAULT ''               NOT NULL,
					size                     INTEGER  DEFAULT 0                NOT NULL,
					status                   TEXT     DEFAULT 'pending'        NOT NULL,
					created_at               TEXT     DEFAULT (datetime('now')) NOT NULL,
					updated_at               TEXT     DEFAULT (datetime('now')) NOT NULL,
					CONSTRAINT resources_kind_check
						CHECK (kind IN ('image', 'video', 'audio', 'other', 'folder')),
					CONSTRAINT resources_status_check
						CHECK (status IN ('pending', 'ready', 'failed')),
					CONSTRAINT resources_folder_has_no_bytes
						CHECK (
							(is_folder = 1 AND repository_key = '' AND thumbnail_repository_key = '')
							OR (is_folder = 0 AND repository_key <> '')
						)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_resources_app_parent
					ON resources (application_id, parent_id)`,
				`CREATE INDEX IF NOT EXISTS idx_resources_app_kind
					ON resources (application_id, kind)`,
				`CREATE INDEX IF NOT EXISTS idx_resources_repository_key
					ON resources (repository_key)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("resources migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{`DROP TABLE IF EXISTS resources`})
		},
	}
}
