package sqlite

import "github.com/go-gormigrate/gormigrate/v2"

// All returns the ordered SQLite migration chain. Keep IDs and order in sync
// with postgres.All so both dialects share the same migration history names.
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
		AddModuleResourcesUniqueConstraint(),
		AddArchivedAtColumns(),
		CreateSceneEventsTables(),
		RenameOverlayPublicUrlSetting(),
		CreateResourcesTable(),
	}
}
