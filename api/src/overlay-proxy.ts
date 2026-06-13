import type { SharedLogger } from "@woofx3/common/logging";

// Hop-by-hop headers that must not be forwarded in either direction.
// RFC 7230 §6.1 — these are connection-specific and meaningful only for
// the immediate transport hop. Forwarding them intact breaks keep-alive
// semantics on the upstream leg and leaks transport metadata.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "trailer",
]);

// Security headers injected on every proxied HTML response so browser
// policies are enforced from the api side regardless of streamware config.
const OVERLAY_HTML_SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
};

/**
 * Mask a token for log output. Keep the first 8 characters of the
 * credential followed by an ellipsis — never log the full plaintext.
 * Short tokens (<=8 chars) keep only the first 4.
 */
export function maskToken(token: string): string {
  return token.length <= 8 ? `${token.slice(0, 4)}…` : `${token.slice(0, 8)}…`;
}

/**
 * Rewrite a public overlay path to its streamware upstream path.
 *   /overlay/{token}/...  ->  /o/{token}/...
 *
 * Returns null when the path is exactly /overlay/{token} with no trailing
 * slash — the caller should issue a 302 redirect to ./  (trailing slash)
 * before calling this.
 *
 * Asserts the path starts with /overlay/ — callers must pre-screen.
 */
export function buildUpstreamUrl(streamwareBase: string, publicPath: string): string {
  if (!publicPath.startsWith("/overlay/")) {
    throw new Error(`buildUpstreamUrl: path must start with /overlay/, got: ${publicPath}`);
  }
  // Replace the /overlay/ prefix with /o/. Everything after is verbatim.
  const upstreamPath = "/o/" + publicPath.slice("/overlay/".length);
  // Strip trailing slash from base to avoid double-slash on join.
  const base = streamwareBase.replace(/\/+$/, "");
  return base + upstreamPath;
}

/**
 * Parse an overlay WebSocket path for the pump handler.
 *
 * Recognised: /overlay/{token}/events
 *
 * Returns { upstreamUrl, token } when the path matches, or null otherwise.
 * The upstreamUrl has already had the prefix rewritten.
 */
export function parseOverlayWsPath(
  pathname: string,
  streamwareBase: string
): { upstreamUrl: string; token: string } | null {
  // Require exactly /overlay/{token}/events
  const match = pathname.match(/^\/overlay\/([^/]+)\/events$/);
  if (!match) {
    return null;
  }
  const token = match[1]!;
  // Convert http(s): → ws(s): for the upstream WebSocket URL.
  const httpUrl = buildUpstreamUrl(streamwareBase, pathname);
  const wsUrl = httpUrl.replace(/^http(s)?:\/\//, (_m, s: string | undefined) => (s ? "wss://" : "ws://"));
  return { upstreamUrl: wsUrl, token };
}

/**
 * Dumb byte-level reverse proxy for the /overlay/ namespace.
 *
 * Design invariants:
 *  - Never resolves tokens; no db-proxy calls.
 *  - Only GET and HEAD for non-WebSocket requests; POST/PUT/DELETE → 405.
 *  - Strips hop-by-hop headers in both directions.
 *  - Drops X-Woofx3-* headers from inbound public requests.
 *  - Forwards ALL non-hop-by-hop response headers verbatim —
 *    streamware's CORS / CORP headers are load-bearing for opaque-origin
 *    iframe subresources.
 *  - Injects security headers on HTML responses.
 *  - /overlay/{token} (no trailing slash) → 302 redirect to ./
 */
export async function proxyRequest(
  req: Request,
  streamwareUrl: string,
  logger: SharedLogger,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Extract the token from the path for masked logging.
  const tokenMatch = pathname.match(/^\/overlay\/([^/]+)/);
  const token = tokenMatch ? tokenMatch[1]! : "";
  const maskedToken = token ? maskToken(token) : "(none)";

  // Trailing-slash redirect: /overlay/{token} with no slash → 302 ./
  // This ensures relative asset URLs in the overlay HTML resolve correctly.
  if (tokenMatch && pathname === `/overlay/${token}`) {
    logger.debug("Overlay: redirecting bare token path to trailing-slash form", { token: maskedToken });
    return new Response(null, {
      status: 302,
      headers: { location: `./${token}/` },
    });
  }

  // Only GET and HEAD are allowed through the proxy.
  if (req.method !== "GET" && req.method !== "HEAD") {
    logger.warn("Overlay: method not allowed", { method: req.method, token: maskedToken });
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  // Build the upstream URL by rewriting /overlay/ → /o/
  const upstreamUrl = buildUpstreamUrl(streamwareUrl, pathname + url.search);

  logger.debug("Overlay: forwarding request", {
    method: req.method,
    upstreamUrl,
    token: maskedToken,
  });

  // Build forwarded request headers — strip hop-by-hop and X-Woofx3-* headers.
  const forwardHeaders = new Headers();
  for (const [name, value] of req.headers.entries()) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) {
      continue;
    }
    if (lower.startsWith("x-woofx3-")) {
      continue;
    }
    forwardHeaders.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetchFn(upstreamUrl, {
      method: req.method,
      headers: forwardHeaders,
      // Do not send a body — GET/HEAD have none.
    });
  } catch (err) {
    logger.error("Overlay: upstream fetch failed", {
      upstreamUrl,
      token: maskedToken,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response("Bad Gateway", { status: 502 });
  }

  logger.debug("Overlay: upstream responded", {
    upstreamUrl,
    status: upstream.status,
    token: maskedToken,
  });

  // Build response headers — forward all non-hop-by-hop headers verbatim.
  const responseHeaders = new Headers();
  for (const [name, value] of upstream.headers.entries()) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) {
      continue;
    }
    responseHeaders.set(name, value);
  }

  // Inject security headers on HTML responses. Detect HTML by Content-Type.
  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    for (const [k, v] of Object.entries(OVERLAY_HTML_SECURITY_HEADERS)) {
      responseHeaders.set(k, v);
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
