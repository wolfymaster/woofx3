package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddModulesModuleIDColumn adds manifest-local module id to modules.
func AddModulesModuleIDColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0015_modules_module_id",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding modules.module_id column...")
			statements := []string{
				`ALTER TABLE modules ADD COLUMN IF NOT EXISTS module_id TEXT NOT NULL DEFAULT ''`,
				`UPDATE modules SET module_id = CASE WHEN instr(module_key, ':') > 0 THEN substr(module_key, 1, instr(module_key, ':') - 1) ELSE module_key END WHERE module_id = '' AND module_key <> ''`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_module_id ON modules (module_id) WHERE module_id <> ''`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("modules.module_id column added")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_modules_module_id`,
				`ALTER TABLE modules DROP COLUMN IF EXISTS module_id`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
