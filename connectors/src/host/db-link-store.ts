import { ListModules } from "@woofx3/db/module.pb";
import { GetSetting } from "@woofx3/db/setting.pb";
import type { DbProxyClientConfig } from "../services/db-proxy";
import type { InstalledModule, LinkStore } from "./link-readers";

/** barkloader's stored state for a module switched off (lib_module registry_loader.rs). */
const DISABLED_MODULE_STATE = "disabled";

/** Reads link records from db-proxy. db-proxy answers a missing setting key with an empty setting. */
export function dbProxyLinkStore(client: DbProxyClientConfig): LinkStore {
  return {
    async getSetting(key) {
      const response = await GetSetting({ key }, client);
      return response.setting?.value?.stringValue ?? null;
    },
    async installedModules() {
      // An empty state lists every module, whatever its state.
      const response = await ListModules({ state: "" }, client);
      return response.modules.map(
        (module): InstalledModule => ({
          moduleId: module.moduleId,
          manifest: module.manifest,
          disabled: module.state === DISABLED_MODULE_STATE,
        })
      );
    },
  };
}
