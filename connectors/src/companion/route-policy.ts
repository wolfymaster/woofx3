// Route policies: what a direct route to an endpoint may be, for one kind of
// caller. The companion gateway picks the policy from the endpoint's claim;
// no caller passes one.

import { errorMessage, type Logger } from "../host/deps";
import type { EndpointStore, StoredModuleSetting } from "./endpoint-store";
import { type DeclaredEndpoint, declaredEndpoint } from "./endpoints";
import type { AdapterFallback, EndpointKeys, EndpointRouteFound, EndpointUnavailable, LocalEndpointRef } from "./types";

export type DirectDecision = (EndpointRouteFound & { route: "direct" }) | EndpointUnavailable;

export interface RoutePolicy {
  /**
   * The direct route this policy allows for the endpoint, or why there is
   * none. Reads the store afresh and never rejects. Through the companion the
   * route's password still comes from here.
   */
  direct(ref: LocalEndpointRef, fallback: AdapterFallback | undefined): Promise<DirectDecision>;
}

/**
 * For an endpoint a host adapter claims. The adapter speaks the device's
 * protocol and is trusted with the address:
 *
 * - the manifest's `local[]` entry names the settings, or the fallback's keys
 *   do for a module installed before `local[]` existed;
 * - each empty setting, and a port that is not a port, falls back to the
 *   adapter's configuration;
 * - when db-proxy cannot be read the configuration is used, because a local
 *   endpoint is best-effort and must not stop on a db outage;
 * - any address is allowed, on every hosting.
 */
export function adapterPolicy(deps: { store: EndpointStore; logger: Logger }): RoutePolicy {
  return {
    direct: async (ref, fallback) => {
      let entry: DeclaredEndpoint | null = null;
      let settings: StoredModuleSetting[] = [];
      let secrets: Record<string, string> = {};
      try {
        entry = declaredEndpoint(await deps.store.moduleManifest(ref.moduleId), ref);
        [settings, secrets] = await Promise.all([
          deps.store.moduleSettings(ref.moduleId),
          deps.store.moduleSecrets(ref.moduleId),
        ]);
      } catch (error) {
        if (fallback === undefined) {
          return unavailable("store_unreadable", `${ref.moduleId} settings could not be read: ${errorMessage(error)}`);
        }
        deps.logger.debug(`${ref.moduleId} settings unreadable; using connectors' configuration`, {
          error: errorMessage(error),
        });
        settings = [];
        secrets = {};
      }
      if (entry !== null && entry.protocol !== "websocket") {
        return unavailable("protocol_unsupported", `${ref.moduleId}/${ref.endpointId} is not a websocket endpoint`);
      }
      const keys = entry ?? fallback?.keys;
      if (keys === undefined) {
        return unavailable("not_declared", `${ref.moduleId} declares no local endpoint "${ref.endpointId}"`);
      }
      return directRouteFrom(settings, secrets, keys, fallback);
    },
  };
}

/**
 * The direct route from stored settings, each empty value taken from the
 * fallback. A port that is not a port falls back too, rather than producing
 * a URL that can never connect.
 */
export function directRouteFrom(
  settings: readonly StoredModuleSetting[],
  secrets: Readonly<Record<string, string>>,
  keys: EndpointKeys,
  fallback: AdapterFallback | undefined
): DirectDecision {
  const settingValue = (key: string) => settings.find((setting) => setting.key === key)?.value.trim() ?? "";
  const rawHost = settingValue(keys.hostSetting) || fallback?.host || "";
  const port = validPort(settingValue(keys.portSetting)) ?? fallback?.port ?? null;
  if (rawHost === "" || port === null) {
    return unavailable("not_routed", "no address is set for this endpoint");
  }
  const host = urlHost(rawHost);
  const password = (keys.passwordSetting ? secrets[keys.passwordSetting] : undefined) || fallback?.password;
  const route: DirectDecision = { ok: true, route: "direct", url: `ws://${host}:${port}`, address: `${host}:${port}` };
  if (password) {
    route.password = password;
  }
  return route;
}

function unavailable(reason: EndpointUnavailable["reason"], message: string): EndpointUnavailable {
  return { ok: false, reason, message };
}

function validPort(value: string): string | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const port = Number(value);
  return port >= 1 && port <= 65535 ? String(port) : null;
}

/** An IPv6 address goes in brackets in a URL; anything else is used as typed. */
function urlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
