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
  /**
   * A JSON-encoded **example** of the event payload this field reads from,
   * rendered with syntax highlighting in the field's info popover so a user
   * authoring a path-style input can see what the data looks like.
   *
   * It is an illustration, not a declaration: nothing reads its keys, and it
   * may be partial or elided. The machine-readable answer to "which paths
   * exist" is the trigger's `emits` / the action's `returns` (see `DataShape`).
   */
  examplePayload?: string;
  /**
   * @deprecated Renamed to `examplePayload`. It was never a schema — it holds
   * an example payload, and the name put it in the same bucket as
   * `configSchema` / `paramsSchema`, which describe forms, and one capital
   * letter from `DataShape`, which describes a value.
   *
   * Still read so manifests and stored rows written before the rename keep
   * working. Consumers should prefer `examplePayload` and fall back to this;
   * new manifests should not set it.
   */
  dataSchema?: string;
}

/**
 * The example payload to render for a config field, preferring the current
 * name and falling back to the pre-rename one.
 *
 * Exists so each consumer does not re-derive the fallback and quietly disagree
 * about precedence. A field carrying both is taking the new name at its word.
 */
export function configFieldExamplePayload(field: ConfigField): string | undefined {
  return field.examplePayload ?? field.dataSchema;
}

export interface TriggerConfig {
  fields: ConfigField[];
  allowVariants?: boolean;
}

// ---------------------------------------------------------------------------
// Data shapes — what an event payload or an action result actually carries.
//
// Note the word: this is not a schema, and nothing is ever validated against
// it. It answers one question — "which paths can a workflow reference?" — for
// the variable picker. Calling it a schema would promise enforcement the
// engine does not perform, and would put it in the same bucket as
// configSchema / paramsSchema / settingsSchema, which are something else
// entirely: definitions of a form a user fills in.
//
// A ConfigField describes a form control; a DataShapeField describes a value
// that exists at runtime. Keeping them apart is the point:
//
//   - A trigger's configFields only become variables when they carry an
//     `eventPath`, so a trigger that emits payload keys it does not also
//     expose as config fields cannot advertise them at all.
//   - An action's result had no declaration that was not form-shaped, so it
//     inherited `label`, `placeholder` and `options` — vocabulary that means
//     nothing for a returned value — and could express neither a nested path
//     nor an example.
//
// Deliberately a flat list of path strings rather than full JSON Schema: it
// matches `${trigger.data.X}` / `${tasks.<id>.<key>}` access exactly, and is
// trivial to render.
// ---------------------------------------------------------------------------

export type DataShapeFieldType = "string" | "number" | "boolean" | "array" | "object" | "unknown";

export interface DataShapeField {
  /** Dot path into the value, e.g. `"user_name"` or `"channel.title"`. */
  path: string;
  type: DataShapeFieldType;
  description?: string;
  example?: unknown;
}

export interface DataShape {
  fields: DataShapeField[];
}

/**
 * Parse a trigger's `emits` / an action's `returns` JSON string.
 *
 * Returns undefined for anything without a usable `fields` array — absent,
 * empty, or malformed. Undefined means "declared nothing", and callers fall
 * back to deriving variables from configFields exactly as they do today, so a
 * module that never declares a shape keeps working unchanged.
 *
 * Barkloader rejects a malformed shape at install time, so a stored value
 * should always be well-formed. This stays defensive anyway: it also parses
 * rows written before that validation existed, and a variable picker must
 * never throw.
 */
export function parseDataShape(raw: string | undefined | null): DataShape | undefined {
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
    (field): field is DataShapeField =>
      typeof field === "object" &&
      field !== null &&
      typeof (field as DataShapeField).path === "string" &&
      (field as DataShapeField).path.length > 0
  );
  return valid.length > 0 ? { fields: valid } : undefined;
}
