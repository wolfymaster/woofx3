package sqlite

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
// SQLite note: Phase 1 Postgres DO $$ legacy renames are omitted — a fresh
// SQLite database has no legacy table names. Conditional renames that matter
// later (e.g. 0016) use Go helpers against sqlite_master.
func CreateInitialSchema() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0001_initial_schema",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Running initial schema migration...")

			statements := []string{
				// -------------------------------------------------------------
				// Phase 2: CREATE TABLE IF NOT EXISTS for every table in the
				// final schema. These are no-ops on partially-migrated DBs.
				// -------------------------------------------------------------

				// applications
				`CREATE TABLE IF NOT EXISTS applications (
					id         TEXT                                NOT NULL PRIMARY KEY,
					name       VARCHAR(50)                         NOT NULL,
					user_id    TEXT                                NOT NULL,
					is_default INTEGER   DEFAULT 0                 NOT NULL,
					created_at TEXT      DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at TEXT      DEFAULT CURRENT_TIMESTAMP NOT NULL
				)`,

				// users
				`CREATE TABLE IF NOT EXISTS users (
					id                TEXT         NOT NULL PRIMARY KEY,
					username          VARCHAR(50)                         NOT NULL,
					user_id           VARCHAR(50)                         NOT NULL,
					platform          VARCHAR(20),
					woofx3_ui_user_id VARCHAR(100),
					deleted_at        TEXT,
					created_at        TEXT         DEFAULT CURRENT_TIMESTAMP  NOT NULL,
					updated_at        TEXT         DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,

				// permissions
				`CREATE TABLE IF NOT EXISTS permissions (
					id             INTEGER      PRIMARY KEY AUTOINCREMENT,
					application_id TEXT         NOT NULL REFERENCES applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					ptype          VARCHAR(100),
					v0             VARCHAR(100),
					v1             VARCHAR(100),
					v2             VARCHAR(100),
					v3             VARCHAR(100),
					v4             VARCHAR(100),
					v5             VARCHAR(100)
				)`,

				// user_events
				`CREATE TABLE IF NOT EXISTS user_events (
					id             TEXT        NOT NULL PRIMARY KEY,
					user_id        TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
					application_id TEXT        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
					event_type     VARCHAR(50) NOT NULL,
					event_value    TEXT,
					created_at     TEXT        DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,

				// settings
				`CREATE TABLE IF NOT EXISTS settings (
					id             INTEGER                              PRIMARY KEY AUTOINCREMENT,
					application_id TEXT                                 NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
					user_id        TEXT,
					key            VARCHAR(100)                         NOT NULL,
					value          TEXT,
					created_at     TEXT         DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at     TEXT         DEFAULT CURRENT_TIMESTAMP NOT NULL,
					CONSTRAINT uq_setting UNIQUE (application_id, key)
				)`,

				// commands
				`CREATE TABLE IF NOT EXISTS commands (
					id              TEXT         NOT NULL PRIMARY KEY,
					application_id  TEXT         NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
					command         VARCHAR(255) NOT NULL,
					type            VARCHAR(50)  NOT NULL,
					type_value      VARCHAR(500),
					cooldown        INTEGER      DEFAULT 0,
					created_by      TEXT,
					priority        INTEGER      DEFAULT 0,
					enabled         INTEGER      DEFAULT 1               NOT NULL,
					created_by_type TEXT         DEFAULT 'USER'          NOT NULL,
					created_by_ref  TEXT         DEFAULT ''              NOT NULL,
					created_at      TEXT         DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,

				// user_applications
				`CREATE TABLE IF NOT EXISTS user_applications (
					id             TEXT                     NOT NULL PRIMARY KEY,
					user_id        TEXT                     NOT NULL REFERENCES users(id),
					application_id TEXT                     NOT NULL REFERENCES applications(id),
					role           VARCHAR(50)              NOT NULL,
					created_at     TEXT                     DEFAULT (datetime('now')) NOT NULL
				)`,

				// user_meta
				`CREATE TABLE IF NOT EXISTS user_meta (
					id         TEXT                     NOT NULL PRIMARY KEY,
					userid     TEXT                     NOT NULL REFERENCES users(id),
					name       VARCHAR(50)              NOT NULL,
					type       VARCHAR(50)              NOT NULL,
					value      VARCHAR(500),
					created_at TEXT                     DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,

				// clients
				`CREATE TABLE IF NOT EXISTS clients (
					id             INTEGER                   PRIMARY KEY AUTOINCREMENT,
					description    VARCHAR(100),
					application_id TEXT                      NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
					client_id      TEXT                      NOT NULL,
					client_secret  VARCHAR(100)              NOT NULL,
					callback_url   VARCHAR(255) DEFAULT '',
					callback_token VARCHAR(255) DEFAULT ''
				)`,

				// rewards
				`CREATE TABLE IF NOT EXISTS rewards (
					id             INTEGER                           PRIMARY KEY AUTOINCREMENT,
					client         VARCHAR(100)                      NOT NULL,
					name           VARCHAR(100)                      NOT NULL,
					activation_min INTEGER,
					activation_max INTEGER,
					type           VARCHAR(20)                       NOT NULL,
					type_value     TEXT                              NOT NULL,
					created_at     TEXT DEFAULT CURRENT_TIMESTAMP    NOT NULL
				)`,

				// worker_events
				`CREATE TABLE IF NOT EXISTS worker_events (
					id               TEXT         NOT NULL PRIMARY KEY,
					event_type       VARCHAR(255)                            NOT NULL,
					application_id   VARCHAR(36)  DEFAULT ''                 NOT NULL,
					entity_type      VARCHAR(100)                            NOT NULL,
					entity_id        VARCHAR(36)                             NOT NULL,
					operation        VARCHAR(50)                             NOT NULL,
					payload          TEXT                                    NOT NULL,
					status           VARCHAR(50)  DEFAULT 'pending'          NOT NULL,
					auto_acknowledge INTEGER      DEFAULT 1                  NOT NULL,
					published_at     TEXT,
					acknowledged_at  TEXT,
					attempts         INTEGER      DEFAULT 0                  NOT NULL,
					max_attempts     INTEGER      DEFAULT 3                  NOT NULL,
					last_error       TEXT,
					nats_subject     VARCHAR(500)                            NOT NULL,
					ack_subject      VARCHAR(500),
					client_id        VARCHAR(255) DEFAULT ''                 NOT NULL,
					created_at       TEXT         DEFAULT CURRENT_TIMESTAMP  NOT NULL,
					updated_at       TEXT         DEFAULT CURRENT_TIMESTAMP  NOT NULL
				)`,

				// workflow_definitions
				`CREATE TABLE IF NOT EXISTS workflow_definitions (
					id              TEXT         NOT NULL PRIMARY KEY,
					application_id  TEXT         NOT NULL REFERENCES applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					name            VARCHAR(255) NOT NULL,
					steps           TEXT,
					trigger         TEXT,
					created_by      TEXT         DEFAULT ''                 NOT NULL,
					created_by_type TEXT         DEFAULT 'USER'             NOT NULL,
					created_by_ref  TEXT         DEFAULT ''                 NOT NULL,
					created_at      TEXT         DEFAULT (datetime('now'))  NOT NULL,
					updated_at      TEXT         DEFAULT (datetime('now'))  NOT NULL
				)`,

				// workflow_executions
				`CREATE TABLE IF NOT EXISTS workflow_executions (
					id             TEXT         NOT NULL PRIMARY KEY,
					workflow_id    TEXT         NOT NULL REFERENCES workflow_definitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					application_id TEXT         NOT NULL REFERENCES applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					user_id        TEXT         NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
					status         VARCHAR(20)  DEFAULT 'pending'          NOT NULL,
					input          TEXT,
					output         TEXT,
					error          TEXT,
					started_at     TEXT,
					completed_at   TEXT,
					created_at     TEXT         DEFAULT (datetime('now'))  NOT NULL,
					updated_at     TEXT         DEFAULT (datetime('now'))  NOT NULL
				)`,

				// modules
				`CREATE TABLE IF NOT EXISTS modules (
					id              TEXT      NOT NULL PRIMARY KEY,
					name            TEXT                                 NOT NULL UNIQUE,
					module_key      TEXT                                 NOT NULL,
					version         TEXT                                 NOT NULL,
					manifest        TEXT,
					state           TEXT      DEFAULT 'active'           NOT NULL,
					archive_key     TEXT,
					created_by_type TEXT      DEFAULT 'USER'             NOT NULL,
					created_by_ref  TEXT      DEFAULT ''                 NOT NULL,
					installed_at    TEXT      DEFAULT (datetime('now'))  NOT NULL,
					updated_at      TEXT      DEFAULT (datetime('now'))  NOT NULL
				)`,

				// functions
				`CREATE TABLE IF NOT EXISTS functions (
					id            TEXT NOT NULL PRIMARY KEY,
					module_id     TEXT NOT NULL REFERENCES modules(id) ON UPDATE CASCADE ON DELETE CASCADE,
					function_name TEXT NOT NULL,
					file_name     TEXT NOT NULL,
					file_key      TEXT NOT NULL,
					entry_point   TEXT DEFAULT 'main',
					runtime       TEXT NOT NULL
				)`,

				// triggers
				`CREATE TABLE IF NOT EXISTS triggers (
					id              TEXT        NOT NULL PRIMARY KEY,
					category        TEXT                                   NOT NULL,
					name            TEXT                                   NOT NULL,
					description     TEXT        DEFAULT ''                 NOT NULL,
					event           TEXT                                   NOT NULL,
					config_schema   TEXT        DEFAULT '[]'               NOT NULL,
					allow_variants  INTEGER     DEFAULT 0                  NOT NULL,
					created_by_type TEXT        DEFAULT 'MODULE'           NOT NULL,
					created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					created_at      TEXT        DEFAULT (datetime('now'))  NOT NULL,
					updated_at      TEXT        DEFAULT (datetime('now'))  NOT NULL
				)`,

				// actions
				`CREATE TABLE IF NOT EXISTS actions (
					id              TEXT        NOT NULL PRIMARY KEY,
					name            TEXT                                   NOT NULL,
					description     TEXT        DEFAULT ''                 NOT NULL,
					call            TEXT                                   NOT NULL,
					params_schema   TEXT        DEFAULT '{}'               NOT NULL,
					created_by_type TEXT        DEFAULT 'MODULE'           NOT NULL,
					created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					created_at      TEXT        DEFAULT (datetime('now'))  NOT NULL,
					updated_at      TEXT        DEFAULT (datetime('now'))  NOT NULL
				)`,

				// widgets
				`CREATE TABLE IF NOT EXISTS widgets (
					id              TEXT        NOT NULL PRIMARY KEY,
					name            TEXT                                   NOT NULL,
					description     TEXT        DEFAULT ''                 NOT NULL,
					directory       TEXT                                   NOT NULL,
					alert_types     TEXT        DEFAULT '[]'               NOT NULL,
					settings_schema TEXT        DEFAULT '[]'               NOT NULL,
					surface         TEXT        DEFAULT 'scene'            NOT NULL,
					created_by_type TEXT        DEFAULT 'MODULE'           NOT NULL,
					created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					manifest_id     TEXT        DEFAULT ''                 NOT NULL,
					application_id  TEXT        DEFAULT ''                 NOT NULL,
					created_at      TEXT        DEFAULT (datetime('now'))  NOT NULL,
					updated_at      TEXT        DEFAULT (datetime('now'))  NOT NULL
				)`,

				// module_resources
				`CREATE TABLE IF NOT EXISTS module_resources (
					id               TEXT        NOT NULL PRIMARY KEY,
					module_id        TEXT        NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
					resource_type    TEXT                                   NOT NULL,
					resource_id      TEXT,
					manifest_id      TEXT                                   NOT NULL,
					resource_name    TEXT                                   NOT NULL,
					original_version TEXT                                   NOT NULL,
					current_version  TEXT                                   NOT NULL,
					installed_at     TEXT        DEFAULT (datetime('now'))  NOT NULL,
					updated_at       TEXT        DEFAULT (datetime('now'))  NOT NULL
				)`,

				// resource_references
				`CREATE TABLE IF NOT EXISTS resource_references (
					id                     TEXT        NOT NULL PRIMARY KEY,
					application_id         TEXT,
					source_type            TEXT                                   NOT NULL,
					source_id              TEXT                                   NOT NULL,
					source_name            TEXT                                   NOT NULL,
					source_created_by_type TEXT        DEFAULT 'USER'             NOT NULL,
					source_created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					target_type            TEXT                                   NOT NULL,
					target_name            TEXT                                   NOT NULL,
					target_id              TEXT,
					target_created_by_ref  TEXT,
					context                TEXT,
					created_at             TEXT        DEFAULT (datetime('now'))  NOT NULL,
					updated_at             TEXT        DEFAULT (datetime('now'))  NOT NULL
				)`,

				// -------------------------------------------------------------
				// Phase 3: ALTER TABLE ADD COLUMN IF NOT EXISTS (one column
				// per statement). Postgres TYPE / SET NOT NULL alters that
				// have no SQLite equivalent are omitted — CREATE TABLE above
				// already matches the post-Phase-3 shape for fresh DBs.
				// -------------------------------------------------------------
				`ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_default INTEGER NOT NULL DEFAULT 0`,

				`ALTER TABLE users ADD COLUMN IF NOT EXISTS woofx3_ui_user_id VARCHAR(100)`,
				`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TEXT`,

				`ALTER TABLE clients ADD COLUMN IF NOT EXISTS callback_url VARCHAR(255) DEFAULT ''`,
				`ALTER TABLE clients ADD COLUMN IF NOT EXISTS callback_token VARCHAR(255) DEFAULT ''`,

				`ALTER TABLE commands ADD COLUMN IF NOT EXISTS created_by_type TEXT NOT NULL DEFAULT 'USER'`,
				`ALTER TABLE commands ADD COLUMN IF NOT EXISTS created_by_ref TEXT NOT NULL DEFAULT ''`,

				`ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS created_by_type TEXT NOT NULL DEFAULT 'USER'`,
				`ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS created_by_ref TEXT NOT NULL DEFAULT ''`,

				`ALTER TABLE modules ADD COLUMN IF NOT EXISTS module_key TEXT`,
				`ALTER TABLE modules ADD COLUMN IF NOT EXISTS created_by_type TEXT NOT NULL DEFAULT 'USER'`,
				`ALTER TABLE modules ADD COLUMN IF NOT EXISTS created_by_ref TEXT NOT NULL DEFAULT ''`,
				`UPDATE modules
					SET module_key = name || ':' || version || ':0000000'
					WHERE module_key IS NULL OR module_key = ''`,

				`ALTER TABLE worker_events ADD COLUMN IF NOT EXISTS client_id VARCHAR(255) NOT NULL DEFAULT ''`,

				// triggers/actions may still have legacy columns on partial DBs.
				`ALTER TABLE triggers DROP COLUMN IF EXISTS module_id`,
				`ALTER TABLE triggers DROP COLUMN IF EXISTS module_name`,
				`ALTER TABLE actions DROP COLUMN IF EXISTS module_id`,
				`ALTER TABLE actions DROP COLUMN IF EXISTS module_name`,
				`ALTER TABLE widgets ADD COLUMN IF NOT EXISTS manifest_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE widgets ADD COLUMN IF NOT EXISTS application_id TEXT NOT NULL DEFAULT ''`,

				`DROP INDEX IF EXISTS uq_module_triggers_module_id_name`,

				// Unique-by-creator indexes (indexes so later migrations can DROP INDEX).
				`CREATE UNIQUE INDEX IF NOT EXISTS uq_triggers_creator_name
					ON triggers (created_by_type, created_by_ref, name)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS uq_actions_creator_name
					ON actions (created_by_type, created_by_ref, name)`,

				// -------------------------------------------------------------
				// Phase 4: indexes
				// -------------------------------------------------------------
				`DROP INDEX IF EXISTS idx_module_triggers_module_id`,
				`DROP INDEX IF EXISTS idx_module_triggers_origin`,
				`DROP INDEX IF EXISTS idx_module_triggers_event`,
				`DROP INDEX IF EXISTS idx_module_actions_module_id`,
				`DROP INDEX IF EXISTS idx_module_actions_origin`,
				`DROP INDEX IF EXISTS idx_module_widgets_origin`,
				`DROP INDEX IF EXISTS idx_module_widgets_origin_manifest`,

				`CREATE INDEX        IF NOT EXISTS idx_applications_user_id              ON applications        (user_id)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS applications_single_default           ON applications        (is_default) WHERE is_default = 1`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_woofx3_ui_user_id           ON users               (woofx3_ui_user_id) WHERE woofx3_ui_user_id IS NOT NULL`,
				`CREATE INDEX        IF NOT EXISTS idx_users_deleted_at                  ON users               (deleted_at)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions                       ON permissions         (ptype, v0, v1, v2, v3, v4, v5)`,
				`CREATE INDEX        IF NOT EXISTS idx_permission_application_id         ON permissions         (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_permission_ptype                  ON permissions         (ptype)`,
				`CREATE INDEX        IF NOT EXISTS idx_permission_v0                     ON permissions         (v0)`,
				`CREATE INDEX        IF NOT EXISTS idx_permission_v1                     ON permissions         (v1)`,
				`CREATE INDEX        IF NOT EXISTS idx_permission_v2                     ON permissions         (v2)`,
				`CREATE INDEX        IF NOT EXISTS idx_commands_application_id           ON commands            (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_commands_origin                   ON commands            (created_by_type, created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_user_app_application              ON user_applications   (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_user_app_user                     ON user_applications   (user_id)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_app_unique                   ON user_applications   (user_id, application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_user_meta_userid                  ON user_meta           (userid)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_client_id                 ON clients             (client_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_worker_events_event_type          ON worker_events       (event_type)`,
				`CREATE INDEX        IF NOT EXISTS idx_worker_events_application_id      ON worker_events       (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_worker_events_entity_type         ON worker_events       (entity_type)`,
				`CREATE INDEX        IF NOT EXISTS idx_worker_events_entity_id           ON worker_events       (entity_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_worker_events_status              ON worker_events       (status)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_definitions_application_id ON workflow_definitions (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_definitions_origin       ON workflow_definitions (created_by_type, created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_workflow_id   ON workflow_executions (workflow_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_application_id ON workflow_executions (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_user_id       ON workflow_executions (user_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_status        ON workflow_executions (status)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_started_at    ON workflow_executions (started_at)`,
				`CREATE INDEX        IF NOT EXISTS idx_workflow_executions_completed_at  ON workflow_executions (completed_at)`,
				`CREATE INDEX        IF NOT EXISTS idx_modules_name                      ON modules             (name)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_module_key                ON modules             (module_key)`,
				`CREATE INDEX        IF NOT EXISTS idx_modules_origin                    ON modules             (created_by_type, created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_functions_module_id               ON functions           (module_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_triggers_origin                   ON triggers            (created_by_type, created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_triggers_event                    ON triggers            (event)`,
				`CREATE INDEX        IF NOT EXISTS idx_actions_origin                    ON actions             (created_by_type, created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_widgets_origin                    ON widgets             (created_by_type, created_by_ref)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_widgets_origin_manifest           ON widgets             (created_by_type, created_by_ref, manifest_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_widgets_application_id            ON widgets             (application_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_module_resources_module_id        ON module_resources    (module_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_module_resources_resource_type    ON module_resources    (resource_type)`,
				`CREATE INDEX        IF NOT EXISTS idx_module_resources_manifest_id      ON module_resources    (module_id, manifest_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_rr_source                         ON resource_references (source_type, source_id)`,
				`CREATE INDEX        IF NOT EXISTS idx_rr_target_lookup                  ON resource_references (target_type, target_name)`,
				`CREATE INDEX        IF NOT EXISTS idx_rr_target_module                  ON resource_references (target_created_by_ref)`,
				`CREATE INDEX        IF NOT EXISTS idx_rr_application                    ON resource_references (application_id)`,
			}

			if err := execStatements(tx, statements); err != nil {
				return err
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
				if err := tx.Exec("DROP TABLE IF EXISTS " + table).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
