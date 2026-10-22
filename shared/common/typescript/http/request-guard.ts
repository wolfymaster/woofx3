/**
 * Host and Origin checks shared by the engine's HTTP services (api,
 * sceneManager), configured by `WOOFX3_ALLOWED_HOSTS` and
 * `WOOFX3_ALLOWED_ORIGINS`.
 *
 * An unset list does not mean open. Each service resolves its defaults here,
 * once, at startup:
 * - Origins default to the loopback dev servers and the desktop webview
 *   (DEFAULT_ALLOWED_ORIGINS), the origins of the URLs the service is
 *   configured to be reached at, and any origins the service adds (sceneManager
 *   adds `null` for sandboxed widget frames).
 * - Hosts default to the loopback names (LOOPBACK_HOSTS) and the hosts of the
 *   service's configured URLs, but only on a service reachable over loopback
 *   alone. Behind the edge or on a network interface the Host is whatever the
 *   proxy in front sends, which only the operator knows, so it stays unchecked.
 * - The value `*` turns a check off: every Host, or every Origin with CORS `*`.
 *
 * When a check is on:
 * - an unknown `Host` is answered 421 Misdirected Request. That is the DNS
 *   rebinding defence: a page on a hostile name that resolves to the engine
 *   still sends its own name as the Host.
 * - a present but unknown `Origin` is answered 403, WebSocket upgrades
 *   included. An absent Origin is allowed: OBS, the CLI and peer services
 *   send none, and neither does a browser for a same-origin GET or a
 *   top-level navigation.
 * - CORS echoes the matched origin with `Vary: Origin` instead of `*`.
 *
 * Matching rules (documented in docs/services/deployment.md):
 * - Host entries are `name` or `name:port`, compared case-insensitively.
 *   A bare name matches it on any port; with a port, only that port. A
 *   browser leaves a default port out of Host, so `name:80` and `name:443`
 *   also match a Host with no port. IPv6 literals are bracketed: `[::1]`,
 *   `[::1]:8080`.
 * - Origin entries are `scheme://host[:port]`, compared as serialized web
 *   origins, so the scheme's default port may be written or left out.
 *   `scheme://host:*` matches the host on any port. A scheme the URL
 *   standard has no origin for, such as the `tauri://localhost` a desktop
 *   webview sends, is compared as `scheme://host[:port]`, lowercased. The
 *   literal `null` matches the opaque origin that sandboxed frames send;
 *   nothing else does.
 */

export interface RequestGuardPolicy {
  /** Null when Host is not checked (`*`, or the default on a network-exposed service). */
  allowedHosts: readonly HostRule[] | null;
  /** Null when Origin is not checked (`*`) and CORS allows any origin. */
  allowedOrigins: readonly OriginRule[] | null;
}

export interface HostRule {
  hostname: string;
  /** Null matches any port. */
  port: string | null;
}

export type OriginRule =
  | { kind: "exact"; origin: string }
  | { kind: "anyPort"; protocol: string; hostname: string }
  | { kind: "opaque" };

/**
 * How far a service's listener can be reached: `loopback` when it binds a
 * loopback interface and no edge listener fronts it, `network` otherwise.
 */
export type Exposure = "loopback" | "network";

export interface RequestGuardSettings {
  /** Comma-separated `WOOFX3_ALLOWED_HOSTS`; `*` turns the check off, blank or undefined means the default. */
  allowedHosts?: string | number | boolean;
  /** Comma-separated `WOOFX3_ALLOWED_ORIGINS`; `*` turns the check off, blank or undefined means the default. */
  allowedOrigins?: string | number | boolean;
  /** Decides whether Host is checked by default; see resolveExposure. */
  exposure: Exposure;
  /**
   * Absolute URLs the service is configured to be reached at (its public URL,
   * the URL peers call it by). Their hosts join the default Host list and
   * their origins the default Origin list.
   */
  ownUrls: readonly string[];
  /** Origins the service adds to DEFAULT_ALLOWED_ORIGINS when `WOOFX3_ALLOWED_ORIGINS` is unset. */
  extraDefaultOrigins: readonly string[];
}

/** The list value that turns a check off. */
export const ALLOW_ANY = "*";

/**
 * The origins a service accepts when `WOOFX3_ALLOWED_ORIGINS` is unset: local
 * dev servers on any port, and the desktop app's webview (`tauri://localhost`
 * on macOS and Linux, `http://tauri.localhost` on Windows).
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:*",
  "http://127.0.0.1:*",
  "tauri://localhost",
  "http://tauri.localhost",
];

/** The names a loopback-only service is reached by when `WOOFX3_ALLOWED_HOSTS` is unset, on any port. */
export const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];

/** Whether `hostname` (a bind address or URL host, IPv6 bracketed or not) names the loopback interface. */
export function isLoopbackHostname(hostname: string): boolean {
  const name = hostname.trim().toLowerCase().replace(/\.$/, "");
  return name === "localhost" || name === "::1" || name === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

/**
 * The exposure of a service that binds `bindHost`. `behindEdge` is
 * `WOOFX3_BEHIND_EDGE`, which the production image sets: there the edge
 * listens beyond loopback and forwards to the service, so the service is
 * reachable from the network whatever it binds.
 */
export function resolveExposure(bindHost: string, behindEdge: boolean): Exposure {
  return behindEdge || !isLoopbackHostname(bindHost) ? "network" : "loopback";
}

const OPAQUE_ORIGIN = "null";

/**
 * The URL standard's special schemes with a tuple origin. Every other scheme
 * serializes its origin as "null", which would make `tauri://localhost`
 * impossible to list and every such origin equal to every other.
 */
const TUPLE_ORIGIN_SCHEMES = new Set(["http:", "https:", "ws:", "wss:", "ftp:"]);

/** Ports a browser leaves out of the Host header. */
const DEFAULT_HOST_PORTS = new Set(["80", "443"]);

/**
 * The origin a rule and a request Origin are compared by, or null when the
 * URL has none worth comparing (file:, or a scheme with no host).
 */
function comparableOrigin(url: URL): string | null {
  if (TUPLE_ORIGIN_SCHEMES.has(url.protocol)) {
    return url.origin;
  }
  if (url.protocol === "file:" || url.host === "") {
    return null;
  }
  return `${url.protocol}//${url.host}`.toLowerCase();
}

/**
 * The policy as two log-friendly strings, `*` for an unchecked list, so an
 * operator can see at startup which Hosts and Origins the defaults resolved to.
 */
export function describeRequestGuardPolicy(policy: RequestGuardPolicy): {
  allowedHosts: string;
  allowedOrigins: string;
} {
  return {
    allowedHosts:
      policy.allowedHosts === null
        ? ALLOW_ANY
        : policy.allowedHosts
            .map((rule) => (rule.port === null ? rule.hostname : `${rule.hostname}:${rule.port}`))
            .join(","),
    allowedOrigins:
      policy.allowedOrigins === null ? ALLOW_ANY : policy.allowedOrigins.map(describeOriginRule).join(","),
  };
}

function describeOriginRule(rule: OriginRule): string {
  switch (rule.kind) {
    case "exact":
      return rule.origin;
    case "anyPort":
      return `${rule.protocol}//${rule.hostname}:*`;
    case "opaque":
      return OPAQUE_ORIGIN;
  }
}

/** Allows every Host and Origin, with CORS `*`. */
export const OPEN_REQUEST_GUARD_POLICY: RequestGuardPolicy = { allowedHosts: null, allowedOrigins: null };

type ListSetting = { kind: "default" } | { kind: "any" } | { kind: "entries"; entries: string[] };

function readList(name: string, value: string | number | boolean | undefined): ListSetting {
  if (value === undefined) {
    return { kind: "default" };
  }
  if (typeof value !== "string") {
    throw new Error(`${name}: ${String(value)} is not a comma-separated list`);
  }
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (entries.length === 0) {
    return { kind: "default" };
  }
  if (entries.includes(ALLOW_ANY)) {
    if (entries.length > 1) {
      throw new Error(`${name}: ${ALLOW_ANY} allows everything, so it must be the only entry`);
    }
    return { kind: "any" };
  }
  return { kind: "entries", entries };
}

/** A configured URL of the service itself; a malformed one is a startup error. */
function parseOwnUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`request guard: the service's own URL "${value}" is not an absolute URL`);
  }
}

/** Splits `name`, `name:port`, `[v6]` or `[v6]:port`; null when malformed. */
function splitHostPort(value: string): { hostname: string; port: string | null } | null {
  const bracketed = /^(\[[0-9a-fA-F:.]+\])(?::(\d+))?$/.exec(value);
  if (bracketed) {
    return { hostname: bracketed[1]!.toLowerCase(), port: bracketed[2] ?? null };
  }
  const plain = /^([A-Za-z0-9.-]+)(?::(\d+))?$/.exec(value);
  if (plain) {
    return { hostname: plain[1]!.toLowerCase().replace(/\.$/, ""), port: plain[2] ?? null };
  }
  return null;
}

function parseHostRule(entry: string): HostRule {
  const parsed = splitHostPort(entry);
  if (!parsed || parsed.hostname === "") {
    throw new Error(`WOOFX3_ALLOWED_HOSTS: "${entry}" is not a host name or host:port`);
  }
  return parsed;
}

function parseOriginRule(entry: string): OriginRule {
  if (entry === OPAQUE_ORIGIN) {
    return { kind: "opaque" };
  }
  const anyPort = entry.endsWith(":*");
  const base = anyPort ? entry.slice(0, -2) : entry;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`WOOFX3_ALLOWED_ORIGINS: "${entry}" is not scheme://host[:port]`);
  }
  const hasPathOrMore = (url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "";
  const origin = comparableOrigin(url);
  if (origin === null || hasPathOrMore || url.username !== "" || url.password !== "") {
    throw new Error(`WOOFX3_ALLOWED_ORIGINS: "${entry}" is not scheme://host[:port]`);
  }
  if (anyPort) {
    if (url.port !== "") {
      throw new Error(`WOOFX3_ALLOWED_ORIGINS: "${entry}" names both a port and :*`);
    }
    return { kind: "anyPort", protocol: url.protocol, hostname: url.hostname.toLowerCase() };
  }
  return { kind: "exact", origin };
}

/**
 * Parses the two settings and resolves their defaults, throwing on a
 * malformed entry so a typo fails the service at startup rather than locking
 * every client out at runtime.
 */
export function parseRequestGuardPolicy(settings: RequestGuardSettings): RequestGuardPolicy {
  const ownUrls = settings.ownUrls.map(parseOwnUrl);
  return {
    allowedHosts: resolveHostRules(readList("WOOFX3_ALLOWED_HOSTS", settings.allowedHosts), settings.exposure, ownUrls),
    allowedOrigins: resolveOriginRules(
      readList("WOOFX3_ALLOWED_ORIGINS", settings.allowedOrigins),
      ownUrls,
      settings.extraDefaultOrigins
    ),
  };
}

function resolveHostRules(setting: ListSetting, exposure: Exposure, ownUrls: readonly URL[]): HostRule[] | null {
  if (setting.kind === "any") {
    return null;
  }
  if (setting.kind === "entries") {
    return setting.entries.map(parseHostRule);
  }
  if (exposure !== "loopback") {
    return null;
  }
  return [
    ...LOOPBACK_HOSTS.map(parseHostRule),
    ...ownUrls.map((url) => ({ hostname: url.hostname.toLowerCase(), port: null })),
  ];
}

function resolveOriginRules(
  setting: ListSetting,
  ownUrls: readonly URL[],
  extraDefaultOrigins: readonly string[]
): OriginRule[] | null {
  if (setting.kind === "any") {
    return null;
  }
  if (setting.kind === "entries") {
    return setting.entries.map(parseOriginRule);
  }
  const ownOrigins = ownUrls
    .map(comparableOrigin)
    .filter((origin): origin is string => origin !== null)
    .map((origin): OriginRule => ({ kind: "exact", origin }));
  return [...[...DEFAULT_ALLOWED_ORIGINS, ...extraDefaultOrigins].map(parseOriginRule), ...ownOrigins];
}

function hostAllowed(rules: readonly HostRule[], hostHeader: string | null): boolean {
  if (hostHeader === null) {
    return false;
  }
  const parsed = splitHostPort(hostHeader.trim());
  if (!parsed) {
    return false;
  }
  return rules.some(
    (rule) =>
      rule.hostname === parsed.hostname &&
      (rule.port === null || rule.port === parsed.port || (parsed.port === null && DEFAULT_HOST_PORTS.has(rule.port)))
  );
}

function originAllowed(rules: readonly OriginRule[], origin: string): boolean {
  if (origin === OPAQUE_ORIGIN) {
    return rules.some((rule) => rule.kind === "opaque");
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const comparable = comparableOrigin(url);
  if (comparable === null) {
    return false;
  }
  return rules.some((rule) => {
    if (rule.kind === "exact") {
      return rule.origin === comparable;
    }
    if (rule.kind === "anyPort") {
      return rule.protocol === url.protocol && rule.hostname === url.hostname.toLowerCase();
    }
    return false;
  });
}

export class RequestGuard {
  constructor(private readonly policy: RequestGuardPolicy) {}

  /**
   * The response that refuses `req`, or null when it may proceed. Call it
   * before routing, WebSocket upgrades and CORS preflights included.
   */
  reject(req: Request): Response | null {
    const { allowedHosts, allowedOrigins } = this.policy;
    if (allowedHosts && !hostAllowed(allowedHosts, req.headers.get("host"))) {
      return new Response("Misdirected Request", { status: 421 });
    }
    const origin = req.headers.get("origin");
    if (allowedOrigins && origin !== null && !originAllowed(allowedOrigins, origin)) {
      return new Response("Forbidden", { status: 403 });
    }
    return null;
  }

  /**
   * The CORS origin headers for a request that `reject` let through: `*`
   * when origins are not checked, otherwise the request's own Origin, with
   * `Vary: Origin` so a cache never serves one origin's answer to another.
   */
  corsOriginHeaders(req: Request): Record<string, string> {
    if (!this.policy.allowedOrigins) {
      return { "Access-Control-Allow-Origin": "*" };
    }
    const origin = req.headers.get("origin");
    if (origin === null) {
      return { Vary: "Origin" };
    }
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
}
