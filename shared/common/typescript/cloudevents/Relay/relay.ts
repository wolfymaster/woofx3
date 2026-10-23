// The engine's relay configuration: which local endpoints go through the
// companion's bridge, and where that bridge is. The connectors host's
// companion gateway stores it and holds the bridge credential; the api, the
// engine's one connection to its dashboard, forwards the dashboard's
// configuration and asks the dashboard for credentials on the gateway's
// behalf. See docs/services/local-endpoints.md.

import type { RelayConfig, RelayEndpoint } from "@woofx3/api";
import type { RelayCredentialRequestedResponse } from "@woofx3/api/webhooks";

/** Engine setting holding a `StoredRelayConfig` as JSON. Absent when nothing goes through a companion. */
export const RELAY_CONFIG_SETTING = "relay.config";

/**
 * Nothing publishes or subscribes to this: the companion gateway, the one
 * writer of `relay.config`, reports each change to its route watch in-process.
 */
export const RELAY_CONFIG_UPDATED_SUBJECT = "engine.relay.config.updated";

/**
 * Nothing answers this: the companion gateway holds the bridge credential and
 * asks the api for the dashboard's on `COMPANION_DASHBOARD_CREDENTIAL_SUBJECT`.
 * Its request is `{ force?: boolean }` and its reply a `RelayCredentialReply`.
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

/** A configuration with the client id of the dashboard that set it, checked. Throws naming the first problem. */
export function parseStoredRelayConfig(value: unknown): StoredRelayConfig {
  const config = parseRelayConfig(value);
  const clientId = (value as { clientId?: unknown }).clientId;
  if (typeof clientId !== "string" || clientId === "") {
    throw new Error("relay config clientId must be a non-empty string");
  }
  return { ...config, clientId };
}

/** A stored configuration, or null when the value is absent or not one. */
export function readStoredRelayConfig(raw: string | null): StoredRelayConfig | null {
  if (!raw || raw.trim() === "") {
    return null;
  }
  try {
    return parseStoredRelayConfig(JSON.parse(raw));
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
 * Asks on `RELAY_CREDENTIAL_SUBJECT`, which nothing answers, so every call
 * rejects with a timeout. Resolves null when the reply says nothing routes
 * through a companion; `force` asks for a fresh credential.
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

/** The dashboard's answer to `relay.credential.requested`. Throws on anything that is not one. */
export function parseRelayCredentialResponse(body: unknown): RelayCredentialRequestedResponse {
  if (typeof body !== "object" || body === null || !("relay" in body)) {
    throw new Error("the dashboard's answer has no relay field");
  }
  const { relay } = body as { relay: unknown };
  if (relay === null) {
    return { relay: null };
  }
  return { relay: parseRelayGrant(relay) };
}

/**
 * The api answers this for the companion gateway, which holds no dashboard
 * connection of its own: it asks the dashboard named by `clientId`, or the
 * registered one when that dashboard registered again under a new id, for a
 * bridge credential. The request and reply are bare JSON, not CloudEvents.
 */
export const COMPANION_DASHBOARD_CREDENTIAL_SUBJECT = "engine.companion.dashboard_credential";

export interface DashboardCredentialRequest {
  /** The client id stored with the relay configuration. */
  clientId: string;
}

/**
 * `answered` carries the dashboard's checked answer and the client id of the
 * dashboard that gave it, which differs from the request's when that one
 * registered again. `failed` means no dashboard answered usably.
 */
export type DashboardCredentialReply =
  | { status: "answered"; clientId: string; answer: RelayCredentialRequestedResponse }
  | { status: "failed"; error: string };

/**
 * The companion gateway answers this, as the one writer of `relay.config`:
 * the api forwards a dashboard's `setRelayConfig` here. A null `config`
 * clears it. The request and reply are bare JSON, not CloudEvents.
 */
export const COMPANION_RELAY_CONFIG_SET_SUBJECT = "engine.companion.relay_config.set";

export interface RelayConfigSetRequest {
  config: StoredRelayConfig | null;
}

export type RelayConfigSetReply = { status: "stored" } | { status: "failed"; error: string };

export type RelayParse<T> = { ok: true; value: T } | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Runs a throwing parser and returns its outcome as a result. */
function attempt<T>(parse: () => T): RelayParse<T> {
  try {
    return { ok: true, value: parse() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function failedReply(body: Record<string, unknown>): RelayParse<{ status: "failed"; error: string }> {
  if (typeof body.error !== "string") {
    return { ok: false, error: "a failed reply must carry an error string" };
  }
  return { ok: true, value: { status: "failed", error: body.error } };
}

export function parseDashboardCredentialRequest(value: unknown): RelayParse<DashboardCredentialRequest> {
  const body = asRecord(value);
  if (!body) {
    return { ok: false, error: "the request must be an object" };
  }
  if (typeof body.clientId !== "string" || body.clientId === "") {
    return { ok: false, error: "clientId must be a non-empty string" };
  }
  return { ok: true, value: { clientId: body.clientId } };
}

export function parseDashboardCredentialReply(value: unknown): RelayParse<DashboardCredentialReply> {
  const body = asRecord(value);
  if (!body) {
    return { ok: false, error: "the reply must be an object" };
  }
  if (body.status === "answered") {
    if (typeof body.clientId !== "string" || body.clientId === "") {
      return { ok: false, error: "an answered reply must name the dashboard's clientId" };
    }
    const clientId = body.clientId;
    const answer = attempt(() => parseRelayCredentialResponse(body.answer));
    return answer.ok ? { ok: true, value: { status: "answered", clientId, answer: answer.value } } : answer;
  }
  if (body.status === "failed") {
    return failedReply(body);
  }
  return { ok: false, error: 'status must be "answered" or "failed"' };
}

export function parseRelayConfigSetRequest(value: unknown): RelayParse<RelayConfigSetRequest> {
  const body = asRecord(value);
  if (!body || !("config" in body)) {
    return { ok: false, error: "the request must be an object with a config field" };
  }
  if (body.config === null) {
    return { ok: true, value: { config: null } };
  }
  const config = attempt(() => parseStoredRelayConfig(body.config));
  return config.ok ? { ok: true, value: { config: config.value } } : config;
}

export function parseRelayConfigSetReply(value: unknown): RelayParse<RelayConfigSetReply> {
  const body = asRecord(value);
  if (!body) {
    return { ok: false, error: "the reply must be an object" };
  }
  if (body.status === "stored") {
    return { ok: true, value: { status: "stored" } };
  }
  if (body.status === "failed") {
    return failedReply(body);
  }
  return { ok: false, error: 'status must be "stored" or "failed"' };
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
    if (typeof endpointId !== "string" || !isEndpointId(endpointId)) {
      throw new Error(`relay config endpoint of ${moduleId} has an invalid endpointId`);
    }
    if (!routesEndpoint({ bridgeOrigin: "", endpoints }, moduleId, endpointId)) {
      endpoints.push({ moduleId, endpointId });
    }
  }
  return endpoints;
}

/**
 * True for a manifest id the relay accepts as a bridge path segment. A path
 * segment URL parsing would resolve away is never a module id.
 */
export function isModuleId(value: string): boolean {
  return MODULE_ID.test(value) && value !== "." && value !== "..";
}

/** True for a `local[]` endpoint id the relay accepts as a bridge path segment. */
export function isEndpointId(value: string): boolean {
  return ENDPOINT_ID.test(value);
}
