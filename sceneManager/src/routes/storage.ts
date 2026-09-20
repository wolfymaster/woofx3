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

/**
 * Largest upload relayed to barkloader. Must match
 * `MAX_PROXIED_UPLOAD_BYTES` in barkloader/app/src/routes/resources.rs:
 * refusing here first means an oversized upload is turned away before any
 * of its bytes are streamed on.
 */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/** `/assets/upload/{token}`: exactly one segment, the signed grant. */
const UPLOAD_PATH = /^\/assets\/upload\/[^/]+$/;

/** The only method an upload grant is good for, plus its preflight. */
export const UPLOAD_ALLOWED_METHODS = "PUT, OPTIONS";

/** Request headers barkloader needs to validate and store the upload. */
const UPLOAD_FORWARDED_HEADERS = ["Content-Type", "Content-Length"] as const;

export function isUploadPath(pathname: string): boolean {
  return UPLOAD_PATH.test(pathname);
}

/**
 * Relays a token-guarded upload to barkloader, which issues these grants
 * on the local-disk storage backend but is not browser-reachable.
 *
 * The body is streamed rather than read: an upload may be hundreds of
 * megabytes and nothing here needs to look at it. The grant token is
 * forwarded untouched and never inspected -- barkloader holds the signing
 * secret and is the only party that can decide whether it is good.
 */
export async function handleUploadRoute(
  req: Request,
  url: URL,
  barkloaderUrl: string,
  logger: Logger,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  if (req.method !== "PUT") {
    return new Response(null, { status: 405, headers: { Allow: UPLOAD_ALLOWED_METHODS } });
  }

  const declaredLength = req.headers.get("Content-Length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      return Response.json({ success: false, error: "invalid Content-Length" }, { status: 400 });
    }
    if (Number(declaredLength) > MAX_UPLOAD_BYTES) {
      return Response.json({ success: false, error: "upload exceeds size limit" }, { status: 413 });
    }
  }

  const headers = new Headers();
  for (const name of UPLOAD_FORWARDED_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }

  const upstreamUrl = `${barkloaderUrl.replace(/\/+$/, "")}${url.pathname}`;
  let upstream: Response;
  try {
    upstream = await fetchFn(upstreamUrl, {
      method: "PUT",
      headers,
      body: req.body,
      redirect: "manual",
      // Required by the fetch spec to send a ReadableStream body without
      // buffering it first.
      duplex: "half",
    } as RequestInit);
  } catch (err) {
    logger.warn("barkloader upload request failed", {
      path: "/assets/upload/{token}",
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(null, { status: 502 });
  }

  const relayed = new Headers();
  const contentType = upstream.headers.get("Content-Type");
  if (contentType !== null) {
    relayed.set("Content-Type", contentType);
  }
  return new Response(upstream.body, { status: upstream.status, headers: relayed });
}
