// Picks how sceneManager reaches a module's local endpoint: straight to the
// address in the module's settings, or through the companion's bridge when the
// dashboard routed that endpoint there. The companion owns the actual address
// on the streamer's network, so the bridge path names the endpoint, never a
// host. See docs/services/local-endpoints.md.

import type { RelayConfig } from "@woofx3/api";
import { type RelayGrant, routesEndpoint } from "@woofx3/common/cloudevents/Relay/relay";
import type { Logger } from "@woofx3/common/runtime";

/** The settings a `local[]` entry names for an endpoint's address and password. */
export interface EndpointKeys {
  hostSetting: string;
  portSetting: string;
  passwordSetting?: string;
}

export interface WebSocketRoute {
  route: "direct" | "companion";
  url: string;
  /** The endpoint's own password (OBS's), carried end to end; the relay only ever carries the protocol's challenge response. */
  password?: string;
  /** `host:port` for status reporting; through the bridge it is the bridge's host, never a ticket. */
  address: string;
}

/**
 * The bridge could not be opened: no credential, the relay refused or did not
 * answer, or the upgrade through it failed.
 */
export class EndpointRelayError extends Error {
  /** The bridge's host, for status reporting. */
  constructor(
    message: string,
    readonly address: string
  ) {
    super(message);
    this.name = "EndpointRelayError";
  }
}

export interface DialerDeps {
  /** The stored manifest's `local[]` keys for the endpoint, or null when it has none or cannot be read. */
  endpointKeys(moduleId: string, endpointId: string): Promise<EndpointKeys | null>;
  settings(moduleId: string): Promise<{ key: string; value: string }[]>;
  secrets(moduleId: string): Promise<Record<string, string>>;
  relayConfig(): Promise<RelayConfig | null>;
  /**
   * The bridge credential, or null when nothing routes through a companion.
   * `force` asks for a fresh one in place of a cached one. Throws when none can be had.
   */
  relayCredential(force: boolean): Promise<RelayGrant | null>;
  fetch: typeof fetch;
  logger: Logger;
}

export interface DialTarget {
  moduleId: string;
  endpointId: string;
  /** Used when the installed module's manifest has no `local[]` entry for the endpoint. */
  fallbackKeys: EndpointKeys;
  /** sceneManager's own configuration, for each value the settings leave empty. */
  fallback: { host: string; port: string; password?: string };
}

const TICKET_TIMEOUT_MS = 5_000;
const TICKET = /^[A-Za-z0-9_-]{43}$/;

/**
 * The route for one connect attempt. Everything is read afresh each time, so
 * a retry picks up a change whose announcement was missed, and every bridge
 * attempt gets a fresh ticket: a ticket is single-use, spent even when the
 * upgrade it was presented on is refused.
 */
export async function dialWebSocketEndpoint(deps: DialerDeps, target: DialTarget): Promise<WebSocketRoute> {
  const direct = await directRoute(deps, target);
  const config = await deps.relayConfig();
  if (!config || !routesEndpoint(config, target.moduleId, target.endpointId)) {
    return direct;
  }
  let address = new URL(config.bridgeOrigin).host;
  try {
    let grant = await deps.relayCredential(false);
    for (let renewed = false; ; renewed = true) {
      // The dashboard's answer is authoritative: it may have stopped routing
      // the endpoint since the stored configuration was read.
      if (!grant || !routesEndpoint(grant, target.moduleId, target.endpointId)) {
        return direct;
      }
      address = new URL(grant.bridgeOrigin).host;
      const path = `/bridge/${encodeURIComponent(target.moduleId)}/${encodeURIComponent(target.endpointId)}`;
      const ticket = await requestTicket(deps, new URL(path, grant.bridgeOrigin), grant.credential);
      if (typeof ticket === "string") {
        const url = new URL(path, grant.bridgeOrigin);
        url.protocol = "wss:";
        url.searchParams.set("ticket", ticket);
        return { route: "companion", url: url.toString(), password: direct.password, address };
      }
      // A cached credential the relay no longer accepts (a rotated key, a
      // new companion host) is renewed once; a second refusal is the answer.
      if (ticket !== 401 || renewed) {
        throw new Error(`the companion relay refused the bridge (${ticket})`);
      }
      grant = await deps.relayCredential(true);
    }
  } catch (err) {
    throw new EndpointRelayError(err instanceof Error ? err.message : String(err), address);
  }
}

/**
 * True when a relay configuration change moves the endpoint off the route
 * the latest attempt took, so the open session should be replaced. With no
 * attempt yet, the one in flight may have read the old configuration.
 */
export function relayChangeMovesEndpoint(
  config: RelayConfig | null,
  target: Pick<DialTarget, "moduleId" | "endpointId">,
  last: { route: "direct" | "companion"; address: string } | null
): boolean {
  if (last === null) {
    return true;
  }
  if (!config || !routesEndpoint(config, target.moduleId, target.endpointId)) {
    return last.route === "companion";
  }
  return last.route !== "companion" || new URL(config.bridgeOrigin).host !== last.address;
}

/** The ticket, or the status the relay refused the exchange with. */
async function requestTicket(deps: DialerDeps, url: URL, credential: string): Promise<string | number> {
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(TICKET_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`the companion relay did not answer: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    return response.status;
  }
  const body = (await response.json().catch(() => null)) as { ticket?: unknown } | null;
  const ticket = body?.ticket;
  if (typeof ticket !== "string" || !TICKET.test(ticket)) {
    throw new Error("the companion relay answered without a ticket");
  }
  return ticket;
}

/**
 * The address in the module's settings, each value falling back to
 * sceneManager's configuration when empty. A port that is not a port falls
 * back too, rather than producing a URL that can never connect. When db-proxy
 * cannot be read, the configuration is used: a local endpoint is best-effort
 * and must not stop on a db outage.
 */
export async function directRoute(deps: DialerDeps, target: DialTarget): Promise<WebSocketRoute> {
  let keys = target.fallbackKeys;
  let settings: { key: string; value: string }[] = [];
  let secrets: Record<string, string> = {};
  try {
    keys = (await deps.endpointKeys(target.moduleId, target.endpointId)) ?? target.fallbackKeys;
    [settings, secrets] = await Promise.all([deps.settings(target.moduleId), deps.secrets(target.moduleId)]);
  } catch (err) {
    deps.logger.debug(`${target.moduleId} settings unreadable; using sceneManager's configuration`, {
      error: err instanceof Error ? err.message : String(err),
    });
    settings = [];
    secrets = {};
  }
  return directRouteFrom(settings, secrets, keys, target.fallback);
}

export function directRouteFrom(
  settings: readonly { key: string; value: string }[],
  secrets: Readonly<Record<string, string>>,
  keys: EndpointKeys,
  fallback: DialTarget["fallback"]
): WebSocketRoute {
  const settingValue = (key: string) => settings.find((setting) => setting.key === key)?.value.trim() ?? "";
  const host = urlHost(settingValue(keys.hostSetting) || fallback.host);
  const port = validPort(settingValue(keys.portSetting)) ?? fallback.port;
  const password = (keys.passwordSetting ? secrets[keys.passwordSetting] : undefined) || fallback.password;
  const route: WebSocketRoute = { route: "direct", url: `ws://${host}:${port}`, address: `${host}:${port}` };
  if (password) {
    route.password = password;
  }
  return route;
}

/**
 * The `local[]` entry for an endpoint in a stored manifest (`modules.manifest`,
 * as barkloader re-serialized it at install). Anything it cannot read counts
 * as absent, so a module installed before `local[]` existed uses the caller's
 * fallback keys.
 */
export function endpointKeysFromManifest(manifest: string | null | undefined, endpointId: string): EndpointKeys | null {
  if (!manifest) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    return null;
  }
  const local = (parsed as { local?: unknown } | null)?.local;
  if (!Array.isArray(local)) {
    return null;
  }
  const entry = local.find((e) => (e as { id?: unknown } | null)?.id === endpointId) as
    | { hostSetting?: unknown; portSetting?: unknown; passwordSetting?: unknown }
    | undefined;
  if (!entry || typeof entry.hostSetting !== "string" || typeof entry.portSetting !== "string") {
    return null;
  }
  const keys: EndpointKeys = { hostSetting: entry.hostSetting, portSetting: entry.portSetting };
  if (typeof entry.passwordSetting === "string") {
    keys.passwordSetting = entry.passwordSetting;
  }
  return keys;
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
