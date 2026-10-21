import type { SharedLogger } from "@woofx3/common/logging";

/** A declaration that carries a form: a trigger, action, widget or resource kind. */
export interface ManifestDeclaration {
  id: string;
  /** The declaration's form entries (`schema`, or `settingsSchema` for a widget), left untyped: field shapes belong to their readers. */
  fields: unknown[];
}

export interface ManifestResource {
  kind: string;
  name: string;
  description: string;
  icon?: string;
  summaryPath?: string;
  schema: unknown[];
}

/**
 * What api reads from a module manifest as barkloader stored it at install.
 * Barkloader validated the manifest then, so the parser is lenient about what
 * a manifest from an older engine never declared and logs what it has to drop.
 */
export interface StoredManifest {
  id: string;
  permissions: string[];
  settings: unknown[];
  resources: ManifestResource[];
  triggers: ManifestDeclaration[];
  actions: Array<ManifestDeclaration & { systemOnly: boolean }>;
  widgets: ManifestDeclaration[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Entries of `manifest[key]` as records. An entry that is not an object, or
 * whose identifying field is missing, is logged and left out.
 */
function entriesOf(
  manifest: Record<string, unknown>,
  key: string,
  idField: string,
  logger: SharedLogger,
  moduleName: string
): Array<{ id: string; entry: Record<string, unknown> }> {
  const out: Array<{ id: string; entry: Record<string, unknown> }> = [];
  asList(manifest[key]).forEach((raw, index) => {
    const entry = asRecord(raw);
    const id = entry ? asString(entry[idField]) : "";
    if (!entry || id === "") {
      logger.warn("stored manifest entry has no usable identifier; it is left out", {
        module: moduleName,
        list: key,
        index,
        identifier: idField,
      });
      return;
    }
    out.push({ id, entry });
  });
  return out;
}

/** A parsed manifest value (any JSON) as a StoredManifest. Anything but an object reads as an empty manifest. */
export function parseStoredManifest(value: unknown, logger: SharedLogger, moduleName: string): StoredManifest {
  const manifest = asRecord(value);
  if (!manifest) {
    logger.warn("stored manifest is not an object; it declares nothing", { module: moduleName });
    return { id: "", permissions: [], settings: [], resources: [], triggers: [], actions: [], widgets: [] };
  }
  const declarations = (key: string, idField: string, fieldsKey: string): ManifestDeclaration[] =>
    entriesOf(manifest, key, idField, logger, moduleName).map(({ id, entry }) => ({
      id,
      fields: asList(entry[fieldsKey]),
    }));

  const permissions = asList(manifest.permissions).filter((p): p is string => typeof p === "string" && p !== "");
  return {
    id: asString(manifest.id),
    permissions: [...new Set(permissions)].sort(),
    settings: asList(manifest.settings),
    resources: entriesOf(manifest, "resources", "kind", logger, moduleName).map(({ id, entry }) => {
      const icon = asString(entry.icon);
      const summaryPath = asString(asRecord(entry.display)?.summary);
      return {
        kind: id,
        name: asString(entry.name),
        description: asString(entry.description),
        ...(icon ? { icon } : {}),
        ...(summaryPath ? { summaryPath } : {}),
        schema: asList(entry.schema),
      };
    }),
    triggers: declarations("triggers", "id", "schema"),
    actions: entriesOf(manifest, "actions", "id", logger, moduleName).map(({ id, entry }) => ({
      id,
      fields: asList(entry.schema),
      systemOnly: entry.systemOnly === true,
    })),
    widgets: declarations("widgets", "id", "settingsSchema"),
  };
}

/**
 * A module row's stored manifest text as a StoredManifest, or null when the
 * row has none or it does not parse (logged).
 */
export function parseStoredManifestJson(
  raw: string | undefined,
  logger: SharedLogger,
  moduleName: string
): StoredManifest | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn("stored manifest does not parse; its declarations are left out", {
      module: moduleName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  return parseStoredManifest(parsed, logger, moduleName);
}
