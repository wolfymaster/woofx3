// The one field-declaration vocabulary.
//
// A trigger's `schema`, an action's `schema`, a widget's `settingsSchema` and
// a module's `settings` all mean the same thing: "render these inputs, collect
// these values". They are therefore the same shape — a bare array of
// ConfigField — and there is exactly one spelling for every property.
//
// This was not always true. The four surfaces grew independently and diverged
// on every core property (`id`/`key`, `type`/`fieldType`, `label`/`name`,
// `defaultValue`/`default`), and the trigger/action parser accreted four
// accepted container shapes, three of which were never produced by anything.
// The cost was not theoretical: a widget declaring `{fields:[...]}` — the
// shape its author had learned from trigger schemas — silently rendered no
// settings at all.
//
// So there are no aliases here on purpose. An alias layer is what let those
// shapes coexist unnoticed; barkloader rejects anything else at install, which
// keeps this the only shape any consumer has to handle.
//
// What differs per surface is where the *value* is stored — module settings
// persist engine-side in `module_settings` and are read by sandboxed
// functions; trigger, action and widget values live UI-side in workflow
// definitions and scene instances. That difference is real and stays. It is
// not a reason to describe a field differently.

import type { ConditionOperator } from "./workflow-definition";

/**
 * Every accepted `type` token, in one place so the engine, the SDK and the
 * docs cannot drift. Closed: an unrecognised token is an author mistake worth
 * reporting, not an extension point.
 *
 * `text` and `toggle` are the spellings — not `string` and `boolean`, which
 * described the stored value rather than the control and only ever appeared on
 * module settings.
 */
export const CONFIG_FIELD_TYPES = [
  "number",
  "range",
  "text",
  "select",
  "media",
  "toggle",
  "color",
  "asset",
  "resource_ref",
  "button",
] as const;

export type ConfigFieldType = (typeof CONFIG_FIELD_TYPES)[number];

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
  /** Stable field id; the key the collected value is stored under. */
  id: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  placeholder?: string;
  unit?: string;
  /** Required for `type: "select"` — a select with nothing to select is a dead control. */
  options?: ConfigFieldOption[];
  source?: ConfigFieldSource;
  min?: number;
  max?: number;
  defaultValue?: unknown;
  mediaType?: "image" | "audio" | "video";
  /** For `type: "asset"` — filter the picker by `ManifestAsset.kind`. */
  kinds?: string[];
  /** Required for `type: "resource_ref"` — which resource kind the picker lists. */
  resourceKind?: string;
  /**
   * Present only on `type: "button"`, which collects no value and instead
   * fires a request: `{ kind: "internal", request: {...}, timeoutMs? }` or
   * `{ kind: "integration", integration: "..." }`. Opaque here and forwarded
   * for the consumer to interpret.
   */
  action?: unknown;
  /** Trigger config only — binds this field to a path in the event payload. */
  eventPath?: string;
  /** Trigger config only — the comparison emitted with this field's value. */
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
   *
   * Renamed from `dataSchema`, which was wrong twice over: it holds an example
   * rather than a schema, and the old name grouped it with `configSchema` /
   * `paramsSchema`, which describe forms.
   */
  examplePayload?: string;
}

function isConfigFieldType(raw: unknown): raw is ConfigFieldType {
  return typeof raw === "string" && (CONFIG_FIELD_TYPES as readonly string[]).includes(raw);
}

/**
 * Parse a stored field-declaration JSON string into ConfigFields.
 *
 * Barkloader validates these at install, so anything stored should already be
 * well-formed; this stays defensive because a config form must render rather
 * than throw. An entry missing `id`, `label` or a recognised `type` is dropped
 * rather than repaired — a half-built control is worse than an absent one.
 *
 * Accepts only a bare array. An object is not unwrapped: `{fields:[...]}` and
 * friends were exactly the ambiguity this contract removes, and silently
 * accepting them again would let the divergence back in through the consumer.
 */
export function parseFieldList(raw: string | undefined | null): ConfigField[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const fields: ConfigField[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const candidate = entry as Partial<ConfigField>;
    if (
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      typeof candidate.label !== "string" ||
      !isConfigFieldType(candidate.type)
    ) {
      continue;
    }
    fields.push(candidate as ConfigField);
  }
  return fields;
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
