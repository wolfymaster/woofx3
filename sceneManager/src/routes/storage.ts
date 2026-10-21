import type { Logger } from "@woofx3/common/runtime";
import { type BarkloaderRelay, relayToBarkloader } from "./barkloader-relay";
import { jsonError } from "./http-kit";
import { INERT_DOCUMENT_HEADERS } from "./security-headers";

/**
 * `/assets/modules/{module}/{version}/widgets/...` and `.../themes/...` are
 * the files a widget frame executes or renders: its scripts, stylesheets,
 * fonts and media are subresources of a frame that is itself sandboxed (see
 * the frame CSP in @woofx3/widget-host/frame), and barkloader's frame
 * endpoint hands the entry document over inline. They are the module's own
 * code, installed by an operator, so they are served as they are. The match
 * is on the raw path, so an encoded variant barkloader would still resolve
 * to the same file fails to match and gets the inert headers instead.
 * Mirrors `is_widget_bundle_key` in barkloader/app/src/routes/assets.rs.
 */
const FRAME_BUNDLE_PATH = /^\/assets\/modules\/[^/]+\/[^/]+\/(?:widgets|themes)\//;

/**
 * Everything else under /assets/ -- user uploads and the rest of a module's
 * files -- is stored content that must not run as a page on this origin.
 */
export function isInertAssetPath(pathname: string): boolean {
  return !FRAME_BUNDLE_PATH.test(pathname);
}

const STORAGE_ASSET_RELAY: BarkloaderRelay = {
  forwardedRequestHeaders: [],
  relayedResponseHeaders: ["Location", "Content-Type", "Cache-Control"],
  failure: "barkloader asset request failed",
  loggedPath: (url) => url.pathname,
  responseHeaders: (url) => (isInertAssetPath(url.pathname) ? { ...INERT_DOCUMENT_HEADERS } : {}),
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
  return relayToBarkloader(req, url, barkloaderUrl, logger, STORAGE_ASSET_RELAY, fetchFn);
}

/**
 * Largest upload relayed to barkloader. Must match
 * `MAX_PROXIED_UPLOAD_BYTES` in barkloader/app/src/routes/resources.rs:
 * refusing here first means an oversized upload is turned away before any
 * of its bytes are streamed on.
 */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

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
  const declaredLength = req.headers.get("Content-Length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      return jsonError(400, "invalid_content_length");
    }
    if (Number(declaredLength) > MAX_UPLOAD_BYTES) {
      return jsonError(413, "too_large");
    }
  }

  return relayToBarkloader(req, url, barkloaderUrl, logger, UPLOAD_RELAY, fetchFn);
}
