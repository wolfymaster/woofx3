package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func RelaxWorkerEventUuidColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202504150001_relax_worker_event_uuid_columns",
		Migrate: func(tx *gorm.DB) error {
			// System-level events (module triggers, actions, installs) do not have
			// a meaningful application_id or entity_id UUID.  Relax these columns
			// from UUID to VARCHAR(36) so they accept empty strings while still
			// fitting valid UUIDs.
			alterStatements := []string{
				"ALTER TABLE public.worker_events ALTER COLUMN application_id TYPE VARCHAR(36) USING application_id::text",
				"ALTER TABLE public.worker_events ALTER COLUMN application_id SET DEFAULT ''",
				"ALTER TABLE public.worker_events ALTER COLUMN entity_id TYPE VARCHAR(36) USING entity_id::text",
				"ALTER TABLE public.worker_events ADD COLUMN IF NOT EXISTS client_id VARCHAR(255) NOT NULL DEFAULT ''",
			}

			for _, stmt := range alterStatements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			alterStatements := []string{
				"ALTER TABLE public.worker_events ALTER COLUMN application_id TYPE UUID USING application_id::uuid",
				"ALTER TABLE public.worker_events ALTER COLUMN application_id SET DEFAULT uuid_generate_v4()",
				"ALTER TABLE public.worker_events ALTER COLUMN entity_id TYPE UUID USING entity_id::uuid",
				"ALTER TABLE public.worker_events DROP COLUMN IF EXISTS client_id",
			}

			for _, stmt := range alterStatements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}

			return nil
		},
	}
}
