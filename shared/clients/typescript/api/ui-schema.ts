// UI-facing schema types — how the engine's opaque configSchema /
// paramsSchema strings get interpreted for rendering by the workflow
// builder (and any other consumer that wants to show trigger / action
// configuration forms).
//
// Contract: the engine forwards configSchema / paramsSchema as JSON
// strings. When parsed, a well-formed configSchema is either:
//   - An array of ConfigField objects (treated as `fields`), or
//   - An object with { fields?, allowVariants?, color?, icon? }, optionally
//     nested under a `ui` key for backward compatibility.
//
// Consumers are free to fall back to defaults when fields are missing —
// the engine treats presentation as opaque.

import type { ConditionOperator } from "./workflow-definition";

export type ConfigFieldType =
  | "number"
  | "range"
  | "text"
  | "select"
  | "media"
  | "toggle"
  | "boolean"
  | "color"
  | "asset"
  | "resource_ref";

export interface ConfigFieldOption {
  value: string;
  label: string;
}

export interface InternalConfigFieldSource {
  kind: "internal";
  request: {
    event: string;
    payload?: Record<string, unknown>;
  };
  timeoutMs?: number;
}

export type ConfigFieldSource = { kind: "commands" } | InternalConfigFieldSource;

export interface ConfigField {
  id: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  placeholder?: string;
  unit?: string;
  options?: ConfigFieldOption[];
  source?: ConfigFieldSource;
  min?: number;
  max?: number;
  defaultValue?: unknown;
  mediaType?: "image" | "audio" | "video";
  /** For `type: "asset"` — filter by ManifestAsset.kind */
  kinds?: string[];
  /** For `type: "resource_ref"` — manifest `kind` property */
  resourceKind?: string;
  eventPath?: string;
  operator?: ConditionOperator;
  description?: string;
  hint?: string;
  dataSchema?: string;
}

export interface TriggerConfig {
  fields: ConfigField[];
  allowVariants?: boolean;
}

// ---------------------------------------------------------------------------
// Data schemas — what an event payload or an action result actually contains.
//
// A ConfigField describes a *form control*; a DataSchemaField describes a
// *value that exists at runtime*. They are not the same thing, which is why
// this is a separate shape rather than more ConfigFields:
//
//   - A trigger's configFields only become variables when they carry an
//     `eventPath`, so a trigger that emits payload keys it does not also
//     expose as config fields cannot advertise them at all.
//   - An action's outputSchema is the closest thing to a declared result
//     shape, but it is ConfigField-shaped, so it inherits form vocabulary
//     (`label`, `placeholder`, `options`) that means nothing for a value.
//
// Deliberately a flat list of path strings rather than full JSON Schema: it
// matches `${trigger.data.X}` / `${tasks.<id>.<key>}` access exactly, and is
// trivial to render in a variable picker. Nothing validates a payload against
// it — this is discovery, not enforcement.
// ---------------------------------------------------------------------------

export type DataSchemaFieldType = "string" | "number" | "boolean" | "array" | "object" | "unknown";

export interface DataSchemaField {
  /** Dot path into the value, e.g. `"user_name"` or `"channel.title"`. */
  path: string;
  type: DataSchemaFieldType;
  description?: string;
  example?: unknown;
}

export interface DataSchema {
  fields: DataSchemaField[];
}

/**
 * Parse a `payloadSchema` / `outputSchema` JSON string into a DataSchema.
 *
 * Returns undefined for anything that does not carry a `fields` array —
 * absent, empty, malformed, or the ConfigField[] array that `outputSchema`
 * has always held. Undefined means "nothing declared here", and callers fall
 * back to deriving variables from configFields / outputFields exactly as they
 * do today, so a module that never migrates keeps working unchanged.
 *
 * Consumers pass engine-provided strings straight in; a module author's typo
 * must not throw in a variable picker.
 */
export function parseDataSchema(raw: string | undefined | null): DataSchema | undefined {
  if (!raw) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const fields = (parsed as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) {
    return undefined;
  }
  const valid = fields.filter(
    (field): field is DataSchemaField =>
      typeof field === "object" &&
      field !== null &&
      typeof (field as DataSchemaField).path === "string" &&
      (field as DataSchemaField).path.length > 0
  );
  return valid.length > 0 ? { fields: valid } : undefined;
}

export interface ActionConfig {
  fields: ConfigField[];
}
