package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddLocalUISettings creates `local_ui_settings` and its revision counter.
// See the postgres migration of the same ID for the shape decisions.
func AddLocalUISettings() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0068_local_ui_settings",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating local_ui_settings...")
			if err := execStatements(tx, []string{
				`CREATE TABLE IF NOT EXISTS local_ui_settings (
					namespace  TEXT                               NOT NULL,
					key        TEXT                               NOT NULL,
					value      TEXT                               NULL,
					revision   INTEGER                            NOT NULL CHECK (revision > 0),
					updated_at DATETIME DEFAULT (datetime('now')) NOT NULL,
					deleted    BOOLEAN  DEFAULT 0                 NOT NULL,
					PRIMARY KEY (namespace, key),
					CONSTRAINT uq_local_ui_settings_revision UNIQUE (revision),
					CONSTRAINT local_ui_settings_value_matches_deleted CHECK ((value IS NULL) = deleted)
				)`,
				`CREATE TABLE IF NOT EXISTS local_ui_settings_revision (
					id       INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
					revision INTEGER NOT NULL CHECK (revision >= 0)
				)`,
				`INSERT INTO local_ui_settings_revision (id, revision) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
			}); err != nil {
				return err
			}
			log.Println("local_ui_settings migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{
				`DROP TABLE IF EXISTS local_ui_settings`,
				`DROP TABLE IF EXISTS local_ui_settings_revision`,
			})
		},
	}
}
