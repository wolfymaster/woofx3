package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// resourcesKindCheckWithCustomModule must match the constraint the postgres
// migration of the same ID defines.
const resourcesKindCheckWithCustomModule = `CONSTRAINT resources_kind_check
		CHECK (kind IN ('image', 'video', 'audio', 'other', 'folder', 'custom_module'))`

// AllowCustomModuleResourceKind admits `kind = 'custom_module'` on resources. See the
// postgres migration of the same ID.
//
// SQLite cannot alter a CHECK in place, so the table is rebuilt. resources
// references itself through parent_id with ON DELETE CASCADE, so this runs
// like 0049: foreign key enforcement off, one transaction, and a foreign key
// check before commit.
func AllowCustomModuleResourceKind() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0072_resource_kind_custom_module",
		Migrate: func(db *gorm.DB) error {
			log.Println("Allowing module resources...")
			return rebuildResourcesKindCheck(db, resourcesKindCheckWithCustomModule)
		},
		// Fails while any module resource exists rather than deleting
		// uploads to make the narrower check hold.
		Rollback: func(db *gorm.DB) error {
			return rebuildResourcesKindCheck(db, `CONSTRAINT resources_kind_check
		CHECK (kind IN ('image', 'video', 'audio', 'other', 'folder'))`)
		},
	}
}

func rebuildResourcesKindCheck(db *gorm.DB, definition string) error {
	return withForeignKeysDisabled(db, func(conn *gorm.DB) error {
		return conn.Transaction(func(tx *gorm.DB) error {
			rebuild := tableRebuild{
				table:       "resources",
				constraints: map[string]string{"resources_kind_check": definition},
			}
			if err := rebuildTable(tx, rebuild); err != nil {
				return err
			}
			return assertForeignKeysHold(tx)
		})
	})
}
