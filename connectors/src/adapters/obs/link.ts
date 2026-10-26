// When the OBS adapter runs. OBS has no account to link and no enabled
// setting: what makes OBS wanted is a module that controls it. Without one,
// and without WOOFX3_OBS_HOST pointing the engine at an OBS, the adapter
// stays stopped and dials nothing.

import type { InstalledModule, LinkReader, LinkReading } from "../../host/link-readers";

/** The manifest permission that lets a module's code change OBS. Must match OBS_CONTROL in barkloader/lib_sandbox/src/permissions.rs. */
export const OBS_CONTROL_PERMISSION = "obs.control";

/**
 * db-proxy's outbox announces a finished install (an upgrade included) and a
 * finished removal here (db/app/services/module_service.go,
 * CompleteModuleInstall and CompleteModuleDelete). Switching a module on or
 * off announces nothing, so that change is picked up by the backstop pass.
 */
export const MODULE_INSTALLED_SUBJECT = "db.module.installed.*";
export const MODULE_DELETED_SUBJECT = "db.module.deleted.*";

export interface ObsLinkConfig {
  /** WOOFX3_OBS_HOST holds a value: OBS runs whatever is installed. */
  hostExplicit: boolean;
}

/**
 * - connected: an installed module declares `obs.control`, or the host is set
 *   explicitly.
 * - enabled: one such module is active, or the host is set explicitly.
 *
 * A module whose stored manifest cannot be read is left out and named in
 * `ignored`, so one bad row neither starts nor stops OBS.
 */
export function obsLinkReader(config: ObsLinkConfig): LinkReader {
  return {
    watches: [],
    events: [MODULE_INSTALLED_SUBJECT, MODULE_DELETED_SUBJECT],
    async read(store): Promise<LinkReading> {
      if (config.hostExplicit) {
        return { connected: true, enabled: true, flag: null, ignored: [] };
      }
      const ignored: string[] = [];
      let connected = false;
      let enabled = false;
      for (const module of await store.installedModules()) {
        const permissions = manifestPermissions(module);
        if (permissions === undefined) {
          ignored.push(
            `module "${module.moduleId}": its stored manifest is not readable; it does not count as an OBS module`
          );
          continue;
        }
        if (!permissions.includes(OBS_CONTROL_PERMISSION)) {
          continue;
        }
        connected = true;
        enabled ||= !module.disabled;
      }
      return { connected, enabled, flag: null, ignored };
    },
  };
}

/** The manifest's declared permissions; an absent list is none. Undefined when the manifest is not a readable object. */
function manifestPermissions(module: InstalledModule): readonly string[] | undefined {
  let manifest: unknown;
  try {
    manifest = JSON.parse(module.manifest);
  } catch {
    // Unreadable is an answer here; the caller reports it.
    return undefined;
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return undefined;
  }
  const permissions = (manifest as { permissions?: unknown }).permissions;
  if (permissions === undefined) {
    return [];
  }
  if (!Array.isArray(permissions) || !permissions.every((permission) => typeof permission === "string")) {
    return undefined;
  }
  return permissions;
}
