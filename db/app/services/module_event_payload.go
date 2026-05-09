package services

import (
	"encoding/json"
	"strings"

	"github.com/wolfymaster/woofx3/db/database/models"
)

// moduleCatalogFields parses a stored module manifest (JSON string from
// `modules.manifest`) and extracts the catalog-facing presentation
// fields the UI surfaces. `author` and `category` default to "Unknown"
// when missing, blank, or when the manifest is malformed; `description`
// defaults to "". The UI must always have a concrete string to render.
func moduleCatalogFields(rawManifest string) (author, category, description string) {
	author, category, description = "Unknown", "Unknown", ""
	if rawManifest == "" {
		return
	}
	var parsed struct {
		Author      *string `json:"author"`
		Category    *string `json:"category"`
		Description *string `json:"description"`
	}
	if err := json.Unmarshal([]byte(rawManifest), &parsed); err != nil {
		return
	}
	if parsed.Author != nil {
		if v := strings.TrimSpace(*parsed.Author); v != "" {
			author = v
		}
	}
	if parsed.Category != nil {
		if v := strings.TrimSpace(*parsed.Category); v != "" {
			category = v
		}
	}
	if parsed.Description != nil {
		description = strings.TrimSpace(*parsed.Description)
	}
	return
}

// canonicalIDFromCreatedByRef extracts the manifest id (the moduleId
// segment of a canonical id) from a row's `created_by_ref` field, which
// stores the composite module_key (`{moduleId}:{version}:{hash}`).
// Falls back to the whole ref when it isn't colon-delimited (legacy rows
// written before the composite format).
func moduleIDFromCreatedByRef(createdByRef string) string {
	if i := strings.IndexByte(createdByRef, ':'); i > 0 {
		return createdByRef[:i]
	}
	return createdByRef
}

// canonicalIDFor builds a `{moduleId}:{kind}:{resourceId}` string. Used
// to reconstruct canonical ids in deregistration events from row data.
// See `docs/barkloader/modules.md` for the format contract.
func canonicalIDFor(moduleID, kind, resourceID string) string {
	return moduleID + ":" + kind + ":" + resourceID
}

// projectionKeyFor builds the UI-projection identity for a MODULE-owned
// resource: `{moduleKey}:{kind}:{manifestId}` where `moduleKey` is the
// composite `{moduleId}:{version}:{hash}` stored as `created_by_ref` on
// trigger / action rows. Returns "" when the row isn't module-owned or
// is missing required fields, so callers can omit the JSON field rather
// than emit a malformed key downstream.
//
// Distinct from canonicalId (which omits version): projectionKey is
// version-pinned so the UI projects v1 and v2 of the same module as
// distinct rows, while staying stable across engine instances that
// installed the same zip (the zip hash is deterministic).
func projectionKeyFor(createdByType, createdByRef, kind, manifestID string) string {
	if createdByType != "MODULE" || createdByRef == "" || manifestID == "" {
		return ""
	}
	return createdByRef + ":" + kind + ":" + manifestID
}

func buildTriggerRegisteredData(moduleKey, moduleName, version string, triggers []*models.Trigger) map[string]any {
	rows := make([]map[string]any, 0, len(triggers))
	for _, t := range triggers {
		row := map[string]any{
			"id":              t.ID.String(),
			"category":        t.Category,
			"name":            t.Name,
			"description":     t.Description,
			"event":           t.Event,
			"config_schema":   t.ConfigSchema,
			"allow_variants":  t.AllowVariants,
			"created_by_type": t.CreatedByType,
			"created_by_ref":  t.CreatedByRef,
		}
		if pk := projectionKeyFor(t.CreatedByType, t.CreatedByRef, "trigger", t.ManifestID); pk != "" {
			row["projection_key"] = pk
		}
		rows = append(rows, row)
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
		row := map[string]any{
			"id":              a.ID.String(),
			"name":            a.Name,
			"description":     a.Description,
			"call":            a.Call,
			"params_schema":   a.ParamsSchema,
			"created_by_type": a.CreatedByType,
			"created_by_ref":  a.CreatedByRef,
		}
		if pk := projectionKeyFor(a.CreatedByType, a.CreatedByRef, "action", a.ManifestID); pk != "" {
			row["projection_key"] = pk
		}
		rows = append(rows, row)
	}
	return map[string]any{
		"module_key":  moduleKey,
		"module_name": moduleName,
		"version":     version,
		"actions":     rows,
	}
}

// buildFunctionRegisteredData mirrors the trigger / action helpers above.
// Functions are written inline by CreateModule / UpdateModule (no separate
// RegisterFunctions RPC), so we build the outbox payload from whatever the
// service has just persisted. `canonical_id` is derived from the parent
// module key + the function row's `manifest_id` — symmetric with the
// trigger / action registered events.
func buildFunctionRegisteredData(moduleID, moduleKey, moduleName, version string, functions []models.ModuleFunction) map[string]any {
	moduleSegment := moduleIDFromCreatedByRef(moduleKey)
	rows := make([]map[string]any, 0, len(functions))
	for _, f := range functions {
		row := map[string]any{
			"id":           f.ID.String(),
			"canonical_id": canonicalIDFor(moduleSegment, "function", f.ManifestID),
			"module_id":    moduleID,
			"manifest_id":  f.ManifestID,
			"name":         f.Name,
			"file_name":    f.FileName,
			"entry_point":  f.EntryPoint,
			"runtime":      f.Runtime,
		}
		// Function rows aren't tagged with `created_by_*` (functions
		// always belong to their parent module row), so we synthesize
		// the projectionKey directly from the parent module's moduleKey.
		// MODULE-only — `moduleKey` is always the composite key here.
		if moduleKey != "" && f.ManifestID != "" {
			row["projection_key"] = moduleKey + ":function:" + f.ManifestID
		}
		rows = append(rows, row)
	}
	return map[string]any{
		"module_key":  moduleKey,
		"module_name": moduleName,
		"version":     version,
		"functions":   rows,
	}
}

// buildTriggerDeregisteredData publishes the canonical ids and metadata of
// triggers being removed so subscribers (workflow engine, UI, downstream
// caches) can drop their per-trigger state symmetrically with the
// `module.trigger.registered` event. Canonical id = `{moduleId}:trigger:{manifest_id}`,
// where moduleId is the first segment of `created_by_ref`.
func buildTriggerDeregisteredData(modulePrefix string, triggers []*models.Trigger) map[string]any {
	rows := make([]map[string]any, 0, len(triggers))
	for _, t := range triggers {
		moduleID := moduleIDFromCreatedByRef(t.CreatedByRef)
		row := map[string]any{
			"id":             t.ID.String(),
			"canonical_id":   canonicalIDFor(moduleID, "trigger", t.ManifestID),
			"manifest_id":    t.ManifestID,
			"category":       t.Category,
			"name":           t.Name,
			"description":    t.Description,
			"event":          t.Event,
			"config_schema":  t.ConfigSchema,
			"allow_variants": t.AllowVariants,
			"created_by_ref": t.CreatedByRef,
		}
		if pk := projectionKeyFor(t.CreatedByType, t.CreatedByRef, "trigger", t.ManifestID); pk != "" {
			row["projection_key"] = pk
		}
		rows = append(rows, row)
	}
	return map[string]any{
		"module_prefix": modulePrefix,
		"triggers":      rows,
	}
}

// buildActionDeregisteredData mirrors buildTriggerDeregisteredData for
// actions. Canonical id is derived from `created_by_ref` (the moduleId
// segment) and the row's `manifest_id` column.
func buildActionDeregisteredData(modulePrefix string, actions []*models.Action) map[string]any {
	rows := make([]map[string]any, 0, len(actions))
	for _, a := range actions {
		moduleID := moduleIDFromCreatedByRef(a.CreatedByRef)
		row := map[string]any{
			"id":             a.ID.String(),
			"canonical_id":   canonicalIDFor(moduleID, "action", a.ManifestID),
			"manifest_id":    a.ManifestID,
			"name":           a.Name,
			"description":    a.Description,
			"call":           a.Call,
			"params_schema":  a.ParamsSchema,
			"created_by_ref": a.CreatedByRef,
		}
		if pk := projectionKeyFor(a.CreatedByType, a.CreatedByRef, "action", a.ManifestID); pk != "" {
			row["projection_key"] = pk
		}
		rows = append(rows, row)
	}
	return map[string]any{
		"module_prefix": modulePrefix,
		"actions":       rows,
	}
}

// buildAssetRegisteredData mirrors buildActionRegisteredData for the
// asset surface. Each row carries the engine-side identifiers plus
// `repository_key` — the path the deployer's URL pipeline turns into
// a fetchable URL. The engine deliberately does not carry a public
// URL here; that's the deployer's concern.
func buildAssetRegisteredData(moduleKey, moduleName, version string, assets []*models.Asset) map[string]any {
	rows := make([]map[string]any, 0, len(assets))
	for _, a := range assets {
		moduleID := moduleIDFromCreatedByRef(a.CreatedByRef)
		row := map[string]any{
			"id":              a.ID.String(),
			"canonical_id":    canonicalIDFor(moduleID, "asset", a.ManifestID),
			"manifest_id":     a.ManifestID,
			"name":            a.Name,
			"description":     a.Description,
			"manifest_path":   a.ManifestPath,
			"repository_key":  a.RepositoryKey,
			"kind":            a.Kind,
			"content_type":    a.ContentType,
			"created_by_type": a.CreatedByType,
			"created_by_ref":  a.CreatedByRef,
		}
		if pk := projectionKeyFor(a.CreatedByType, a.CreatedByRef, "asset", a.ManifestID); pk != "" {
			row["projection_key"] = pk
		}
		rows = append(rows, row)
	}
	return map[string]any{
		"module_key":  moduleKey,
		"module_name": moduleName,
		"version":     version,
		"assets":      rows,
	}
}

func buildAssetDeregisteredData(modulePrefix string, assets []*models.Asset) map[string]any {
	rows := make([]map[string]any, 0, len(assets))
	for _, a := range assets {
		moduleID := moduleIDFromCreatedByRef(a.CreatedByRef)
		row := map[string]any{
			"id":             a.ID.String(),
			"canonical_id":   canonicalIDFor(moduleID, "asset", a.ManifestID),
			"manifest_id":    a.ManifestID,
			"name":           a.Name,
			"description":    a.Description,
			"manifest_path":  a.ManifestPath,
			"repository_key": a.RepositoryKey,
			"kind":           a.Kind,
			"content_type":   a.ContentType,
			"created_by_ref": a.CreatedByRef,
		}
		if pk := projectionKeyFor(a.CreatedByType, a.CreatedByRef, "asset", a.ManifestID); pk != "" {
			row["projection_key"] = pk
		}
		rows = append(rows, row)
	}
	return map[string]any{
		"module_prefix": modulePrefix,
		"assets":        rows,
	}
}

// buildWorkflowChangeData produces the snake_case payload for the
// `db.workflow.{created,updated}.{appId}` outbox events. Mirrors the
// trigger / action builders above so every webhook the UI receives uses
// the same casing convention. Emits `projection_key` only for
// MODULE-owned rows so user-authored workflows project as themselves
// (no synthetic key).
//
// The deleted event is built inline (it carries only id + projectionKey,
// not the full row) — see workflow_service.DeleteWorkflow.
func buildWorkflowChangeData(wf *models.WorkflowDefinition) map[string]any {
	row := map[string]any{
		"id":              wf.ID.String(),
		"application_id":  wf.ApplicationID.String(),
		"name":            wf.Name,
		"enabled":         wf.Enabled,
		"steps_json":      wf.Steps,
		"trigger_json":    wf.Trigger,
		"created_by_type": wf.CreatedByType,
		"created_by_ref":  wf.CreatedByRef,
		"manifest_id":     wf.ManifestID,
	}
	if pk := projectionKeyFor(wf.CreatedByType, wf.CreatedByRef, "workflow", wf.ManifestID); pk != "" {
		row["projection_key"] = pk
	}
	return row
}

// buildFunctionDeregisteredData mirrors the trigger helper for functions.
// Functions live under a parent Module row; canonical id is derived from
// the parent module's `module_key` (first segment) plus the function
// row's `manifest_id`.
func buildFunctionDeregisteredData(moduleKey, moduleName, version string, functions []models.ModuleFunction) map[string]any {
	moduleID := moduleIDFromCreatedByRef(moduleKey)
	rows := make([]map[string]any, 0, len(functions))
	for _, f := range functions {
		row := map[string]any{
			"id":           f.ID.String(),
			"canonical_id": canonicalIDFor(moduleID, "function", f.ManifestID),
			"manifest_id":  f.ManifestID,
			"name":         f.Name,
			"file_name":    f.FileName,
			"entry_point":  f.EntryPoint,
			"runtime":      f.Runtime,
		}
		if moduleKey != "" && f.ManifestID != "" {
			row["projection_key"] = moduleKey + ":function:" + f.ManifestID
		}
		rows = append(rows, row)
	}
	return map[string]any{
		"module_key":  moduleKey,
		"module_name": moduleName,
		"version":     version,
		"functions":   rows,
	}
}
