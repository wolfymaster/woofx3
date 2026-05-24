package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func DropLegacyCreatedByColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0014_drop_legacy_created_by",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Dropping legacy created_by columns from commands and workflow_definitions...")
			statements := []string{
				`ALTER TABLE public.commands              DROP COLUMN IF EXISTS created_by`,
				`ALTER TABLE public.workflow_definitions  DROP COLUMN IF EXISTS created_by`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("legacy created_by columns dropped")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE public.commands              ADD COLUMN IF NOT EXISTS created_by UUID`,
				`ALTER TABLE public.workflow_definitions  ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT ''`,
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
