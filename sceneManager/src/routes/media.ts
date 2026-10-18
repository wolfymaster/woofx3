import type { Logger } from "@woofx3/common/runtime";
import { MEDIA_PROXY_PATH } from "../../contract/media-url";
import { type BarkloaderRelay, relayToBarkloader } from "./barkloader-relay";

const MEDIA_RELAY: BarkloaderRelay = {
  // What the browser may say about the bytes it wants: seeking needs both.
  forwardedRequestHeaders: ["Range", "If-Range"],
  // barkloader sets every one of these deliberately; nothing else is relayed.
  relayedResponseHeaders: [
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
    "Retry-After",
  ],
  failure: "barkloader media proxy request failed",
  loggedPath: () => `${MEDIA_PROXY_PATH}{token}`,
};

/**
 * Relays a media proxy request to barkloader, which verifies the token and
 * fetches the upstream file; the token is forwarded untouched.
 *
 * Served without CORS headers: frames load proxied media through `img`,
 * `video` and `audio` elements, which need none, and a page on another origin
 * has no business reading the bytes the engine fetched on its behalf.
 */
export async function handleMediaProxyRoute(
  req: Request,
  url: URL,
  barkloaderUrl: string,
  logger: Logger,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  return relayToBarkloader(req, url, barkloaderUrl, logger, MEDIA_RELAY, fetchFn);
}
