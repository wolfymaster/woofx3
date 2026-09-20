import type { SharedLogger } from "@woofx3/common/logging";
import type { DbClient } from "./db-client";

export interface EngineModule {
  name: string;
  version: string;
  state: string;
  /**
   * Install provenance. `"SYSTEM"` marks a module that ships with the engine:
   * it appears in the installed list — an operator should see what is
   * installed and at what version — but cannot be uninstalled, so the UI
   * should render the control as unavailable rather than let the attempt fail.
   */
  createdByType: string;
  /**
   * Manifest-local module id (`woofx3`, `woofx3_twitch`), the first segment of
   * every canonical id this module owns. Distinct from the display `name`.
   */
  moduleId: string;
  /** Composite `{moduleId}:{version}:{sha7}` the module was installed under. */
  moduleKey: string;
  /**
   * The installed manifest, parsed. Null when the row stores no manifest or
   * stores one that does not parse — a caller mirroring the catalog records
   * the module either way rather than dropping it.
   *
   * Carried here because a manifest's `resources[]` is the only declaration of
   * the resource kinds a module provides, and the `module.installed` webhook
   * has no manifest field. A consumer that never sees this sees no kinds.
   */
  manifest: Record<string, unknown> | null;
}

function parseManifest(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The installed modules the engine knows about, in the shape callers want
 * rather than the raw catalog rows.
 *
 * A module rather than a route method because two callers need it: the
 * `listEngineModules` RPC and the dashboard stats. The dashboard previously
 * reached it through `this`, which coupled the two route modules with no
 * import edge -- invisible to the module graph and to anyone reading either
 * file.
 */
export async function listEngineModules(db: DbClient, logger: SharedLogger): Promise<EngineModule[]> {
  logger.info("Listing engine modules");
  const modules = await db.listModules();
  const result = modules
    .filter((m) => !!m.name)
    .map((m) => ({
      name: m.name,
      version: m.version ?? "",
      state: m.state ?? "active",
      createdByType: m.createdByType ?? "USER",
      moduleId: m.moduleId ?? "",
      moduleKey: m.moduleKey ?? "",
      manifest: parseManifest(m.manifest),
    }));
  logger.info("Listed engine modules", { count: result.length });
  return result;
}
