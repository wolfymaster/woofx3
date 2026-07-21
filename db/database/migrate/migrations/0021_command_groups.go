package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateCommandGroupsTables adds the "user group" (role) entity and the join
// tables that record which groups/users may invoke a given command. These
// tables are the source of truth for command permissions; rows written into
// the generic Casbin-backed `permissions` table are a derived write-through
// cache, never read back directly by application code.
//
// This migration also truncates `permissions`: the Casbin model was just
// simplified from a 3-arg/2-arg g/g2 shape to a standard 2-arg RBAC shape
// (see db/config/config.go), and no production write path ever produced a
// matchable policy under the old model, so there is no working data to
// preserve.
func CreateCommandGroupsTables() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0021_command_groups",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating groups, user_groups, command_groups, command_users tables...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.groups (
					id             UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					application_id UUID                                   NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
					name           VARCHAR(100)                           NOT NULL,
					description    VARCHAR(500) DEFAULT '',
					created_at     TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					updated_at     TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					CONSTRAINT uq_group_application_name UNIQUE (application_id, name)
				)`,
				// Group membership and per-command user grants are keyed by
				// chat username (lowercased), matching the identity already
				// used throughout the chat pipeline (canUse()/!grantcommands
				// and the Casbin rows themselves) - not a users.id FK. This
				// avoids requiring a resolved/persisted user record for
				// every chatter before they can be granted access.
				`CREATE TABLE IF NOT EXISTS public.user_groups (
					username   VARCHAR(50) NOT NULL,
					group_id   UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
					created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
					PRIMARY KEY (username, group_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_user_groups_group_id ON public.user_groups (group_id)`,
				`CREATE TABLE IF NOT EXISTS public.command_groups (
					command_id UUID NOT NULL REFERENCES public.commands(id) ON DELETE CASCADE,
					group_id   UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
					PRIMARY KEY (command_id, group_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_command_groups_group_id ON public.command_groups (group_id)`,
				`CREATE TABLE IF NOT EXISTS public.command_users (
					command_id UUID NOT NULL REFERENCES public.commands(id) ON DELETE CASCADE,
					username   VARCHAR(50) NOT NULL,
					PRIMARY KEY (command_id, username)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_command_users_username ON public.command_users (username)`,
				`ALTER TABLE public.commands ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'restricted' NOT NULL`,
				`TRUNCATE TABLE public.permissions`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("command_groups migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE public.commands DROP COLUMN IF EXISTS visibility`,
				`DROP INDEX IF EXISTS idx_command_users_username`,
				`DROP TABLE IF EXISTS public.command_users`,
				`DROP INDEX IF EXISTS idx_command_groups_group_id`,
				`DROP TABLE IF EXISTS public.command_groups`,
				`DROP INDEX IF EXISTS idx_user_groups_group_id`,
				`DROP TABLE IF EXISTS public.user_groups`,
				`DROP TABLE IF EXISTS public.groups`,
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
