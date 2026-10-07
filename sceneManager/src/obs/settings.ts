// Where sceneManager connects to OBS. The OBS marketplace module declares the
// connection as a `local[]` endpoint whose settings a streamer (or the
// companion) fills in on the module's page; the endpoint dialer reads them and
// picks the route. sceneManager's own configuration fills in whatever the
// module does not say, which keeps an engine without the module connecting as
// it always has.

import type { Logger } from "@woofx3/common/runtime";
import { type DialTarget, type EndpointKeys, EndpointRelayError, type WebSocketRoute } from "../endpoints/dialer";
import { type ObsSession, obsFailureKind } from "./connection";
import type Manager from "./manager";
import { openObsSession } from "./manager";

/** The OBS module's manifest id. Must match `id` in woofx3-modules' modules/platform/obs/manifest.json. */
export const OBS_MODULE_ID = "woofx3_obs";

/** The OBS module's `local[]` endpoint id. Must match its manifest. */
export const OBS_ENDPOINT_ID = "obs";

/** The OBS module's setting ids, for an installed version that predates `local[]`. */
export const OBS_FALLBACK_KEYS: EndpointKeys = {
  hostSetting: "host",
  portSetting: "port",
  passwordSetting: "password",
};

export interface ObsFallback {
  host: string;
  port: string;
  token?: string;
}

/** The dialer target for OBS's connection, falling back to sceneManager's configuration. */
export function obsDialTarget(fallback: ObsFallback): DialTarget {
  return {
    moduleId: OBS_MODULE_ID,
    endpointId: OBS_ENDPOINT_ID,
    fallbackKeys: OBS_FALLBACK_KEYS,
    fallback: { host: fallback.host, port: fallback.port, password: fallback.token },
  };
}

/**
 * Open an OBS session on the route the dialer picked. Through the companion,
 * a failure other than OBS refusing the password is the bridge's: the relay
 * refusing the upgrade (502, 503), the companion refusing the endpoint (4403),
 * or the companion not reaching OBS. It reads as `relay`, so the streamer is
 * pointed at the companion rather than at OBS.
 */
export async function openObsOverRoute(route: WebSocketRoute, logger: Logger): Promise<ObsSession<Manager>> {
  try {
    return await openObsSession({ url: route.url, token: route.password }, logger);
  } catch (err) {
    if (route.route === "companion" && obsFailureKind(err) !== "authentication") {
      const message = err instanceof Error ? err.message : String(err);
      throw new EndpointRelayError(`OBS could not be reached through the companion: ${message}`, route.address);
    }
    throw err;
  }
}
