// The engine's relay configuration: which local endpoints go through the
// companion's bridge, and where that bridge is. The connectors host's
// companion gateway stores it and holds the bridge credential; the api, the
// engine's one connection to its dashboard, forwards the dashboard's
// configuration and asks the dashboard for credentials on the gateway's
// behalf. See docs/services/local-endpoints.md.

import type { RelayConfig, RelayEndpoint } from "@woofx3/api";
import type { RelayCredentialRequestedResponse } from "@woofx3/api/webhooks";
import { ENDPOINT_ID_PATTERN, MODULE_ID_PATTERN } from "../Companion/module-request";
import { asRecord, err, ok, type ParseResult } from "../utils";

/** Engine setting holding a `StoredRelayConfig` as JSON. Absent when nothing goes through a companion. */
export const RELAY_CONFIG_SETTING = "relay.config";

/** A credential for the bridge, with the configuration it is valid for. `expiresAt` is in ms since the epoch. */
export interface RelayGrant extends RelayConfig {
  credential: string;
  expiresAt: number;
}

/** The configuration as stored, with the engine client id of the dashboard that set it, which is the one asked for credentials. */
export interface StoredRelayConfig extends RelayConfig {
  clientId: string;
}

/** More than any instance has local endpoints; a cap so a bad call cannot store an unbounded list. */
export const MAX_RELAY_ENDPOINTS = 50;

const CREDENTIAL = /^wfxr1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * A relay configuration from outside the engine, checked. The error names the
 * first problem. `bridgeOrigin` must be an `https:` origin with no path,
 * query, fragment or credentials, because the dialer appends the bridge path
 * to it and the credential travels to it.
 */
export function parseRelayConfig(value: unknown): ParseResult<RelayConfig> {
  const body = asRecord(value);
  if (!body) {
    return err("relay config must be an object");
  }
  const bridgeOrigin = parseBridgeOrigin(body.bridgeOrigin);
  if (!bridgeOrigin.ok) {
    return bridgeOrigin;
  }
  const endpoints = parseEndpoints(body.endpoints);
  if (!endpoints.ok) {
    return endpoints;
  }
  return ok({ bridgeOrigin: bridgeOrigin.value, endpoints: endpoints.value });
}

/** A configuration with the client id of the dashboard that set it, checked. */
export function parseStoredRelayConfig(value: unknown): ParseResult<StoredRelayConfig> {
  const config = parseRelayConfig(value);
  if (!config.ok) {
    return config;
  }
  const clientId = (value as { clientId?: unknown }).clientId;
  if (typeof clientId !== "string" || clientId === "") {
    return err("relay config clientId must be a non-empty string");
  }
  return ok({ ...config.value, clientId });
}

/** A stored configuration, or null when the value is absent or not one. */
export function readStoredRelayConfig(raw: string | null): StoredRelayConfig | null {
  if (!raw || raw.trim() === "") {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = parseStoredRelayConfig(json);
  return parsed.ok ? parsed.value : null;
}

/** A grant from the dashboard, checked like a configuration plus its credential. */
export function parseRelayGrant(value: unknown): ParseResult<RelayGrant> {
  const config = parseRelayConfig(value);
  if (!config.ok) {
    return config;
  }
  const { credential, expiresAt } = value as { credential?: unknown; expiresAt?: unknown };
  if (typeof credential !== "string" || !CREDENTIAL.test(credential)) {
    return err("relay credential is malformed");
  }
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    return err("relay credential has no expiry");
  }
  return ok({ ...config.value, credential, expiresAt });
}

/** The dashboard's answer to `relay.credential.requested`. */
export function parseRelayCredentialResponse(body: unknown): ParseResult<RelayCredentialRequestedResponse> {
  if (typeof body !== "object" || body === null || !("relay" in body)) {
    return err("the dashboard's answer has no relay field");
  }
  const { relay } = body as { relay: unknown };
  if (relay === null) {
    return ok({ relay: null });
  }
  const grant = parseRelayGrant(relay);
  return grant.ok ? ok({ relay: grant.value }) : grant;
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

// The timeouts around a dashboard's relay requests, in ascending order: each
// side waits longer than the step it waits on, so it hears why that step
// failed instead of timing out itself.

/** The companion gateway's budget for storing a configuration on `COMPANION_RELAY_CONFIG_SET_SUBJECT`. */
export const RELAY_CONFIG_SET_BUDGET_MS = 4_500;

/**
 * The api's default wait for the companion gateway's answer on
 * `COMPANION_RELAY_CONFIG_SET_SUBJECT`, and its wait for a dashboard's
 * answer to a request. Above `RELAY_CONFIG_SET_BUDGET_MS`.
 */
export const RELAY_API_REQUEST_TIMEOUT_MS = 5_000;

/**
 * The companion gateway's wait for the api's answer on
 * `COMPANION_DASHBOARD_CREDENTIAL_SUBJECT`. Above
 * `RELAY_API_REQUEST_TIMEOUT_MS`, the api's own wait for the dashboard.
 */
export const RELAY_DASHBOARD_REQUEST_TIMEOUT_MS = 6_000;

export interface RelayConfigSetRequest {
  config: StoredRelayConfig | null;
}

export type RelayConfigSetReply = { status: "stored" } | { status: "failed"; error: string };

function failedReply(body: Record<string, unknown>): ParseResult<{ status: "failed"; error: string }> {
  if (typeof body.error !== "string") {
    return err("a failed reply must carry an error string");
  }
  return ok({ status: "failed", error: body.error });
}

export function parseDashboardCredentialRequest(value: unknown): ParseResult<DashboardCredentialRequest> {
  const body = asRecord(value);
  if (!body) {
    return err("the request must be an object");
  }
  if (typeof body.clientId !== "string" || body.clientId === "") {
    return err("clientId must be a non-empty string");
  }
  return ok({ clientId: body.clientId });
}

export function parseDashboardCredentialReply(value: unknown): ParseResult<DashboardCredentialReply> {
  const body = asRecord(value);
  if (!body) {
    return err("the reply must be an object");
  }
  if (body.status === "answered") {
    if (typeof body.clientId !== "string" || body.clientId === "") {
      return err("an answered reply must name the dashboard's clientId");
    }
    const clientId = body.clientId;
    const answer = parseRelayCredentialResponse(body.answer);
    return answer.ok ? ok({ status: "answered", clientId, answer: answer.value }) : answer;
  }
  if (body.status === "failed") {
    return failedReply(body);
  }
  return err('status must be "answered" or "failed"');
}

export function parseRelayConfigSetRequest(value: unknown): ParseResult<RelayConfigSetRequest> {
  const body = asRecord(value);
  if (!body || !("config" in body)) {
    return err("the request must be an object with a config field");
  }
  if (body.config === null) {
    return ok({ config: null });
  }
  const config = parseStoredRelayConfig(body.config);
  return config.ok ? ok({ config: config.value }) : config;
}

export function parseRelayConfigSetReply(value: unknown): ParseResult<RelayConfigSetReply> {
  const body = asRecord(value);
  if (!body) {
    return err("the reply must be an object");
  }
  if (body.status === "stored") {
    return ok({ status: "stored" });
  }
  if (body.status === "failed") {
    return failedReply(body);
  }
  return err('status must be "stored" or "failed"');
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

function parseBridgeOrigin(value: unknown): ParseResult<string> {
  if (typeof value !== "string") {
    return err("relay config bridgeOrigin must be a string");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return err("relay config bridgeOrigin is not a URL");
  }
  if (url.protocol !== "https:") {
    return err("relay config bridgeOrigin must be https");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    return err("relay config bridgeOrigin must be an origin, with no path, query or credentials");
  }
  return ok(url.origin);
}

function parseEndpoints(value: unknown): ParseResult<RelayEndpoint[]> {
  if (!Array.isArray(value)) {
    return err("relay config endpoints must be an array");
  }
  if (value.length > MAX_RELAY_ENDPOINTS) {
    return err(`relay config may route at most ${MAX_RELAY_ENDPOINTS} endpoints`);
  }
  const endpoints: RelayEndpoint[] = [];
  for (const entry of value) {
    const { moduleId, endpointId } = (entry ?? {}) as { moduleId?: unknown; endpointId?: unknown };
    if (typeof moduleId !== "string" || !isModuleId(moduleId)) {
      return err("relay config endpoint has an invalid moduleId");
    }
    if (typeof endpointId !== "string" || !isEndpointId(endpointId)) {
      return err(`relay config endpoint of ${moduleId} has an invalid endpointId`);
    }
    if (!routesEndpoint({ bridgeOrigin: "", endpoints }, moduleId, endpointId)) {
      endpoints.push({ moduleId, endpointId });
    }
  }
  return ok(endpoints);
}

/**
 * True for a manifest id the relay accepts as a bridge path segment. The
 * pattern is the companion gateway contract's (companion-gateway.json), which
 * must match `parseBridgePath` in woofx3-maintenance worker/src/relay/paths.ts.
 * A path segment URL parsing would resolve away is never a module id.
 */
export function isModuleId(value: string): boolean {
  return MODULE_ID_PATTERN.test(value) && value !== "." && value !== "..";
}

/**
 * True for a `local[]` endpoint id the relay accepts as a bridge path segment:
 * barkloader's lib_module `validate_local` pattern, the companion gateway
 * contract's.
 */
export function isEndpointId(value: string): boolean {
  return ENDPOINT_ID_PATTERN.test(value);
}
