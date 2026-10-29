package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// DeclareSceneDatetimeColumns re-declares the scenes table's timestamps as
// DATETIME, for the reason 0049_datetime_columns gives: the SQLite driver
// decodes a stored timestamp into a time.Time only for a date or time column.
// The scene model reads them, so without this every scene read fails on
// SQLite. Stored values are copied as they are.
//
// Other tables hold foreign keys to scenes, so this runs like 0049: foreign
// key enforcement off, one transaction, and a foreign key check before commit.
func DeclareSceneDatetimeColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0070_scene_datetime_columns",
		Migrate: func(db *gorm.DB) error {
			log.Println("Declaring scene timestamp columns DATETIME...")
			return withForeignKeysDisabled(db, func(conn *gorm.DB) error {
				return conn.Transaction(func(tx *gorm.DB) error {
					if err := rebuildTable(tx, tableRebuild{table: "scenes", datetime: []string{"created_at", "updated_at"}}); err != nil {
						return err
					}
					return assertForeignKeysHold(tx)
				})
			})
		},
		Rollback: func(tx *gorm.DB) error {
			// Declaring the columns TEXT again would make every scene
			// unreadable. Rollback is a deliberate no-op.
			return nil
		},
	}
}
