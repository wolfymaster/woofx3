import type { Logger } from "@woofx3/common/runtime";

// Mirrors barkloader's ALLOWED_TOP_LEVEL_PREFIXES.
const STORAGE_ASSET_PREFIXES = ["/assets/modules/", "/assets/user/"] as const;

const RELAYED_HEADERS = ["Location", "Content-Type", "Cache-Control"] as const;

export function isStorageAssetPath(pathname: string): boolean {
  return STORAGE_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Relays to barkloader, which is not browser-reachable. Redirects are
 * passed through, never followed, so presigned storage bytes go straight
 * to the browser instead of through this process.
 */
export async function handleStorageAssetRoute(
  req: Request,
  url: URL,
  barkloaderUrl: string,
  logger: Logger,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(null, { status: 404 });
  }
  const upstreamUrl = `${barkloaderUrl.replace(/\/+$/, "")}${url.pathname}`;
  let upstream: Response;
  try {
    upstream = await fetchFn(upstreamUrl, { method: "GET", redirect: "manual" });
  } catch (err) {
    logger.warn("barkloader asset request failed", {
      path: url.pathname,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(null, { status: 502 });
  }
  const headers = new Headers();
  for (const name of RELAYED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
