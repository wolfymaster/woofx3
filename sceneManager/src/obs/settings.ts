// Where sceneManager connects to OBS. The OBS marketplace module declares the
// connection as its settings, so a streamer enters it on the module's page;
// sceneManager's own configuration fills in whatever the module does not say,
// which keeps an engine without the module connecting as it always has.

import type { Logger } from "@woofx3/common/runtime";

/** The OBS module's manifest id. Must match `id` in woofx3-modules' modules/platform/obs/manifest.json. */
export const OBS_MODULE_ID = "woofx3_obs";

/** Setting ids the OBS module declares. Must match its manifest's `settings`. */
const HOST_SETTING = "host";
const PORT_SETTING = "port";
const PASSWORD_SETTING = "password";

export interface ObsConnectionConfig {
  url: string;
  /** The OBS WebSocket password; absent when OBS has authentication turned off. */
  token?: string;
}

export interface ObsFallback {
  host: string;
  port: string;
  token?: string;
}

export interface ObsSettingsReader {
  listModuleSettings(moduleId: string): Promise<{ key: string; value: string }[]>;
  getModuleSecretValues(moduleId: string): Promise<Record<string, string>>;
}

function validPort(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const port = Number(trimmed);
  return port >= 1 && port <= 65535 ? String(port) : null;
}

/** An IPv6 address goes in brackets in a URL; anything else is used as typed. */
function urlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/**
 * The connection from the module's settings, each falling back to
 * sceneManager's configuration when empty. A port that is not a port falls
 * back too, rather than producing a URL that can never connect.
 */
export function obsConnectionConfig(
  settings: readonly { key: string; value: string }[],
  secrets: Readonly<Record<string, string>>,
  fallback: ObsFallback
): ObsConnectionConfig {
  const settingValue = (key: string) => settings.find((setting) => setting.key === key)?.value.trim() ?? "";
  const host = settingValue(HOST_SETTING) || fallback.host;
  const port = validPort(settingValue(PORT_SETTING)) ?? fallback.port;
  const token = secrets[PASSWORD_SETTING] || fallback.token;
  const config: ObsConnectionConfig = { url: `ws://${urlHost(host)}:${port}` };
  if (token) {
    config.token = token;
  }
  return config;
}

/**
 * Reads the connection for one connect attempt. Settings are read afresh each
 * time, so a retry picks up a change even if its announcement was missed. When
 * db-proxy cannot be read, the configuration is used: OBS control is
 * best-effort and must not stop on a db outage.
 */
export async function readObsConnectionConfig(
  db: ObsSettingsReader,
  fallback: ObsFallback,
  logger: Logger
): Promise<ObsConnectionConfig> {
  try {
    const [settings, secrets] = await Promise.all([
      db.listModuleSettings(OBS_MODULE_ID),
      db.getModuleSecretValues(OBS_MODULE_ID),
    ]);
    return obsConnectionConfig(settings, secrets, fallback);
  } catch (err) {
    logger.debug("OBS module settings unreadable; using sceneManager's OBS configuration", {
      error: err instanceof Error ? err.message : String(err),
    });
    return obsConnectionConfig([], {}, fallback);
  }
}
