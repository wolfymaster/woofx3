import { GetSetting } from "@woofx3/db/setting.pb";
import type { DbProxyClientConfig } from "../services/db-proxy";
import type { SettingsReader } from "./link-readers";

/** Reads engine settings from db-proxy. db-proxy answers a missing key with an empty setting. */
export function dbProxySettings(client: DbProxyClientConfig): SettingsReader {
  return {
    async getSetting(key) {
      const response = await GetSetting({ key }, client);
      return response.setting?.value?.stringValue ?? null;
    },
  };
}
