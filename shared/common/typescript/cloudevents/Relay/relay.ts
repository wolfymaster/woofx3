// The engine's relay configuration: which local endpoints go through the
// companion's bridge, and where that bridge is. The api stores it (it is the
// only service that talks to the dashboard) and sceneManager's endpoint dialer
// reads it. See docs/services/local-endpoints.md.

import type { RelayConfig, RelayEndpoint } from "@woofx3/api";

/** Engine setting holding a `StoredRelayConfig` as JSON. Absent when nothing goes through a companion. */
export const RELAY_CONFIG_SETTING = "relay.config";

/**
 * Published by the api whenever `relay.config` changes. The payload carries
 * nothing a listener needs: it re-reads the setting.
 */
export const RELAY_CONFIG_UPDATED_SUBJECT = "engine.relay.config.updated";

/**
 * NATS subject the api answers with a bridge credential. The request is
 * `{ force?: boolean }`; the reply is a `RelayCredentialReply`.
 */
export const RELAY_CREDENTIAL_SUBJECT = "engine.relay.credential";

/** A credential for the bridge, with the configuration it is valid for. `expiresAt` is in ms since the epoch. */
export interface RelayGrant extends RelayConfig {
  credential: string;
  expiresAt: number;
}

export type RelayCredentialReply = { relay: RelayGrant | null } | { error: string };

/** The configuration as stored, with the engine client id of the dashboard that set it, which is the one asked for credentials. */
export interface StoredRelayConfig extends RelayConfig {
  clientId: string;
}

/** More than any instance has local endpoints; a cap so a bad call cannot store an unbounded list. */
export const MAX_RELAY_ENDPOINTS = 50;

/**
 * A manifest id, as a bridge path segment. Must match `parseBridgePath` in
 * woofx3-maintenance worker/src/relay/paths.ts, which also refuses `.` and
 * `..` (see `isModuleId`).
 */
const MODULE_ID = /^[A-Za-z0-9._-]{1,100}$/;
/** A `local[]` endpoint id (barkloader lib_module `validate_local`). */
const ENDPOINT_ID = /^[a-z0-9_-]{1,40}$/;
const CREDENTIAL = /^wfxr1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * A relay configuration from outside the engine, checked. Throws naming the
 * first problem. `bridgeOrigin` must be an `https:` origin with no path,
 * query, fragment or credentials, because the dialer appends the bridge path
 * to it and the credential travels to it.
 */
export function parseRelayConfig(value: unknown): RelayConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error("relay config must be an object");
  }
  const { bridgeOrigin, endpoints } = value as { bridgeOrigin?: unknown; endpoints?: unknown };
  return { bridgeOrigin: parseBridgeOrigin(bridgeOrigin), endpoints: parseEndpoints(endpoints) };
}

/** A stored configuration, or null when the value is absent or not one. */
export function readStoredRelayConfig(raw: string | null): StoredRelayConfig | null {
  if (!raw || raw.trim() === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const config = parseRelayConfig(parsed);
    const clientId = (parsed as { clientId?: unknown }).clientId;
    if (typeof clientId !== "string" || clientId === "") {
      return null;
    }
    return { ...config, clientId };
  } catch {
    return null;
  }
}

/** A grant from the dashboard, checked like a configuration plus its credential. Throws naming the first problem. */
export function parseRelayGrant(value: unknown): RelayGrant {
  const config = parseRelayConfig(value);
  const { credential, expiresAt } = value as { credential?: unknown; expiresAt?: unknown };
  if (typeof credential !== "string" || !CREDENTIAL.test(credential)) {
    throw new Error("relay credential is malformed");
  }
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw new Error("relay credential has no expiry");
  }
  return { ...config, credential, expiresAt };
}

type NatsRequest = (subject: string, data: Uint8Array, opts?: { timeout?: number }) => Promise<{ data: Uint8Array }>;

/**
 * Asks the api service, the engine's one connection to its dashboard, for the
 * bridge credential, so no other service holds the dashboard's address or
 * credentials. Resolves null when nothing routes through a companion; `force`
 * asks for a fresh credential in place of a cached one the relay refused.
 */
export function requestRelayCredentialOverNats(
  request: NatsRequest,
  timeoutMs = 5_000
): (force: boolean) => Promise<RelayGrant | null> {
  return async (force) => {
    const reply = await request(RELAY_CREDENTIAL_SUBJECT, new TextEncoder().encode(JSON.stringify({ force })), {
      timeout: timeoutMs,
    });
    const body: unknown = JSON.parse(new TextDecoder().decode(reply.data));
    if (typeof body !== "object" || body === null) {
      throw new Error("the api service's relay credential reply is not an object");
    }
    const { relay, error } = body as { relay?: unknown; error?: unknown };
    if (typeof error === "string") {
      throw new Error(`the api service could not get a relay credential: ${error}`);
    }
    if (relay === null) {
      return null;
    }
    if (relay === undefined) {
      throw new Error("the api service's relay credential reply is malformed");
    }
    return parseRelayGrant(relay);
  };
}

/** True when the configuration routes this endpoint through the bridge. */
export function routesEndpoint(config: RelayConfig, moduleId: string, endpointId: string): boolean {
  return config.endpoints.some((e) => e.moduleId === moduleId && e.endpointId === endpointId);
}

/** True when both route the same endpoints to the same bridge, in any order. */
export function sameRelayConfig(a: RelayConfig, b: RelayConfig): boolean {
  if (a.bridgeOrigin !== b.bridgeOrigin || a.endpoints.length !== b.endpoints.length) {
    return false;
  }
  return a.endpoints.every((e) => routesEndpoint(b, e.moduleId, e.endpointId));
}

function parseBridgeOrigin(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("relay config bridgeOrigin must be a string");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("relay config bridgeOrigin is not a URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("relay config bridgeOrigin must be https");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("relay config bridgeOrigin must be an origin, with no path, query or credentials");
  }
  return url.origin;
}

function parseEndpoints(value: unknown): RelayEndpoint[] {
  if (!Array.isArray(value)) {
    throw new Error("relay config endpoints must be an array");
  }
  if (value.length > MAX_RELAY_ENDPOINTS) {
    throw new Error(`relay config may route at most ${MAX_RELAY_ENDPOINTS} endpoints`);
  }
  const endpoints: RelayEndpoint[] = [];
  for (const entry of value) {
    const { moduleId, endpointId } = (entry ?? {}) as { moduleId?: unknown; endpointId?: unknown };
    if (typeof moduleId !== "string" || !isModuleId(moduleId)) {
      throw new Error("relay config endpoint has an invalid moduleId");
    }
    if (typeof endpointId !== "string" || !ENDPOINT_ID.test(endpointId)) {
      throw new Error(`relay config endpoint of ${moduleId} has an invalid endpointId`);
    }
    if (!routesEndpoint({ bridgeOrigin: "", endpoints }, moduleId, endpointId)) {
      endpoints.push({ moduleId, endpointId });
    }
  }
  return endpoints;
}

/** A path segment URL parsing would resolve away is never a module id. */
function isModuleId(value: string): boolean {
  return MODULE_ID.test(value) && value !== "." && value !== "..";
}
