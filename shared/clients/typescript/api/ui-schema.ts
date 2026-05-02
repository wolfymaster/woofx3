// UI-facing schema types — how the engine's opaque configSchema /
// paramsSchema strings get interpreted for rendering by the workflow
// builder (and any other consumer that wants to show trigger / action
// configuration forms).
//
// Contract: the engine forwards configSchema / paramsSchema as JSON
// strings. When parsed, a well-formed configSchema is either:
//   - An array of ConfigField objects (treated as `fields`), or
//   - An object with { fields?, supportsTiers?, tierLabel? } (a full
//     TriggerConfig), optionally nested under a `ui` key for backward
//     compatibility.
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
  | "toggle";

export interface ConfigFieldOption {
  value: string;
  label: string;
}

/**
 * Dynamic source for `select` fields whose options the UI must fetch at
 * render time (not known at manifest/registration time). When both `source`
 * and static `options` are present, the UI's configuration form prefers
 * `source`. Currently only the `commands` kind is recognized; future
 * additions follow the same discriminated-union pattern.
 */
export type ConfigFieldSource =
  | { kind: "commands" };

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
  /**
   * Dot path into the event data that this field filters on. Defaults to
   * `id` when unset. Used by the workflow builder to translate the user's
   * configured value into a canonical condition like
   * `{ field: "${trigger.data.<eventPath>}", operator, value }`.
   *
   * Needed when the UI field name differs from the event payload key — e.g.
   * a field labeled "Minimum bits" with id `minBits` targeting `bits`.
   */
  eventPath?: string;
  /**
   * Comparison operator used when emitting the condition. Defaults to `"eq"`
   * when unset. Range-typed values with `type: "range"` always emit
   * `"between"` regardless of this hint, since the value shape requires it.
   */
  operator?: ConditionOperator;
  /**
   * Short user-facing prose rendered as muted helper text directly below the
   * input control. Always visible. Use for brief reminders ("max 500 chars",
   * "leave blank for any value"). Optional.
   */
  description?: string;
  /**
   * Longer user-facing prose rendered inside the field's info-icon popover.
   * Use for explanation that doesn't earn permanent screen real estate
   * (which event payload field this maps to, edge cases, etc.). Optional.
   */
  hint?: string;
  /**
   * JSON-encoded example payload documenting the shape of the underlying
   * event or data this field operates on. Rendered with syntax highlighting
   * inside the field's info-icon popover. Stored as a string so the engine
   * can forward it verbatim through configSchema/paramsSchema and so the UI
   * can hand it to a JSON highlighter without re-stringifying. Optional.
   */
  dataSchema?: string;
}

export interface TriggerConfig {
  fields: ConfigField[];
  supportsTiers?: boolean;
  tierLabel?: string;
}

/**
 * Action `paramsSchema` follows the same shape contract as trigger
 * `configSchema` but without trigger-only concerns (tiers, variants). The
 * canonical form for an action is a flat ConfigField[] describing the
 * user-editable inputs; consumers may also accept a `{ fields }` object for
 * forward compatibility.
 */
export interface ActionConfig {
  fields: ConfigField[];
}
