/**
 * Readers for a module manifest's declarations, as `getModuleManifest`
 * answers it (the manifest barkloader stored at install) or as a module
 * archive carries it. The manifest format is barkloader's
 * (docs/barkloader/modules.md); these read the parts a client shows about a
 * module before or after it is installed.
 *
 * Every reader takes the manifest as `unknown` and is lenient: a missing or
 * malformed list declares nothing, an empty string counts as absent, and an
 * entry without its identifying field is skipped. A stored manifest passed
 * barkloader's validation at install, so leniency only matters for an
 * archive not yet installed, where barkloader refuses the whole install over
 * an invalid entry anyway.
 */

import type { ManifestResourceKind, MarketplaceLocalEndpoint } from "./api";
import { type ConfigField, LIST_ITEM_FIELD_TYPES, parseFieldEntries } from "./ui-schema";

export type { ManifestResourceKind } from "./api";

/**
 * The permission ids the manifest declares (`permissions[]`), in declaration
 * order and without duplicates. The engine enforces them; a client shows them
 * for the streamer to approve.
 */
export function manifestPermissions(manifest: unknown): string[] {
  const seen = new Set<string>();
  for (const entry of listOf(recordOf(manifest)?.permissions)) {
    if (typeof entry === "string" && entry !== "") {
      seen.add(entry);
    }
  }
  return [...seen];
}

/**
 * The manifest's `local[]` endpoints that name an id, the first of each id.
 * Deliberately not filtered down to the entries barkloader's `validate_local`
 * accepts: barkloader refuses the whole install over an invalid entry, so
 * counting one here can only ask for an approval the install would not have
 * needed, never skip one it did. This makes it a reader for counting what
 * needs approval, not a validator: a client that shows only the endpoints an
 * install would accept, or needs each endpoint's settings and discovery,
 * applies barkloader's rules itself.
 */
export function manifestLocalEndpoints(manifest: unknown): MarketplaceLocalEndpoint[] {
  const endpoints: MarketplaceLocalEndpoint[] = [];
  const seen = new Set<string>();
  for (const entry of listOf(recordOf(manifest)?.local)) {
    const raw = recordOf(entry);
    if (!raw || typeof raw.id !== "string" || raw.id === "" || seen.has(raw.id)) {
      continue;
    }
    seen.add(raw.id);
    endpoints.push({
      id: raw.id,
      name: typeof raw.name === "string" ? raw.name.trim() : raw.id,
      protocol: typeof raw.protocol === "string" ? raw.protocol : "",
    });
  }
  return endpoints;
}

/** One `resources[]` entry as a kind; null for an entry that names no kind. */
export function manifestResourceKindOf(entry: unknown): ManifestResourceKind | null {
  const raw = recordOf(entry);
  const kind = textOf(raw?.kind);
  if (!raw || kind === "") {
    return null;
  }
  const icon = textOf(raw.icon);
  const summaryPath = textOf(recordOf(raw.display)?.summary);
  return {
    kind,
    name: textOf(raw.name),
    description: textOf(raw.description),
    ...(icon ? { icon } : {}),
    ...(summaryPath ? { summaryPath } : {}),
    schema: listOf(raw.schema),
  };
}

/** The resource kinds the manifest declares, in declaration order. */
export function manifestResourceKinds(manifest: unknown): ManifestResourceKind[] {
  return listOf(recordOf(manifest)?.resources).flatMap((entry) => {
    const kind = manifestResourceKindOf(entry);
    return kind ? [kind] : [];
  });
}

/** The ids of the manifest's OAuth integrations (`oauth[]`), the only integrations a settings button can connect. */
export function manifestOAuthIntegrationIds(manifest: unknown): string[] {
  return listOf(recordOf(manifest)?.oauth).flatMap((entry) => {
    const id = textOf(recordOf(entry)?.id);
    return id ? [id] : [];
  });
}

/** What a `button` setting does when pressed. */
export type ManifestSettingAction =
  /** Sends the module an engine request and waits up to `timeoutMs` for its answer. */
  | { kind: "internal"; request: { event: string; payload?: Record<string, unknown> }; timeoutMs?: number }
  /**
   * Connects an OAuth integration. `declared` says whether the manifest
   * declares `integration` under `oauth[]`: one it does not cannot be connected.
   */
  | { kind: "integration"; integration: string; declared: boolean };

/** A module-level setting the manifest declares (`settings[]`). */
export interface ManifestSettingField {
  id: string;
  label: string;
  description: string;
  /** The control type; `string` when the manifest names none. */
  type: string;
  required: boolean;
  /** The default as text, whatever JSON type the manifest wrote it as. */
  defaultValue?: string;
  /** Present only on a `button` whose `action` is one of the shapes above. */
  action?: ManifestSettingAction;
  /** Present only on a `resource_ref`: the kind of instance it links. */
  resourceKind?: string;
  /**
   * Present only on a `list`: the fields of one row. The value is stored as a
   * JSON array of objects keyed by these fields' ids.
   */
  itemFields?: ConfigField[];
}

/**
 * The module-level settings the manifest declares, in declaration order. A
 * setting without an id is skipped, and so is a `list` whose rows hold no
 * field a list row can render, since it would be a half-built control.
 */
export function manifestSettings(manifest: unknown): ManifestSettingField[] {
  const oauthIntegrations = manifestOAuthIntegrationIds(manifest);
  return listOf(recordOf(manifest)?.settings).flatMap((entry): ManifestSettingField[] => {
    const raw = recordOf(entry) ?? {};
    const id = textOf(raw.id);
    if (id === "") {
      return [];
    }
    const type = typeof raw.type === "string" ? raw.type : "string";
    const itemFields = type === "list" ? listItemFields(raw.itemFields) : [];
    if (type === "list" && itemFields.length === 0) {
      return [];
    }
    const action = settingActionOf(raw.action, oauthIntegrations);
    const resourceKind = textOf(raw.resourceKind);
    return [
      {
        id,
        label: textOf(raw.label),
        description: textOf(raw.description),
        type,
        required: raw.required === true,
        ...(raw.defaultValue !== undefined ? { defaultValue: String(raw.defaultValue) } : {}),
        ...(action ? { action } : {}),
        ...(resourceKind ? { resourceKind } : {}),
        ...(type === "list" ? { itemFields } : {}),
      },
    ];
  });
}

/** A function the manifest declares (`functions[]`). */
export interface ManifestFunction {
  id: string;
  name?: string;
  /** The module-relative file path (`functions/battle.js`); the engine's registration keeps only a file name. */
  path?: string;
  entryPoint?: string;
  runtime?: string;
}

/** The functions the manifest declares, in declaration order; an entry without an id is skipped. */
export function manifestFunctions(manifest: unknown): ManifestFunction[] {
  return listOf(recordOf(manifest)?.functions).flatMap((entry): ManifestFunction[] => {
    const raw = recordOf(entry);
    const id = nonBlank(raw?.id);
    if (!raw || !id) {
      return [];
    }
    const fn: ManifestFunction = { id };
    const name = nonBlank(raw.name);
    const path = nonBlank(raw.path);
    const entryPoint = nonBlank(raw.entryPoint);
    const runtime = nonBlank(raw.runtime);
    if (name) {
      fn.name = name;
    }
    if (path) {
      fn.path = path;
    }
    if (entryPoint) {
      fn.entryPoint = entryPoint;
    }
    if (runtime) {
      fn.runtime = runtime;
    }
    return [fn];
  });
}

/** A string with something other than whitespace in it, or undefined. */
function nonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function listItemFields(raw: unknown): ConfigField[] {
  return parseFieldEntries(listOf(raw)).filter((field) =>
    (LIST_ITEM_FIELD_TYPES as readonly string[]).includes(field.type)
  );
}

function settingActionOf(value: unknown, oauthIntegrations: readonly string[]): ManifestSettingAction | undefined {
  const raw = recordOf(value);
  if (!raw) {
    return undefined;
  }
  if (raw.kind === "integration" && typeof raw.integration === "string") {
    return { kind: "integration", integration: raw.integration, declared: oauthIntegrations.includes(raw.integration) };
  }
  const request = recordOf(raw.request);
  if (raw.kind !== "internal" || !request || typeof request.event !== "string") {
    return undefined;
  }
  const payload = recordOf(request.payload);
  return {
    kind: "internal",
    request: { event: request.event, ...(payload ? { payload } : {}) },
    ...(typeof raw.timeoutMs === "number" ? { timeoutMs: raw.timeoutMs } : {}),
  };
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}
