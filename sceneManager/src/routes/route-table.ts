// The scene manager's HTTP routes as data: each says which paths and
// methods it answers and what cross-origin access it grants, and one
// dispatcher derives the rest (the preflight, 404, 405 with `Allow`, CORS on
// every answer, and a 500 for a handler that throws) the same way for all.

import { OPEN_REQUEST_GUARD_POLICY, type OpaqueOriginPolicy, RequestGuard } from "@woofx3/common/http/request-guard";
import type { Logger } from "@woofx3/common/runtime";
import { jsonError } from "./http-kit";

/**
 * - `open`: any origin may read it (OBS browser sources and sandboxed
 *   widget frames have no useful origin).
 * - `upload`: as `open`, for the upload relay's methods.
 * - `none`: no CORS headers; only same-origin pages read it.
 */
export type CorsPolicy = "open" | "upload" | "none";

/** What a handler is given besides the request. */
export interface RouteContext<TDeps> {
  url: URL;
  /** The pattern's `:name` segments, decoded. */
  params: Record<string, string>;
  deps: TDeps;
}

export interface Route<TDeps> {
  /**
   * Literal segments and `:name` params (`/scene/:sceneId/config`), or a
   * prefix ending in `/*` that answers every path below it (`/assets/*`).
   */
  path: string;
  methods: readonly string[];
  cors: CorsPolicy;
  /**
   * Whether the route admits `Origin: null` when the origin list names it.
   * Only what sandboxed widget frames load says "allow": the shim, module
   * and library assets, the media proxy, the font stylesheet and its files.
   * Firefox sends `Origin: null` from a sandboxed frame even on a plain
   * `<script src>`, so no-cors loads count, not only CORS ones. Everything
   * else refuses it, so a listed `null` opens no more of the service than
   * frames need. With no origin list every origin is admitted.
   */
  opaqueOrigin: OpaqueOriginPolicy;
  handle(req: Request, context: RouteContext<TDeps>): Promise<Response> | Response;
}

const OPEN_CORS: Readonly<Record<string, string>> = Object.freeze({
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Cross-Origin-Resource-Policy": "cross-origin",
});

/**
 * The allowed-origin headers of a request: every origin, unless the request
 * guard limits them (`RequestGuard.corsOriginHeaders`).
 */
export type CorsOrigin = Readonly<Record<string, string>>;

export const ANY_ORIGIN: CorsOrigin = Object.freeze({ "Access-Control-Allow-Origin": "*" });

/** The headers a policy grants, for a route answering `methods`, to a request from `origin`. */
export function corsHeaders(
  policy: CorsPolicy,
  methods: readonly string[],
  origin: CorsOrigin = ANY_ORIGIN
): Record<string, string> {
  switch (policy) {
    case "none":
      return {};
    case "upload":
      // Upload grants are bearer capabilities in the URL, not cookies, so
      // letting a cross-origin page use them grants nothing the token did
      // not. Which origins may is still the request guard's call.
      return { ...origin, ...OPEN_CORS, "Access-Control-Allow-Methods": [...methods, "OPTIONS"].join(", ") };
    case "open":
      return { ...origin, ...OPEN_CORS };
  }
}

interface CompiledRoute<TDeps> {
  route: Route<TDeps>;
  segments: string[];
  prefix: boolean;
}

export interface RouteTable<TDeps> {
  readonly routes: readonly CompiledRoute<TDeps>[];
}

export function routeTable<TDeps>(routes: readonly Route<TDeps>[]): RouteTable<TDeps> {
  return {
    routes: routes.map((route) => {
      const prefix = route.path.endsWith("/*");
      const path = prefix ? route.path.slice(0, -2) : route.path;
      return { route, segments: path.split("/").slice(1), prefix };
    }),
  };
}

export type RouteMatch<TDeps> =
  | { route: Route<TDeps>; params: Record<string, string> }
  | { route: null; reason: "not_found" | "bad_path" };

/**
 * The route answering `pathname`. The most specific wins whatever the order
 * routes were listed in: an exact pattern before a prefix, more literal
 * segments before fewer, a longer prefix before a shorter one.
 */
export function matchRoute<TDeps>(table: RouteTable<TDeps>, pathname: string): RouteMatch<TDeps> {
  const parts = pathname.split("/").slice(1);
  let best: { compiled: CompiledRoute<TDeps>; params: Record<string, string>; rank: number } | null = null;
  for (const compiled of table.routes) {
    const params = matchSegments(compiled, parts);
    if (params === null) {
      continue;
    }
    const literals = compiled.segments.filter((segment) => !segment.startsWith(":")).length;
    const rank = (compiled.prefix ? 0 : 10_000) + literals * 100 + compiled.segments.length;
    if (best === null || rank > best.rank) {
      best = { compiled, params, rank };
    }
  }
  if (best === null) {
    return { route: null, reason: "not_found" };
  }
  const decoded: Record<string, string> = {};
  for (const [name, value] of Object.entries(best.params)) {
    try {
      decoded[name] = decodeURIComponent(value);
    } catch {
      return { route: null, reason: "bad_path" };
    }
  }
  return { route: best.compiled.route, params: decoded };
}

function matchSegments<TDeps>(compiled: CompiledRoute<TDeps>, parts: string[]): Record<string, string> | null {
  const { segments, prefix } = compiled;
  if (prefix ? parts.length <= segments.length : parts.length !== segments.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    const part = parts[i]!;
    if (segment.startsWith(":")) {
      if (part === "") {
        return null;
      }
      params[segment.slice(1)] = part;
    } else if (segment !== part) {
      return null;
    }
  }
  return params;
}

/** The CORS headers the route answering `pathname` grants; open for a path no route answers. */
export function corsHeadersForPath<TDeps>(
  table: RouteTable<TDeps>,
  pathname: string,
  origin: CorsOrigin = ANY_ORIGIN
): Record<string, string> {
  const match = matchRoute(table, pathname);
  return match.route === null
    ? corsHeaders("open", [], origin)
    : corsHeaders(match.route.cors, match.route.methods, origin);
}

const OPEN_REQUEST_GUARD = new RequestGuard(OPEN_REQUEST_GUARD_POLICY);

/**
 * Answer `req` from `table`, once `guard.reject` has let it through: a route
 * that refuses the opaque origin answers `Origin: null` with the guard's 403,
 * without CORS headers, before its preflight or handler.
 */
export async function dispatchRoute<TDeps>(
  table: RouteTable<TDeps>,
  req: Request,
  url: URL,
  deps: TDeps,
  logger: Logger,
  guard: RequestGuard = OPEN_REQUEST_GUARD
): Promise<Response> {
  const origin = guard.corsOriginHeaders(req);
  const match = matchRoute(table, url.pathname);
  if (match.route === null) {
    return withHeaders(
      match.reason === "bad_path" ? jsonError(400, "bad_path") : jsonError(404, "not_found"),
      corsHeaders("open", [], origin)
    );
  }
  const { route, params } = match;
  if (route.opaqueOrigin === "refuse") {
    const refused = guard.rejectOpaqueOrigin(req);
    if (refused) {
      logger.warn("Request refused: the route does not admit the opaque origin", {
        route: route.path,
        method: req.method,
      });
      return refused;
    }
  }
  const cors = corsHeaders(route.cors, route.methods, origin);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (!route.methods.includes(req.method)) {
    return withHeaders(jsonError(405, "method_not_allowed"), { ...cors, Allow: route.methods.join(", ") });
  }
  try {
    return withHeaders(await route.handle(req, { url, params, deps }), cors);
  } catch (err) {
    logger.error("route handler failed", {
      route: route.path,
      method: req.method,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return withHeaders(jsonError(500, "internal"), cors);
  }
}

function withHeaders(res: Response, extra: Record<string, string>): Response {
  if (Object.keys(extra).length === 0) {
    return res;
  }
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
