import {
  RELAY_CONFIG_SETTING,
  readStoredRelayConfig,
  type StoredRelayConfig,
} from "@woofx3/common/cloudevents/Relay/relay";
import { GetModuleByModuleId } from "@woofx3/db/module.pb";
import { GetModuleSecretValues, ListModuleSettings } from "@woofx3/db/module_setting.pb";
import { GetSetting } from "@woofx3/db/setting.pb";
import type { DbProxyClientConfig } from "../services/db-proxy";

/** One stored module setting. A secret setting's value is always empty here; see `moduleSecrets`. */
export interface StoredModuleSetting {
  key: string;
  value: string;
}

/**
 * The stored records a local endpoint's route is read from: the module's
 * manifest (its `local[]` entry), its settings and secrets, and the relay
 * configuration. Read afresh on every connect attempt, never cached, so a
 * retry picks up a change whose announcement was missed.
 */
export interface EndpointStore {
  /** The installed module's manifest as barkloader stored it, or null when there is none. */
  moduleManifest(moduleId: string): Promise<string | null>;
  moduleSettings(moduleId: string): Promise<StoredModuleSetting[]>;
  /** Opens the module's secret settings. The values are never logged or forwarded. */
  moduleSecrets(moduleId: string): Promise<Record<string, string>>;
  /** The stored `relay.config`, or null when nothing is routed through a companion. */
  relayConfig(): Promise<StoredRelayConfig | null>;
}

/** The endpoint store over db-proxy. Every call carries the client's service token and timeout. */
export function dbProxyEndpointStore(client: DbProxyClientConfig): EndpointStore {
  return {
    moduleManifest: (moduleId) =>
      call("GetModuleByModuleId", async () => {
        const response = await GetModuleByModuleId({ moduleId }, client);
        // db-proxy answers an unknown module with an empty one.
        return response.module?.manifest || null;
      }),
    moduleSettings: (moduleId) =>
      call("ListModuleSettings", async () => {
        const response = await ListModuleSettings({ moduleId }, client);
        return response.settings.map((setting) => ({ key: setting.key, value: setting.value }));
      }),
    moduleSecrets: (moduleId) =>
      call("GetModuleSecretValues", async () => {
        const response = await GetModuleSecretValues({ moduleId }, client);
        const values: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.values)) {
          if (value !== undefined) {
            values[key] = value;
          }
        }
        return values;
      }),
    relayConfig: () =>
      call("GetSetting", async () => {
        const response = await GetSetting({ key: RELAY_CONFIG_SETTING }, client);
        return readStoredRelayConfig(response.setting?.value?.stringValue ?? null);
      }),
  };
}

/**
 * Runs one db-proxy call, rethrowing a failure as an Error naming the call.
 * twirpscript rejects with a plain `{code, msg}` object, which would read as
 * "[object Object]" in a log line.
 */
async function call<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new Error(`db-proxy ${operation}: ${describeFailure(error)}`);
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const { code, msg } = error as { code?: unknown; msg?: unknown };
    const parts = [code, msg].filter((part): part is string => typeof part === "string" && part !== "");
    if (parts.length > 0) {
      return parts.join(": ");
    }
  }
  return String(error);
}
