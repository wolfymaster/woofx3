import type { DeclaredResourceKind } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type * as module from "@woofx3/db/module.pb";

type InstalledModule = Pick<module.Module, "name" | "moduleId" | "manifest">;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The kinds one stored manifest declares in `resources[]`. Barkloader
 * validated the manifest at install, so an entry without a `kind` is not
 * expected; it is dropped rather than listed as a kind nothing can name.
 */
export function manifestResourceKinds(moduleName: string, manifest: unknown): DeclaredResourceKind[] {
  const resources = asRecord(manifest).resources;
  if (!Array.isArray(resources)) {
    return [];
  }
  const kinds: DeclaredResourceKind[] = [];
  for (const raw of resources) {
    const entry = asRecord(raw);
    const kind = asString(entry.kind);
    if (!kind) {
      continue;
    }
    const icon = asString(entry.icon);
    const summaryPath = asString(asRecord(entry.display).summary);
    kinds.push({
      moduleName,
      kind,
      name: asString(entry.name),
      description: asString(entry.description),
      ...(icon ? { icon } : {}),
      schema: Array.isArray(entry.schema) ? entry.schema : [],
      ...(summaryPath ? { summaryPath } : {}),
    });
  }
  return kinds;
}

/**
 * Every resource kind the installed modules declare, ordered by module name
 * and then as each manifest lists them. A module is named by its manifest
 * `id`, the first segment of its instances' canonical ids. A stored manifest
 * that does not parse contributes no kinds and is logged: one broken row
 * should not hide every other module's kinds.
 */
export function declaredResourceKinds(modules: InstalledModule[], logger: SharedLogger): DeclaredResourceKind[] {
  const declarers: Array<{ moduleName: string; manifest: unknown }> = [];
  for (const row of modules) {
    if (!row.manifest) {
      continue;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(row.manifest);
    } catch (err) {
      logger.warn("listResourceKinds: stored manifest does not parse; its kinds are left out", {
        module: row.name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const moduleName = asString(asRecord(manifest).id) || row.moduleId || row.name;
    declarers.push({ moduleName, manifest });
  }
  declarers.sort((a, b) => (a.moduleName < b.moduleName ? -1 : a.moduleName > b.moduleName ? 1 : 0));
  return declarers.flatMap(({ moduleName, manifest }) => manifestResourceKinds(moduleName, manifest));
}
