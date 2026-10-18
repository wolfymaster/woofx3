import type { Logger } from "@woofx3/common/runtime";
import { type BarkloaderRelay, relayToBarkloader } from "./barkloader-relay";

const STORAGE_ASSET_RELAY: BarkloaderRelay = {
  forwardedRequestHeaders: [],
  relayedResponseHeaders: ["Location", "Content-Type", "Cache-Control"],
  failure: "barkloader asset request failed",
  loggedPath: (url) => url.pathname,
};

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
  return relayToBarkloader(req, url, barkloaderUrl, logger, STORAGE_ASSET_RELAY, fetchFn);
}

/**
 * Largest upload relayed to barkloader. Must match
 * `MAX_PROXIED_UPLOAD_BYTES` in barkloader/app/src/routes/resources.rs:
 * refusing here first means an oversized upload is turned away before any
 * of its bytes are streamed on.
 */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/** The only method an upload grant is good for, plus its preflight. */
export const UPLOAD_ALLOWED_METHODS = "PUT, OPTIONS";

const UPLOAD_RELAY: BarkloaderRelay = {
  method: "PUT",
  // What barkloader needs to validate and store the upload. Content-Length is
  // deliberately absent: the body is forwarded as a stream and the transport
  // frames it, so a length copied from the incoming request would be a promise
  // this relay cannot keep if the client goes away mid-upload.
  forwardedRequestHeaders: ["Content-Type"],
  relayedResponseHeaders: ["Content-Type"],
  failure: "barkloader upload request failed",
  // The path carries the grant, a credential.
  loggedPath: () => "/assets/upload/{token}",
};

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

  return relayToBarkloader(req, url, barkloaderUrl, logger, UPLOAD_RELAY, fetchFn);
}
