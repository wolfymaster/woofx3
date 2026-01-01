package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func CreateWorkerEventsTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202412310001_create_worker_events_table",
		Migrate: func(tx *gorm.DB) error {
			// Create worker_events table
			if err := tx.Exec(`
				CREATE TABLE IF NOT EXISTS public.worker_events (
					id               UUID      DEFAULT uuid_generate_v4() NOT NULL,
					event_type       VARCHAR(255)                         NOT NULL,
					application_id   UUID                                 NOT NULL,
					entity_type      VARCHAR(100)                         NOT NULL,
					entity_id        UUID                                 NOT NULL,
					operation        VARCHAR(50)                          NOT NULL,
					payload          JSONB                                NOT NULL,
					status           VARCHAR(50) DEFAULT 'pending'        NOT NULL,
					auto_acknowledge BOOLEAN    DEFAULT TRUE              NOT NULL,
					published_at     TIMESTAMP,
					acknowledged_at  TIMESTAMP,
					attempts         INTEGER    DEFAULT 0                 NOT NULL,
					max_attempts     INTEGER    DEFAULT 3                 NOT NULL,
					last_error       TEXT,
					nats_subject     VARCHAR(500)                         NOT NULL,
					ack_subject      VARCHAR(500),
					created_at       TIMESTAMP  DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at       TIMESTAMP  DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
			`).Error; err != nil {
				return err
			}

			// Add primary key constraint if not exists
			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'worker_events_pkey') THEN
						ALTER TABLE public.worker_events ADD CONSTRAINT worker_events_pkey PRIMARY KEY (id);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			// Create indexes if they don't exist
			indexes := []string{
				"CREATE INDEX IF NOT EXISTS idx_worker_events_event_type ON public.worker_events (event_type)",
				"CREATE INDEX IF NOT EXISTS idx_worker_events_application_id ON public.worker_events (application_id)",
				"CREATE INDEX IF NOT EXISTS idx_worker_events_entity_type ON public.worker_events (entity_type)",
				"CREATE INDEX IF NOT EXISTS idx_worker_events_entity_id ON public.worker_events (entity_id)",
				"CREATE INDEX IF NOT EXISTS idx_worker_events_status ON public.worker_events (status)",
			}

			for _, indexSQL := range indexes {
				if err := tx.Exec(indexSQL).Error; err != nil {
					return err
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec("DROP TABLE IF EXISTS public.worker_events CASCADE").Error
		},
	}
}
