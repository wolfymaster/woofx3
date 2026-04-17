package services

import "github.com/wolfymaster/woofx3/db/database/models"

func buildTriggerRegisteredData(moduleKey, moduleName, version string, triggers []*models.Trigger) map[string]any {
	rows := make([]map[string]any, 0, len(triggers))
	for _, t := range triggers {
		rows = append(rows, map[string]any{
			"id":              t.ID.String(),
			"category":        t.Category,
			"name":            t.Name,
			"description":     t.Description,
			"event":           t.Event,
			"config_schema":   t.ConfigSchema,
			"allow_variants":  t.AllowVariants,
			"created_by_type": t.CreatedByType,
			"created_by_ref":  t.CreatedByRef,
		})
	}
	return map[string]any{
		"module_key":  moduleKey,
		"module_name": moduleName,
		"version":     version,
		"triggers":    rows,
	}
}

func buildActionRegisteredData(moduleKey, moduleName, version string, actions []*models.Action) map[string]any {
	rows := make([]map[string]any, 0, len(actions))
	for _, a := range actions {
		rows = append(rows, map[string]any{
			"id":              a.ID.String(),
			"name":            a.Name,
			"description":     a.Description,
			"call":            a.Call,
			"params_schema":   a.ParamsSchema,
			"created_by_type": a.CreatedByType,
			"created_by_ref":  a.CreatedByRef,
		})
	}
	return map[string]any{
		"module_key":  moduleKey,
		"module_name": moduleName,
		"version":     version,
		"actions":     rows,
	}
}
