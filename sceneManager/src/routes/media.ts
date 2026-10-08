import type { Logger } from "@woofx3/common/runtime";
import { MEDIA_PROXY_PATH } from "../scene/media-proxy";

/** `/assets/media/{token}`: exactly one segment, the signed upstream URL. */
const MEDIA_PATH = new RegExp(`^${MEDIA_PROXY_PATH}[^/]+$`);

/** What the browser may say about the bytes it wants: seeking needs both. */
const FORWARDED_REQUEST_HEADERS = ["Range", "If-Range"] as const;

/** barkloader sets every one of these deliberately; nothing else is relayed. */
const RELAYED_RESPONSE_HEADERS = [
  "Content-Type",
  "Content-Length",
  "Content-Range",
  "Accept-Ranges",
  "Cache-Control",
  "ETag",
  "Last-Modified",
  "X-Content-Type-Options",
  "Content-Security-Policy",
  "Referrer-Policy",
] as const;

export function isMediaProxyPath(pathname: string): boolean {
  return MEDIA_PATH.test(pathname);
}

/**
 * Relays a media proxy request to barkloader, which is not browser-reachable
 * and is the one that verifies the token and fetches the upstream file. The
 * token is forwarded untouched; the body is streamed, never read, since a
 * video may be large.
 */
export async function handleMediaProxyRoute(
  req: Request,
  url: URL,
  barkloaderUrl: string,
  logger: Logger,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  const upstreamUrl = `${barkloaderUrl.replace(/\/+$/, "")}${url.pathname}`;
  let upstream: Response;
  try {
    upstream = await fetchFn(upstreamUrl, { method: "GET", headers, redirect: "manual" });
  } catch (err) {
    logger.warn("barkloader media proxy request failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(null, { status: 502 });
  }
  const relayed = new Headers();
  for (const name of RELAYED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      relayed.set(name, value);
    }
  }
  return new Response(upstream.body, { status: upstream.status, headers: relayed });
}
