import type { Logger } from "@woofx3/common/runtime";
import { isStorageAssetPath } from "./storage";

/**
 * Prefix of the route that reads a stored file's bytes for an overlay page.
 * `/assets/read/user/...` reads what `/assets/user/...` serves. Must match
 * `ASSET_READ_PREFIX` in public/scene-manager/asset-loader.ts.
 */
export const ASSET_READ_PREFIX = "/assets/read/";

/** Request headers that let the browser revalidate a file it holds. */
const CONDITIONAL_REQUEST_HEADERS = ["If-None-Match", "If-Modified-Since"] as const;

/** Response headers that describe the file; nothing else of the storage response is relayed. */
const RELAYED_RESPONSE_HEADERS = ["Content-Type", "Content-Length", "ETag", "Last-Modified"] as const;

export function isAssetReadPath(pathname: string): boolean {
  return pathname.startsWith(ASSET_READ_PREFIX);
}

/**
 * `GET /assets/read/{key}`: the bytes of the stored file `/assets/{key}`
 * names, for an overlay page to hand a widget that asked for them (see
 * public/scene-manager/asset-loader.ts).
 *
 * `/assets/{key}` answers with a redirect to presigned storage, which an
 * `<img>` follows without asking anyone. A script reading the bytes cannot:
 * the bucket sends no CORS headers. So this route follows the redirect here
 * and streams the bytes back on the page's own origin. It reads nothing
 * `/assets/{key}` does not already serve publicly, so it needs no session;
 * which files a widget may read is decided on the page, which knows the
 * widget's module.
 *
 * Served without CORS headers, since only the page reads it, and as a
 * sandboxed, non-sniffed document: a user's upload could be HTML, and opened
 * here directly it must not run on the origin that holds overlay sessions.
 */
export async function handleAssetReadRoute(
  req: Request,
  url: URL,
  barkloaderUrl: string,
  logger: Logger,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  const storagePath = `/assets/${url.pathname.slice(ASSET_READ_PREFIX.length)}`;
  if (!isStorageAssetPath(storagePath)) {
    return new Response(null, { status: 404 });
  }

  const conditional = new Headers();
  for (const name of CONDITIONAL_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) {
      conditional.set(name, value);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetchFn(`${barkloaderUrl.replace(/\/+$/, "")}${storagePath}`, {
      method: "GET",
      headers: conditional,
      redirect: "manual",
    });
    const location = upstream.headers.get("Location");
    if (upstream.status >= 300 && upstream.status < 400 && location !== null) {
      // Barkloader names the signed storage URL; nothing else chooses it. A
      // redirect from storage is not followed, and is refused below as not ok.
      // Not `redirect: "error"`: Bun counts a 304 as a redirect and throws,
      // which would fail every revalidation.
      upstream = await fetchFn(location, { method: "GET", headers: conditional, redirect: "manual" });
    }
  } catch (err) {
    logger.warn("asset read failed", {
      path: storagePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(null, { status: 502 });
  }

  if (upstream.status === 404) {
    return new Response(null, { status: 404 });
  }
  if (!upstream.ok && upstream.status !== 304) {
    logger.warn("asset read refused by storage", { path: storagePath, status: upstream.status });
    return new Response(null, { status: 502 });
  }

  const headers = new Headers({
    "Cache-Control": cacheControlFor(storagePath),
    "Content-Security-Policy": "sandbox",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of RELAYED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  return new Response(upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers });
}

/**
 * A module's files sit under a content-hashed version directory, so a path
 * never changes bytes and is cached for good. A user's upload can be replaced
 * under the same path, so it is revalidated on every use, which costs a
 * round trip and no bytes while it is unchanged.
 */
function cacheControlFor(storagePath: string): string {
  return storagePath.startsWith("/assets/modules/") ? "public, max-age=31536000, immutable" : "no-cache";
}
