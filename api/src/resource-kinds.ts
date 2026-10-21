import type { DeclaredResourceKind } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type * as module from "@woofx3/db/module.pb";
import { parseStoredManifestJson, type StoredManifest } from "./stored-manifest";

type InstalledModule = Pick<module.Module, "name" | "moduleId" | "manifest">;

/** The kinds one stored manifest declares in `resources[]`, attributed to `moduleName`. */
export function manifestResourceKinds(moduleName: string, manifest: StoredManifest): DeclaredResourceKind[] {
  return manifest.resources.map((resource) => ({ moduleName, ...resource }));
}

/**
 * Every resource kind the installed modules declare, ordered by module name
 * and then as each manifest lists them. A module is named by its manifest
 * `id`, the first segment of its instances' canonical ids. A stored manifest
 * that does not parse contributes no kinds and is logged: one broken row
 * should not hide every other module's kinds.
 */
export function declaredResourceKinds(modules: InstalledModule[], logger: SharedLogger): DeclaredResourceKind[] {
  const declarers: Array<{ moduleName: string; manifest: StoredManifest }> = [];
  for (const row of modules) {
    const manifest = parseStoredManifestJson(row.manifest, logger, row.name);
    if (manifest) {
      declarers.push({ moduleName: manifest.id || row.moduleId || row.name, manifest });
    }
  }
  declarers.sort((a, b) => (a.moduleName < b.moduleName ? -1 : a.moduleName > b.moduleName ? 1 : 0));
  return declarers.flatMap(({ moduleName, manifest }) => manifestResourceKinds(moduleName, manifest));
}
