package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// AddBuiltInGroups mirrors the Postgres migration of the same ID: it adds
// groups.is_built_in, seeds the built-in catalog for existing applications, and
// backfills the wildcard "no restriction configured" policy row for restricted
// commands that carry no group or user grant. See the Postgres copy for the
// full rationale.
func AddBuiltInGroups() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0032_builtin_groups",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding groups.is_built_in and seeding built-in groups...")

			if err := execSQL(tx,
				`ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_built_in BOOLEAN DEFAULT 0 NOT NULL`,
			); err != nil {
				return err
			}

			var appIDs []uuid.UUID
			if err := tx.Raw(`SELECT id FROM applications`).Scan(&appIDs).Error; err != nil {
				return err
			}
			for _, appID := range appIDs {
				if err := seedBuiltInGroupsSQL(tx, appID); err != nil {
					return err
				}
			}

			return backfillUnrestrictedCommandPolicies(tx)
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DELETE FROM permissions WHERE ptype = 'p' AND v0 = '*'`,
				`DELETE FROM groups WHERE is_built_in = 1`,
				`ALTER TABLE groups DROP COLUMN IF EXISTS is_built_in`,
			}
			return execStatements(tx, statements)
		},
	}
}

// seedBuiltInGroupsSQL inserts the built-in catalog for one application,
// promoting an existing same-named group instead of duplicating it.
func seedBuiltInGroupsSQL(tx *gorm.DB, appID uuid.UUID) error {
	for _, g := range models.BuiltInGroups {
		var count int64
		if err := tx.Raw(
			`SELECT COUNT(*) FROM groups WHERE application_id = ? AND name = ?`,
			appID, g.Name,
		).Scan(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			if err := tx.Exec(
				`UPDATE groups SET is_built_in = 1 WHERE application_id = ? AND name = ?`,
				appID, g.Name,
			).Error; err != nil {
				return err
			}
			continue
		}
		if err := tx.Exec(
			`INSERT INTO groups (id, application_id, name, description, is_built_in)
			 VALUES (?, ?, ?, ?, 1)`,
			uuid.New(), appID, g.Name, g.Description,
		).Error; err != nil {
			return err
		}
	}
	return nil
}

// backfillUnrestrictedCommandPolicies writes the wildcard allow row for every
// restricted command with no group and no user grant.
func backfillUnrestrictedCommandPolicies(tx *gorm.DB) error {
	return tx.Exec(
		`INSERT INTO permissions (application_id, ptype, v0, v1, v2, v3, v4, v5)
		 SELECT c.application_id, 'p', '*', 'command/' || c.command, 'read', 'allow', '', ''
		 FROM commands c
		 WHERE c.visibility = 'restricted'
		   AND NOT EXISTS (SELECT 1 FROM command_groups cg WHERE cg.command_id = c.id)
		   AND NOT EXISTS (SELECT 1 FROM command_users cu WHERE cu.command_id = c.id)
		   AND NOT EXISTS (
			   SELECT 1 FROM permissions p
			   WHERE p.application_id = c.application_id
				 AND p.ptype = 'p' AND p.v0 = '*' AND p.v1 = 'command/' || c.command
		   )`,
	).Error
}
