package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateInitialSchema creates the full woofx3 database schema in a single
// migration. It folds together the original sixteen incremental migrations
// (0001-0016) that grew the schema during early development into a clean
// starting point. The migration ID is preserved so databases that already
// applied the original chain skip this migration; fresh installs run it once
// to reach the same final state.
//
// The migration is also idempotent against partially-migrated databases:
// every table uses CREATE TABLE IF NOT EXISTS, every later column uses
// ALTER TABLE ADD COLUMN IF NOT EXISTS, and renamed tables
// (module_functions -> functions, module_triggers -> triggers,
// module_actions -> actions) are handled up front so the schema converges
// to the final state regardless of starting point.
func CreateInitialSchema() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0001_initial_schema",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Running initial schema migration...")

			statements := []string{
				// -------------------------------------------------------------
				// Phase 1: rename legacy tables so subsequent CREATE / ALTER
				// statements always operate on the final names.
				// -------------------------------------------------------------
				`DO $$
				BEGIN
					IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'module_functions')
					   AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'functions') THEN
						ALTER TABLE public.module_functions RENAME TO functions;
					END IF;
				END
				$$`,
				`DO $$
				BEGIN
					IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'module_triggers')
					   AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'triggers') THEN
						ALTER TABLE public.module_triggers RENAME TO triggers;
					END IF;
				END
				$$`,
				`DO $$
				BEGIN
					IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'module_actions')
					   AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'actions') THEN
						ALTER TABLE public.module_actions RENAME TO actions;
					END IF;
				END
				$$`,

				// -------------------------------------------------------------
				// Phase 2: CREATE TABLE IF NOT EXISTS for every table in the
				// final schema. These are no-ops on partially-migrated DBs.
				// -------------------------------------------------------------

				// applications
				`CREATE TABLE IF NOT EXISTS public.applications (
					id         UUID      DEFAULT uuid_generate_v4()    NOT NULL PRIMARY KEY,
					name       VARCHAR(50)                             NOT NULL,
					user_id    UUID                                    NOT NULL,
					is_default BOOLEAN   DEFAULT FALSE                 NOT NULL,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP     NOT NULL,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP     NOT NULL
				)`,

				// users
				`CREATE TABLE IF NOT EXISTS public.users (
					id                UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					username          VARCHAR(50)                             NOT NULL,
					user_id           VARCHAR(50)                             NOT NULL,
					platform          VARCHAR(20),
					woofx3_ui_user_id VARCHAR(100),
					deleted_at        TIMESTAMP,
					created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP  NOT NULL,
					updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,

				// permissions
				`CREATE TABLE IF NOT EXISTS public.permissions (
					id             SERIAL       PRIMARY KEY,
					application_id UUID         NOT NULL REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					ptype          VARCHAR(100),
					v0             VARCHAR(100),
					v1             VARCHAR(100),
					v2             VARCHAR(100),
					v3             VARCHAR(100),
					v4             VARCHAR(100),
					v5             VARCHAR(100)
				)`,

				// user_events
				`CREATE TABLE IF NOT EXISTS public.user_events (
					id             UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					user_id        UUID                                   NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
					application_id UUID                                   NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
					event_type     VARCHAR(50)                            NOT NULL,
					event_value    JSONB,
					created_at     TIMESTAMP   DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,

				// settings
				`CREATE TABLE IF NOT EXISTS public.settings (
					id             SERIAL                                 PRIMARY KEY,
					application_id UUID                                   NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
					user_id        UUID,
					key            VARCHAR(100)                           NOT NULL,
					value          TEXT,
					created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL,
					CONSTRAINT uq_setting UNIQUE (application_id, key)
				)`,

				// commands
				`CREATE TABLE IF NOT EXISTS public.commands (
					id              UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					application_id  UUID                                    NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
					command         VARCHAR(255)                            NOT NULL,
					type            VARCHAR(50)                             NOT NULL,
					type_value      VARCHAR(500),
					cooldown        INTEGER      DEFAULT 0,
					created_by      UUID,
					priority        INTEGER      DEFAULT 0,
					enabled         BOOLEAN      DEFAULT TRUE               NOT NULL,
					created_by_type TEXT         DEFAULT 'USER'             NOT NULL,
					created_by_ref  TEXT         DEFAULT ''                 NOT NULL,
					created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,

				// user_applications
				`CREATE TABLE IF NOT EXISTS public.user_applications (
					id             UUID                     DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					user_id        UUID                                                NOT NULL REFERENCES public.users(id),
					application_id UUID                                                NOT NULL REFERENCES public.applications(id),
					role           VARCHAR(50)                                         NOT NULL,
					created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()              NOT NULL
				)`,

				// user_meta
				`CREATE TABLE IF NOT EXISTS public.user_meta (
					id         UUID                     DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					userid     UUID                                                NOT NULL REFERENCES public.users(id),
					name       VARCHAR(50)                                         NOT NULL,
					type       VARCHAR(50)                                         NOT NULL,
					value      VARCHAR(500),
					created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,

				// clients
				`CREATE TABLE IF NOT EXISTS public.clients (
					id             BIGSERIAL                 PRIMARY KEY,
					description    VARCHAR(100),
					application_id UUID                      NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
					client_id      UUID                      NOT NULL,
					client_secret  VARCHAR(100)              NOT NULL,
					callback_url   VARCHAR(255) DEFAULT '',
					callback_token VARCHAR(255) DEFAULT ''
				)`,

				// rewards
				`CREATE TABLE IF NOT EXISTS public.rewards (
					id             SERIAL                              PRIMARY KEY,
					client         VARCHAR(100)                        NOT NULL,
					name           VARCHAR(100)                        NOT NULL,
					activation_min INTEGER,
					activation_max INTEGER,
					type           VARCHAR(20)                         NOT NULL,
					type_value     JSON                                NOT NULL,
					created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
				)`,

				// worker_events (application_id and entity_id are VARCHAR(36) so
				// system-level events without a meaningful UUID can still be stored)
				`CREATE TABLE IF NOT EXISTS public.worker_events (
					id               UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					event_type       VARCHAR(255)                            NOT NULL,
					application_id   VARCHAR(36)  DEFAULT ''                 NOT NULL,
					entity_type      VARCHAR(100)                            NOT NULL,
					entity_id        VARCHAR(36)                             NOT NULL,
					operation        VARCHAR(50)                             NOT NULL,
					payload          JSONB                                   NOT NULL,
					status           VARCHAR(50)  DEFAULT 'pending'          NOT NULL,
					auto_acknowledge BOOLEAN      DEFAULT TRUE               NOT NULL,
					published_at     TIMESTAMP,
					acknowledged_at  TIMESTAMP,
					attempts         INTEGER      DEFAULT 0                  NOT NULL,
					max_attempts     INTEGER      DEFAULT 3                  NOT NULL,
					last_error       TEXT,
					nats_subject     VARCHAR(500)                            NOT NULL,
					ack_subject      VARCHAR(500),
					client_id        VARCHAR(255) DEFAULT ''                 NOT NULL,
					created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP  NOT NULL,
					updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,

				// workflow_definitions
				`CREATE TABLE IF NOT EXISTS public.workflow_definitions (
					id              UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					application_id  UUID                                    NOT NULL REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					name            VARCHAR(255)                            NOT NULL,
					steps           JSONB,
					trigger         JSONB,
					created_by      TEXT         DEFAULT ''                 NOT NULL,
					created_by_type TEXT         DEFAULT 'USER'             NOT NULL,
					created_by_ref  TEXT         DEFAULT ''                 NOT NULL,
					created_at      TIMESTAMP    DEFAULT NOW()              NOT NULL,
					updated_at      TIMESTAMP    DEFAULT NOW()              NOT NULL
				)`,

				// workflow_executions
				`CREATE TABLE IF NOT EXISTS public.workflow_executions (
					id             UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					workflow_id    UUID                                    NOT NULL REFERENCES public.workflow_definitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					application_id UUID                                    NOT NULL REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					user_id        UUID                                    NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
					status         VARCHAR(20)  DEFAULT 'pending'          NOT NULL,
					input          JSONB,
					output         JSONB,
					error          TEXT,
					started_at     TIMESTAMP,
					completed_at   TIMESTAMP,
					created_at     TIMESTAMP    DEFAULT NOW()              NOT NULL,
					updated_at     TIMESTAMP    DEFAULT NOW()              NOT NULL
				)`,

				// modules
				`CREATE TABLE IF NOT EXISTS public.modules (
					id              UUID      DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					name            TEXT                                 NOT NULL UNIQUE,
					module_key      TEXT                                 NOT NULL,
					version         TEXT                                 NOT NULL,
					manifest        TEXT,
					state           TEXT      DEFAULT 'active'           NOT NULL,
					archive_key     TEXT,
					created_by_type TEXT      DEFAULT 'USER'             NOT NULL,
					created_by_ref  TEXT      DEFAULT ''                 NOT NULL,
					installed_at    TIMESTAMP DEFAULT NOW()              NOT NULL,
					updated_at      TIMESTAMP DEFAULT NOW()              NOT NULL
				)`,

				// functions (originally module_functions; renamed when triggers
				// and actions were decoupled from modules)
				`CREATE TABLE IF NOT EXISTS public.functions (
					id            UUID DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					module_id     UUID                            NOT NULL REFERENCES public.modules(id) ON UPDATE CASCADE ON DELETE CASCADE,
					function_name TEXT                            NOT NULL,
					file_name     TEXT                            NOT NULL,
					file_key      TEXT                            NOT NULL,
					entry_point   TEXT DEFAULT 'main',
					runtime       TEXT                            NOT NULL
				)`,

				// triggers (decoupled from modules; identity comes from
				// created_by_type/created_by_ref instead of a module_id FK)
				`CREATE TABLE IF NOT EXISTS public.triggers (
					id              UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					category        TEXT                                   NOT NULL,
					name            TEXT                                   NOT NULL,
					description     TEXT        DEFAULT ''                 NOT NULL,
					event           TEXT                                   NOT NULL,
					config_schema   JSONB       DEFAULT '[]'               NOT NULL,
					allow_variants  BOOLEAN     DEFAULT FALSE              NOT NULL,
					created_by_type TEXT        DEFAULT 'MODULE'           NOT NULL,
					created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					created_at      TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					updated_at      TIMESTAMPTZ DEFAULT NOW()              NOT NULL
				)`,

				// actions (decoupled from modules; identity comes from
				// created_by_type/created_by_ref instead of a module_id FK)
				`CREATE TABLE IF NOT EXISTS public.actions (
					id              UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					name            TEXT                                   NOT NULL,
					description     TEXT        DEFAULT ''                 NOT NULL,
					call            TEXT                                   NOT NULL,
					params_schema   JSONB       DEFAULT '{}'               NOT NULL,
					created_by_type TEXT        DEFAULT 'MODULE'           NOT NULL,
					created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					created_at      TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					updated_at      TIMESTAMPTZ DEFAULT NOW()              NOT NULL
				)`,

				// module_resources
				`CREATE TABLE IF NOT EXISTS public.module_resources (
					id               UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					module_id        UUID                                   NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
					resource_type    TEXT                                   NOT NULL,
					resource_id      UUID,
					manifest_id      TEXT                                   NOT NULL,
					resource_name    TEXT                                   NOT NULL,
					original_version TEXT                                   NOT NULL,
					current_version  TEXT                                   NOT NULL,
					installed_at     TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					updated_at       TIMESTAMPTZ DEFAULT NOW()              NOT NULL
				)`,

				// resource_references
				`CREATE TABLE IF NOT EXISTS public.resource_references (
					id                     UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					application_id         UUID,
					source_type            TEXT                                   NOT NULL,
					source_id              UUID                                   NOT NULL,
					source_name            TEXT                                   NOT NULL,
					source_created_by_type TEXT        DEFAULT 'USER'             NOT NULL,
					source_created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					target_type            TEXT                                   NOT NULL,
					target_name            TEXT                                   NOT NULL,
					target_id              UUID,
					target_created_by_ref  TEXT,
					context                TEXT,
					created_at             TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					updated_at             TIMESTAMPTZ DEFAULT NOW()              NOT NULL
				)`,

				// -------------------------------------------------------------
				// Phase 3: ALTER TABLE ADD COLUMN IF NOT EXISTS for every column
				// added in the original 0002-0016 migrations. Required because
				// CREATE TABLE IF NOT EXISTS is a no-op on existing tables and
				// will not add new columns.
				// -------------------------------------------------------------
				`ALTER TABLE public.applications
					ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE`,

				`ALTER TABLE public.users
					ADD COLUMN IF NOT EXISTS woofx3_ui_user_id VARCHAR(100),
					ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMP`,

				`ALTER TABLE public.clients
					ADD COLUMN IF NOT EXISTS callback_url   VARCHAR(255) DEFAULT '',
					ADD COLUMN IF NOT EXISTS callback_token VARCHAR(255) DEFAULT ''`,

				`ALTER TABLE public.commands
					ADD COLUMN IF NOT EXISTS created_by_type TEXT NOT NULL DEFAULT 'USER',
					ADD COLUMN IF NOT EXISTS created_by_ref  TEXT NOT NULL DEFAULT ''`,

				`ALTER TABLE public.workflow_definitions
					ADD COLUMN IF NOT EXISTS created_by      TEXT NOT NULL DEFAULT '',
					ADD COLUMN IF NOT EXISTS created_by_type TEXT NOT NULL DEFAULT 'USER',
					ADD COLUMN IF NOT EXISTS created_by_ref  TEXT NOT NULL DEFAULT ''`,

				`ALTER TABLE public.modules
					ADD COLUMN IF NOT EXISTS module_key      TEXT,
					ADD COLUMN IF NOT EXISTS created_by_type TEXT NOT NULL DEFAULT 'USER',
					ADD COLUMN IF NOT EXISTS created_by_ref  TEXT NOT NULL DEFAULT ''`,
				// Backfill module_key for legacy rows, then enforce NOT NULL.
				`UPDATE public.modules
					SET module_key = name || ':' || version || ':0000000'
					WHERE module_key IS NULL OR module_key = ''`,
				`ALTER TABLE public.modules ALTER COLUMN module_key SET NOT NULL`,

				`ALTER TABLE public.worker_events
					ADD COLUMN IF NOT EXISTS client_id VARCHAR(255) NOT NULL DEFAULT ''`,
				// Relax UUID columns on worker_events for system-level events.
				`ALTER TABLE public.worker_events
					ALTER COLUMN application_id TYPE VARCHAR(36) USING application_id::text`,
				`ALTER TABLE public.worker_events
					ALTER COLUMN application_id SET DEFAULT ''`,
				`ALTER TABLE public.worker_events
					ALTER COLUMN entity_id TYPE VARCHAR(36) USING entity_id::text`,

				// triggers and actions had module_id / module_name in the
				// original schema; the decouple migration dropped them.
				`ALTER TABLE public.triggers
					DROP COLUMN IF EXISTS module_id,
					DROP COLUMN IF EXISTS module_name`,
				`ALTER TABLE public.actions
					DROP COLUMN IF EXISTS module_id,
					DROP COLUMN IF EXISTS module_name`,
				// Old uniqueness constraint that referenced the dropped columns.
				`ALTER TABLE public.triggers
					DROP CONSTRAINT IF EXISTS uq_module_triggers_module_id_name`,


				// Unique-by-creator constraints on the decoupled tables.
				`DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_triggers_creator_name') THEN
						ALTER TABLE public.triggers
							ADD CONSTRAINT uq_triggers_creator_name UNIQUE (created_by_type, created_by_ref, name);
					END IF;
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_actions_creator_name') THEN
						ALTER TABLE public.actions
							ADD CONSTRAINT uq_actions_creator_name UNIQUE (created_by_type, created_by_ref, name);
					END IF;
				END
				$$`,

				// -------------------------------------------------------------
				// Phase 4: indexes (and drop the legacy ones the rename phase
				// no longer matches).
				// -------------------------------------------------------------
				`DROP INDEX IF EXISTS public.idx_module_triggers_module_id`,
				`DROP INDEX IF EXISTS public.idx_module_triggers_origin`,
				`DROP INDEX IF EXISTS public.idx_module_triggers_event`,
				`DROP INDEX IF EXISTS public.idx_module_actions_module_id`,
				`DROP INDEX IF EXISTS public.idx_module_actions_origin`,

				`CREATE INDEX        IF NOT EXISTS idx_applications_user_id              ON public.applications        (user_id)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS applications_single_default           ON public.applications        (is_default) WHERE is_default = TRUE`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_woofx3_ui_user_id           ON public.users               (woofx3_ui_user_id) WHERE woofx3_ui_user_id IS NOT NULL`,
				`CREATE INDEX        IF NOT EXISTS idx_users_deleted_at                  ON public.users               (deleted_at)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions                       ON public.permissions         (ptype, v0, v1, v2, v3, v4, v5)`,
				`CREATE INDEX        IF NOT EXISTS idx_permission_application_id         ON public.permissions         (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_permission_ptype                  ON public.permissions         (ptype)`,
				`CREATE INDEX        IF NOT EXISTS idx_permission_v0                     ON public.permissions         (v0)`,
				`CREATE INDEX        IF NOT EXISTS idx_permission_v1                     ON public.permissions         (v1)`,
				`CREATE INDEX        IF NOT EXISTS idx_permission_v2                     ON public.permissions         (v2)`,
				`CREATE INDEX        IF NOT EXISTS idx_commands_application_id           ON public.commands            (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_commands_origin                   ON public.commands            (created_by_type, created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_user_app_application              ON public.user_applications   (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_user_app_user                     ON public.user_applications   (user_id)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_app_unique                   ON public.user_applications   (user_id, application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_user_meta_userid                  ON public.user_meta           (userid)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_client_id                 ON public.clients             (client_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_worker_events_event_type          ON public.worker_events       (event_type)`,
				`CREATE INDEX        IF NOT EXISTS idx_worker_events_application_id      ON public.worker_events       (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_worker_events_entity_type         ON public.worker_events       (entity_type)`,
				`CREATE INDEX        IF NOT EXISTS idx_worker_events_entity_id           ON public.worker_events       (entity_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_worker_events_status              ON public.worker_events       (status)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_definitions_application_id ON public.workflow_definitions (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_definitions_origin       ON public.workflow_definitions (created_by_type, created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_workflow_id   ON public.workflow_executions (workflow_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_application_id ON public.workflow_executions (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_user_id       ON public.workflow_executions (user_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_status        ON public.workflow_executions (status)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_started_at    ON public.workflow_executions (started_at)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_completed_at  ON public.workflow_executions (completed_at)`,
				`CREATE INDEX        IF NOT EXISTS idx_modules_name                      ON public.modules             (name)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_module_key                ON public.modules             (module_key)`,
				`CREATE INDEX        IF NOT EXISTS idx_modules_origin                    ON public.modules             (created_by_type, created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_functions_module_id               ON public.functions           (module_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_triggers_origin                   ON public.triggers            (created_by_type, created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_triggers_event                    ON public.triggers            (event)`,
				`CREATE INDEX        IF NOT EXISTS idx_actions_origin                    ON public.actions             (created_by_type, created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_module_resources_module_id        ON public.module_resources    (module_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_module_resources_resource_type    ON public.module_resources    (resource_type)`,
				`CREATE INDEX        IF NOT EXISTS idx_module_resources_manifest_id      ON public.module_resources    (module_id, manifest_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_rr_source                         ON public.resource_references (source_type, source_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_rr_target_lookup                  ON public.resource_references (target_type, target_name)`,
				`CREATE INDEX        IF NOT EXISTS idx_rr_target_module                  ON public.resource_references (target_created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_rr_application                    ON public.resource_references (application_id)`,
			}

			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tables := []string{
				"resource_references",
				"module_resources",
				"actions",
				"triggers",
				"functions",
				"modules",
				"workflow_executions",
				"workflow_definitions",
				"worker_events",
				"rewards",
				"clients",
				"user_meta",
				"user_applications",
				"commands",
				"settings",
				"user_events",
				"permissions",
				"applications",
				"users",
			}

			for _, table := range tables {
				if err := tx.Exec("DROP TABLE IF EXISTS public." + table + " CASCADE").Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
