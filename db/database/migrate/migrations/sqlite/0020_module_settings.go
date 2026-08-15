package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func CreateModuleSettingsTables() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0020_module_settings",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating module_settings and widget_settings tables...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS module_settings (
					id           TEXT        NOT NULL PRIMARY KEY,
					module_id    TEXT                                   NOT NULL,
					key          TEXT                                   NOT NULL,
					value        TEXT        DEFAULT ''                 NOT NULL,
					value_type   TEXT        DEFAULT 'string'           NOT NULL,
					created_at   TEXT        DEFAULT (datetime('now'))  NOT NULL,
					updated_at   TEXT        DEFAULT (datetime('now'))  NOT NULL,
					CONSTRAINT uq_module_setting UNIQUE (module_id, key)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_module_settings_module_id
					ON module_settings (module_id)`,
				`CREATE TABLE IF NOT EXISTS widget_settings (
					id           TEXT        NOT NULL PRIMARY KEY,
					module_id    TEXT                                   NOT NULL,
					widget_id    TEXT                                   NOT NULL,
					instance_id  TEXT                                   NOT NULL,
					key          TEXT                                   NOT NULL,
					value        TEXT        DEFAULT ''                 NOT NULL,
					value_type   TEXT        DEFAULT 'string'           NOT NULL,
					created_at   TEXT        DEFAULT (datetime('now'))  NOT NULL,
					updated_at   TEXT        DEFAULT (datetime('now'))  NOT NULL,
					CONSTRAINT uq_widget_setting UNIQUE (module_id, widget_id, instance_id, key)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_widget_settings_module_id
					ON widget_settings (module_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("module_settings and widget_settings migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_widget_settings_module_id`,
				`DROP TABLE IF EXISTS widget_settings`,
				`DROP INDEX IF EXISTS idx_module_settings_module_id`,
				`DROP TABLE IF EXISTS module_settings`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
