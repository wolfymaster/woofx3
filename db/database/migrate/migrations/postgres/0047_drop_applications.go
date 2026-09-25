package postgres

import (
	"fmt"
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// Tables with a foreign key <table>_application_id_fkey into applications.
var applicationForeignKeyTables = []string{
	"alerts",
	"clients",
	"commands",
	"groups",
	"permissions",
	"resources",
	"scene_events",
	"scenes",
	"settings",
	"stream_session_segments",
	"stream_sessions",
	"user_applications",
	"user_events",
	"widget_status",
	"workflow_definitions",
	"workflow_execution_steps",
	"workflow_executions",
}

// Unique constraints whose key includes application_id, by table.
var applicationUniqueConstraints = [][2]string{
	{"settings", "uq_setting"},
	{"groups", "uq_group_application_name"},
	{"widget_status", "widget_status_unique"},
}

// Indexes whose key includes application_id.
var applicationIndexes = []string{
	"idx_actions_application_id",
	"idx_alerts_application_created_at",
	"idx_commands_application_id",
	"idx_overlay_tokens_application_id",
	"idx_permission_application_id",
	"idx_rr_application",
	"idx_resources_app_kind",
	"idx_resources_app_parent",
	"idx_scenes_application_id",
	"idx_scenes_application_name",
	"idx_stream_session_segments_one_open_per_app",
	"idx_stream_sessions_app_started_at",
	"idx_stream_sessions_one_open_per_app",
	"idx_triggers_application_id",
	"idx_widget_status_application_canonical",
	"idx_widget_status_application_module",
	"idx_widgets_application_id",
	"idx_worker_events_application_id",
	"idx_workflow_definitions_application_enabled",
	"idx_workflow_definitions_application_id",
	"idx_workflow_executions_app_started_at",
	"idx_workflow_executions_application_id",
	"applications_single_default",
}

// Tables that carry an application_id column, user_applications aside (it is
// dropped whole).
var applicationColumnTables = []string{
	"actions",
	"alerts",
	"background_tasks",
	"clients",
	"commands",
	"groups",
	"overlay_tokens",
	"permissions",
	"resource_references",
	"resources",
	"scene_events",
	"scenes",
	"settings",
	"stream_session_segments",
	"stream_sessions",
	"triggers",
	"user_events",
	"widget_status",
	"widgets",
	"worker_events",
	"workflow_definitions",
	"workflow_execution_steps",
	"workflow_executions",
}

// Replacements for the constraints and indexes above that scoped a rule or a
// read to one application. Names match the index tags on the models in
// database/models so the schema and the structs agree.
//
// The two "one open" indexes let at most one row satisfy the WHERE clause:
// every such row has the same key (status is 'open'; ended_at IS NULL is
// true), so a second one collides. ended_at itself cannot be the key because
// NULLs are distinct in a unique index.
var engineWideIndexes = []string{
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON public.settings (key)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_name ON public.scenes (name)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_name ON public.groups (name)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS widget_status_unique ON public.widget_status (instance_id, key)`,
	`CREATE INDEX IF NOT EXISTS idx_widget_status_module ON public.widget_status (module_id)`,
	`CREATE INDEX IF NOT EXISTS idx_widget_status_canonical_id
		ON public.widget_status (widget_canonical_id) WHERE widget_canonical_id <> ''`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_sessions_one_open
		ON public.stream_sessions (status) WHERE status = 'open'`,
	`CREATE INDEX IF NOT EXISTS idx_stream_sessions_started_at ON public.stream_sessions (started_at DESC)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_session_segments_one_open
		ON public.stream_session_segments ((ended_at IS NULL)) WHERE ended_at IS NULL`,
	`CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON public.alerts (created_at DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_resources_kind ON public.resources (kind)`,
	`CREATE INDEX IF NOT EXISTS idx_resources_parent_id ON public.resources (parent_id)`,
	`CREATE INDEX IF NOT EXISTS idx_workflow_definitions_enabled ON public.workflow_definitions (enabled)`,
	// workflow_executions (started_at) is already covered by
	// idx_workflow_executions_started_at from the initial schema; a b-tree
	// serves newest-first reads by scanning it backwards.
}

// DropApplications removes the application concept. An engine is
// single-tenant: it has exactly one set of data, so the applications table,
// user_applications, and the application_id column on every other table only
// added a lookup that could resolve one way. Rules that were per application
// (one value per setting key, one scene or group per name, one open stream
// session) become engine-wide.
//
// It refuses to run against more than one application rather than merging
// their data, because same-named settings, groups and scenes would collide
// with no correct winner.
//
// Dropping a column drops its indexes and foreign keys with it; they are
// dropped by name first anyway so the list of what goes is visible here. The
// whole change runs in one transaction.
func DropApplications() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0047_drop_applications",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Dropping applications...")
			if err := tx.Transaction(dropApplications); err != nil {
				return err
			}
			log.Println("applications drop complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible: the application a row belonged to is gone, and
			// with no application left to point at, the NOT NULL foreign keys
			// cannot be restored. Rollback is a deliberate no-op.
			return nil
		},
	}
}

func dropApplications(tx *gorm.DB) error {
	if err := assertAtMostOneApplication(tx); err != nil {
		return err
	}

	var statements []string
	for _, table := range applicationForeignKeyTables {
		statements = append(statements, fmt.Sprintf(
			`ALTER TABLE IF EXISTS public.%s DROP CONSTRAINT IF EXISTS %s_application_id_fkey`, table, table,
		))
	}
	for _, constraint := range applicationUniqueConstraints {
		statements = append(statements, fmt.Sprintf(
			`ALTER TABLE IF EXISTS public.%s DROP CONSTRAINT IF EXISTS %s`, constraint[0], constraint[1],
		))
	}
	for _, index := range applicationIndexes {
		statements = append(statements, fmt.Sprintf(`DROP INDEX IF EXISTS public.%s`, index))
	}
	for _, table := range applicationColumnTables {
		statements = append(statements, fmt.Sprintf(
			`ALTER TABLE IF EXISTS public.%s DROP COLUMN IF EXISTS application_id`, table,
		))
	}
	// No CASCADE: anything still referencing applications is a table this
	// migration does not know about, and should fail it rather than lose a
	// constraint silently.
	statements = append(statements,
		`DROP TABLE IF EXISTS public.user_applications`,
		`DROP TABLE IF EXISTS public.applications`,
	)
	for _, stmt := range statements {
		if err := tx.Exec(stmt).Error; err != nil {
			return err
		}
	}
	if err := assertNoApplicationColumns(tx); err != nil {
		return err
	}

	// A run recorded by the engine itself has no user to attribute it to.
	if err := tx.Exec(`ALTER TABLE public.workflow_executions ALTER COLUMN user_id DROP NOT NULL`).Error; err != nil {
		return err
	}
	for _, stmt := range engineWideIndexes {
		if err := tx.Exec(stmt).Error; err != nil {
			return err
		}
	}
	return seedEngineBuiltInGroups(tx)
}

// assertAtMostOneApplication refuses to merge several applications' data into
// one engine-wide set.
func assertAtMostOneApplication(tx *gorm.DB) error {
	var exists bool
	if err := tx.Raw(`SELECT to_regclass('public.applications') IS NOT NULL`).Row().Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return nil
	}
	var count int64
	if err := tx.Raw(`SELECT COUNT(*) FROM public.applications`).Scan(&count).Error; err != nil {
		return err
	}
	if count > 1 {
		return fmt.Errorf(
			"this engine holds %d applications; an engine is single-tenant and this migration "+
				"cannot choose which one's data to keep, so remove the extra applications first",
			count,
		)
	}
	return nil
}

func assertNoApplicationColumns(tx *gorm.DB) error {
	var tables []string
	if err := tx.Raw(
		`SELECT table_name FROM information_schema.columns
			WHERE table_schema = 'public' AND column_name = 'application_id'`,
	).Scan(&tables).Error; err != nil {
		return err
	}
	if len(tables) > 0 {
		return fmt.Errorf("application_id survived the migration on %v; add them to 0047_drop_applications", tables)
	}
	return nil
}

// seedEngineBuiltInGroups makes sure the engine has exactly one set of
// built-in groups. An engine that had an application already has them and is
// left as is; one that never had an application gets them here. A group an
// operator made under a built-in name is promoted rather than duplicated.
func seedEngineBuiltInGroups(tx *gorm.DB) error {
	for _, g := range models.BuiltInGroups {
		promoted := tx.Exec(`UPDATE public.groups SET is_built_in = TRUE WHERE name = ?`, g.Name)
		if promoted.Error != nil {
			return promoted.Error
		}
		if promoted.RowsAffected > 0 {
			continue
		}
		if err := tx.Exec(
			`INSERT INTO public.groups (id, name, description, is_built_in) VALUES (?, ?, ?, TRUE)`,
			uuid.New(), g.Name, g.Description,
		).Error; err != nil {
			return err
		}
	}
	return nil
}
