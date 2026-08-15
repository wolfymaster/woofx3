package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateCommandGroupsTables adds groups / user_groups / command_groups /
// command_users and truncates permissions.
func CreateCommandGroupsTables() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0021_command_groups",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating groups, user_groups, command_groups, command_users tables...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS groups (
					id             TEXT        NOT NULL PRIMARY KEY,
					application_id TEXT        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
					name           VARCHAR(100)                           NOT NULL,
					description    VARCHAR(500) DEFAULT '',
					created_at     TEXT        DEFAULT (datetime('now'))  NOT NULL,
					updated_at     TEXT        DEFAULT (datetime('now'))  NOT NULL,
					CONSTRAINT uq_group_application_name UNIQUE (application_id, name)
				)`,
				`CREATE TABLE IF NOT EXISTS user_groups (
					username   VARCHAR(50) NOT NULL,
					group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
					created_at TEXT DEFAULT (datetime('now')) NOT NULL,
					PRIMARY KEY (username, group_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_user_groups_group_id ON user_groups (group_id)`,
				`CREATE TABLE IF NOT EXISTS command_groups (
					command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
					group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
					PRIMARY KEY (command_id, group_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_command_groups_group_id ON command_groups (group_id)`,
				`CREATE TABLE IF NOT EXISTS command_users (
					command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
					username   VARCHAR(50) NOT NULL,
					PRIMARY KEY (command_id, username)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_command_users_username ON command_users (username)`,
				`ALTER TABLE commands ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'restricted' NOT NULL`,
				`DELETE FROM permissions`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("command_groups migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE commands DROP COLUMN IF EXISTS visibility`,
				`DROP INDEX IF EXISTS idx_command_users_username`,
				`DROP TABLE IF EXISTS command_users`,
				`DROP INDEX IF EXISTS idx_command_groups_group_id`,
				`DROP TABLE IF EXISTS command_groups`,
				`DROP INDEX IF EXISTS idx_user_groups_group_id`,
				`DROP TABLE IF EXISTS user_groups`,
				`DROP TABLE IF EXISTS groups`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
