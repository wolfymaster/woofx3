// Where the OBS adapter connects to OBS. The OBS marketplace module declares the
// connection as a `local[]` endpoint whose settings a streamer (or the
// companion) fills in on the module's page; the companion gateway reads them and
// picks the route. connectors' own configuration (WOOFX3_OBS_*) fills in whatever the
// module does not say, which keeps an engine without the module connecting as
// it always has.

import type { AdapterFallback, EndpointKeys, LocalEndpointRef } from "../../companion/types";

/** The OBS module's manifest id. Must match `id` in woofx3-modules' modules/platform/obs/manifest.json. */
export const OBS_MODULE_ID = "woofx3_obs";

/** The OBS module's `local[]` endpoint id. Must match its manifest. */
export const OBS_ENDPOINT_ID = "obs";

/** The endpoint the OBS adapter claims: module code never reaches it, so ctx.obs's allowlist always applies. */
export const OBS_ENDPOINT: LocalEndpointRef = { moduleId: OBS_MODULE_ID, endpointId: OBS_ENDPOINT_ID };

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

/** connectors' configuration for OBS, as the companion gateway's fallback for each empty module setting. */
export function obsAdapterFallback(fallback: ObsFallback): AdapterFallback {
  const adapterFallback: AdapterFallback = { keys: OBS_FALLBACK_KEYS, host: fallback.host, port: fallback.port };
  if (fallback.token !== undefined) {
    adapterFallback.password = fallback.token;
  }
  return adapterFallback;
}
