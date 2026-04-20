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

export interface ConfigField {
  id: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  placeholder?: string;
  unit?: string;
  options?: ConfigFieldOption[];
  min?: number;
  max?: number;
  defaultValue?: unknown;
  mediaType?: "image" | "audio" | "video";
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
