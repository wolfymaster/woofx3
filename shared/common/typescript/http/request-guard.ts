/**
 * Host and Origin checks shared by the engine's HTTP services (api,
 * sceneManager), configured by `WOOFX3_ALLOWED_HOSTS` and
 * `WOOFX3_ALLOWED_ORIGINS`.
 *
 * Both lists are off unless set. The hosted dashboard reaches engines
 * directly from several origins, so an engine that sets neither accepts
 * every Host and Origin and answers CORS with `*`.
 *
 * When a list is set:
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
 *   A bare name matches it on any port; with a port, only that port.
 *   IPv6 literals are bracketed: `[::1]`, `[::1]:8080`.
 * - Origin entries are `scheme://host[:port]`, compared as serialized web
 *   origins, so the scheme's default port may be written or left out.
 *   `scheme://host:*` matches the host on any port. The literal `null`
 *   matches the opaque origin that sandboxed frames send; nothing else does.
 */

export interface RequestGuardPolicy {
  /** Null when Host is not checked. */
  allowedHosts: readonly HostRule[] | null;
  /** Null when Origin is not checked and CORS allows any origin. */
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

export interface RequestGuardSettings {
  /** Comma-separated `WOOFX3_ALLOWED_HOSTS`; empty or undefined disables the check. */
  allowedHosts?: string | number | boolean;
  /** Comma-separated `WOOFX3_ALLOWED_ORIGINS`; empty or undefined disables the check. */
  allowedOrigins?: string | number | boolean;
}

const OPAQUE_ORIGIN = "null";

/** Allows every Host and Origin, with CORS `*`. */
export const OPEN_REQUEST_GUARD_POLICY: RequestGuardPolicy = { allowedHosts: null, allowedOrigins: null };

function splitList(value: string | number | boolean | undefined): string[] | null {
  if (value === undefined) {
    return null;
  }
  const entries = String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return entries.length === 0 ? null : entries;
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
  if (url.origin === OPAQUE_ORIGIN || hasPathOrMore || url.username !== "" || url.password !== "") {
    throw new Error(`WOOFX3_ALLOWED_ORIGINS: "${entry}" is not scheme://host[:port]`);
  }
  if (anyPort) {
    if (url.port !== "") {
      throw new Error(`WOOFX3_ALLOWED_ORIGINS: "${entry}" names both a port and :*`);
    }
    return { kind: "anyPort", protocol: url.protocol, hostname: url.hostname };
  }
  return { kind: "exact", origin: url.origin };
}

/**
 * Parses the two settings, throwing on a malformed entry so a typo fails
 * the service at startup rather than locking every client out at runtime.
 */
export function parseRequestGuardPolicy(settings: RequestGuardSettings): RequestGuardPolicy {
  const hosts = splitList(settings.allowedHosts);
  const origins = splitList(settings.allowedOrigins);
  return {
    allowedHosts: hosts ? hosts.map(parseHostRule) : null,
    allowedOrigins: origins ? origins.map(parseOriginRule) : null,
  };
}

function hostAllowed(rules: readonly HostRule[], hostHeader: string | null): boolean {
  if (hostHeader === null) {
    return false;
  }
  const parsed = splitHostPort(hostHeader.trim());
  if (!parsed) {
    return false;
  }
  return rules.some((rule) => rule.hostname === parsed.hostname && (rule.port === null || rule.port === parsed.port));
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
  return rules.some((rule) => {
    if (rule.kind === "exact") {
      return rule.origin === url.origin;
    }
    if (rule.kind === "anyPort") {
      return rule.protocol === url.protocol && rule.hostname === url.hostname;
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
