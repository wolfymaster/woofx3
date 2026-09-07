package postgres

import "github.com/go-gormigrate/gormigrate/v2"

// All returns the ordered Postgres migration chain. Keep in sync with
// sqlite.All IDs so both dialects share the same migration history names.
//
// Note: 0028_module_resources_unique exists as a file but was historically
// omitted from the runner; it is included here so new and existing Postgres
// deployments pick up the unique index on the next migrate up.
func All() []*gormigrate.Migration {
	return []*gormigrate.Migration{
		CreateInitialSchema(),
		AddCanonicalIDColumns(),
		AddActionTypeColumn(),
		AddWorkflowManifestIDColumn(),
		AddWorkflowEnabledColumn(),
		CreateScenesTable(),
		CreateAssetsTable(),
		CreateAlertsTable(),
		CreateModuleResourceInstancesTable(),
		AddAlertLifecycle(),
		CreateWidgetStatusTable(),
		CreateModuleWidgetsTable(),
		AddApplicationIDColumns(),
		DropLegacyCreatedByColumns(),
		AddModulesModuleIDColumn(),
		RenameModuleWidgetsToWidgets(),
		CreateOverlayTokensTable(),
		AddWidgetEntryColumn(),
		CreateBackgroundTasksTable(),
		CreateModuleSettingsTables(),
		CreateCommandGroupsTables(),
		NormalizeCommandTypes(),
		AddCommandArgumentPatternColumn(),
		AddTaxonomyColumns(),
		AddActionOutputSchemaColumn(),
		AddWorkflowDefinitionsUniqueConstraint(),
		BackfillModuleCreatedByRef(),
		// Historically omitted from the runner; included so deploys pick up the
		// unique index. Safe/idempotent after the dedupe step.
		AddModuleResourcesUniqueConstraint(),
		AddArchivedAtColumns(),
		CreateSceneEventsTables(),
		RenameOverlayPublicUrlSetting(),
		AddBuiltInGroups(),
	}
}
