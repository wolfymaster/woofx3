package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddLocalUISettings creates `local_ui_settings`, the dashboard's own data
// (layouts, notes, counters, macros) for an engine run without an account,
// and `local_ui_settings_revision`, the counter every write to it draws from
// (docs/services/local-ui-settings.md).
//
// Shape decisions the sync depends on:
//
//   - (namespace, key) is the primary key: one row per setting, ever. A
//     delete keeps the row as a tombstone (`deleted`, value NULL) with a new
//     revision, so a reader of changes can see that it went.
//
//   - `revision` is unique across the whole table, not per namespace, so one
//     number is a cursor over every change.
//
//   - The counter is a single row bumped inside the writing transaction
//     rather than a sequence. A sequence hands out numbers outside the
//     transaction, so a later number can commit first and a reader paging by
//     revision would skip the earlier one when it lands. Bumping a row holds
//     its lock until commit, so revisions become visible in order.
func AddLocalUISettings() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0068_local_ui_settings",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating local_ui_settings...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.local_ui_settings (
					namespace  TEXT                      NOT NULL,
					key        TEXT                      NOT NULL,
					value      TEXT                      NULL,
					revision   BIGINT                    NOT NULL CHECK (revision > 0),
					updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
					deleted    BOOLEAN     DEFAULT FALSE NOT NULL,
					PRIMARY KEY (namespace, key),
					CONSTRAINT uq_local_ui_settings_revision UNIQUE (revision),
					CONSTRAINT local_ui_settings_value_matches_deleted CHECK ((value IS NULL) = deleted)
				)`,
				`CREATE TABLE IF NOT EXISTS public.local_ui_settings_revision (
					id       SMALLINT NOT NULL PRIMARY KEY CHECK (id = 1),
					revision BIGINT   NOT NULL CHECK (revision >= 0)
				)`,
				`INSERT INTO public.local_ui_settings_revision (id, revision) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("local_ui_settings migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`DROP TABLE IF EXISTS public.local_ui_settings`,
				`DROP TABLE IF EXISTS public.local_ui_settings_revision`,
			} {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
