import type { Logger } from "@woofx3/common/runtime";
import { assetOfReadPath } from "@woofx3/module-sdk";
import { type BarkloaderRelay, relayToBarkloader } from "./barkloader-relay";
import { INERT_DOCUMENT_HEADERS } from "./security-headers";

const ASSET_READ_RELAY: BarkloaderRelay = {
  // What lets the browser revalidate a file it holds.
  forwardedRequestHeaders: ["If-None-Match", "If-Modified-Since"],
  // What describes the file; nothing else of the storage response is relayed.
  relayedResponseHeaders: ["Content-Type", "Content-Length", "ETag", "Last-Modified"],
  failure: "asset read failed",
  loggedPath: (url) => storagePathOf(url),
  upstreamPath: (url) => storagePathOf(url),
  followRedirect: true,
  passStatus: (status) => (status >= 200 && status < 300) || status === 304 || status === 404,
  responseHeaders: (url) => ({ "Cache-Control": cacheControlFor(storagePathOf(url)), ...INERT_DOCUMENT_HEADERS }),
};

/** The stored file's own path; the handler has already checked it names one. */
function storagePathOf(url: URL): string {
  return assetOfReadPath(url.pathname)?.path ?? url.pathname;
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
  // The same judgement of the path the page made before asking.
  const asset = assetOfReadPath(url.pathname);
  if (asset === null) {
    return new Response(null, { status: 404 });
  }
  return relayToBarkloader(req, url, barkloaderUrl, logger, ASSET_READ_RELAY, fetchFn);
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
