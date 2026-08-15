package sqlite

import (
	"fmt"
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// backfillModuleCreatedByRefTables lists every table whose MODULE-owned
// rows previously stored the composite moduleKey in created_by_ref.
var backfillModuleCreatedByRefTables = []string{
	"triggers",
	"actions",
	"widgets",
	"background_tasks",
	"assets",
	"workflow_definitions",
}

// BackfillModuleCreatedByRef rewrites created_by_ref on MODULE-owned rows
// from the composite moduleKey down to the bare stable manifest module id.
func BackfillModuleCreatedByRef() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0027_backfill_module_created_by_ref",
		Migrate: func(tx *gorm.DB) error {
			for _, table := range backfillModuleCreatedByRefTables {
				log.Printf("Backfilling created_by_ref on %s...", table)

				bare := splitPart1SQL("created_by_ref")
				bareT := splitPart1SQL("t.created_by_ref")
				bareNewer := splitPart1SQL("newer.created_by_ref")

				dedupe := fmt.Sprintf(`
					DELETE FROM %s
					WHERE id IN (
						SELECT t.id
						FROM %s t
						INNER JOIN %s newer
							ON newer.created_by_type = 'MODULE'
							AND newer.created_by_ref LIKE '%%:%%:%%'
							AND %s = %s
							AND t.manifest_id = newer.manifest_id
						WHERE t.created_by_type = 'MODULE'
						  AND t.created_by_ref LIKE '%%:%%:%%'
						  AND (
							t.updated_at < newer.updated_at
							OR (t.updated_at = newer.updated_at AND t.id < newer.id)
						  )
					)
				`, table, table, table, bareT, bareNewer)
				if err := tx.Exec(dedupe).Error; err != nil {
					return fmt.Errorf("dedupe %s: %w", table, err)
				}

				dropStaleComposite := fmt.Sprintf(`
					DELETE FROM %s
					WHERE id IN (
						SELECT t.id FROM %s t
						WHERE t.created_by_type = 'MODULE'
						  AND t.created_by_ref LIKE '%%:%%:%%'
						  AND EXISTS (
							SELECT 1 FROM %s bare
							WHERE bare.created_by_type = 'MODULE'
							  AND bare.created_by_ref = %s
							  AND bare.manifest_id = t.manifest_id
						  )
					)
				`, table, table, table, bareT)
				if err := tx.Exec(dropStaleComposite).Error; err != nil {
					return fmt.Errorf("drop stale composite rows on %s: %w", table, err)
				}

				rewrite := fmt.Sprintf(`
					UPDATE %s
					SET created_by_ref = %s
					WHERE created_by_type = 'MODULE' AND created_by_ref LIKE '%%:%%:%%'
				`, table, bare)
				if err := tx.Exec(rewrite).Error; err != nil {
					return fmt.Errorf("rewrite %s: %w", table, err)
				}
			}
			log.Println("created_by_ref backfill complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return nil
		},
	}
}
