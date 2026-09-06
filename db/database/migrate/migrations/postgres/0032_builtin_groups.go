package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// AddBuiltInGroups marks groups as built-in and backfills the seeded catalog
// for applications that already exist. New applications get the same rows from
// applicationService.CreateApplication; this migration only catches up history.
//
// It also repairs a latent authorization bug. `commands.visibility` defaults to
// 'restricted', and command permission sync only ever wrote Casbin p-rules for
// commands that had an explicit group or user grant. A restricted command with
// no grants therefore matched no policy at all and was denied for everybody -
// which is the opposite of the intended "no restriction configured" meaning.
// The fix is to represent "unrestricted" positively in the policy data as a
// wildcard subject row, so both enforcement paths (db-proxy's GetCommand hook
// and woofwoofwoof's canUse -> HasPermission) agree without either of them
// needing a special case. This backfills that row for existing commands.
func AddBuiltInGroups() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0032_builtin_groups",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding groups.is_built_in and seeding built-in groups...")

			if err := tx.Exec(
				`ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS is_built_in BOOLEAN DEFAULT FALSE NOT NULL`,
			).Error; err != nil {
				return err
			}

			var appIDs []uuid.UUID
			if err := tx.Raw(`SELECT id FROM public.applications`).Scan(&appIDs).Error; err != nil {
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
				`DELETE FROM public.permissions WHERE ptype = 'p' AND v0 = '*'`,
				`DELETE FROM public.groups WHERE is_built_in = TRUE`,
				`ALTER TABLE public.groups DROP COLUMN IF EXISTS is_built_in`,
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

// seedBuiltInGroupsSQL inserts the built-in catalog for one application. Ids
// are generated here rather than by a column default so the statement is
// identical on Postgres and SQLite. Idempotent: an application that already has
// a group of the same name (built-in or hand-made) is left alone, since
// (application_id, name) is unique.
func seedBuiltInGroupsSQL(tx *gorm.DB, appID uuid.UUID) error {
	for _, g := range models.BuiltInGroups {
		var count int64
		if err := tx.Raw(
			`SELECT COUNT(*) FROM public.groups WHERE application_id = ? AND name = ?`,
			appID, g.Name,
		).Scan(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			// Promote a pre-existing same-named group rather than duplicating
			// it, so operators who hand-made a "moderator" group keep their
			// membership and simply gain built-in protection.
			if err := tx.Exec(
				`UPDATE public.groups SET is_built_in = TRUE WHERE application_id = ? AND name = ?`,
				appID, g.Name,
			).Error; err != nil {
				return err
			}
			continue
		}
		if err := tx.Exec(
			`INSERT INTO public.groups (id, application_id, name, description, is_built_in)
			 VALUES (?, ?, ?, ?, TRUE)`,
			uuid.New(), appID, g.Name, g.Description,
		).Error; err != nil {
			return err
		}
	}
	return nil
}

// backfillUnrestrictedCommandPolicies writes the wildcard allow row for every
// restricted command that has no group and no user grant. See the migration
// doc comment for why "no grants" must mean "no restriction".
func backfillUnrestrictedCommandPolicies(tx *gorm.DB) error {
	return tx.Exec(
		`INSERT INTO public.permissions (application_id, ptype, v0, v1, v2, v3, v4, v5)
		 SELECT c.application_id, 'p', '*', 'command/' || c.command, 'read', 'allow', '', ''
		 FROM public.commands c
		 WHERE c.visibility = 'restricted'
		   AND NOT EXISTS (SELECT 1 FROM public.command_groups cg WHERE cg.command_id = c.id)
		   AND NOT EXISTS (SELECT 1 FROM public.command_users cu WHERE cu.command_id = c.id)
		   AND NOT EXISTS (
			   SELECT 1 FROM public.permissions p
			   WHERE p.application_id = c.application_id
				 AND p.ptype = 'p' AND p.v0 = '*' AND p.v1 = 'command/' || c.command
		   )`,
	).Error
}
