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

export interface ActionConfig {
  fields: ConfigField[];
}
