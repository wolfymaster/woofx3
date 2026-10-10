import type { Logger } from "@woofx3/common/runtime";

/** What a GET relayed to barkloader carries through, each way. */
export interface BarkloaderRelay {
  /** Request headers passed on to barkloader; nothing else of the request is. */
  forwardedRequestHeaders: readonly string[];
  /** Response headers passed back to the browser; nothing else of the response is. */
  relayedResponseHeaders: readonly string[];
  /** What the warning says when barkloader cannot be reached. */
  failure: string;
  /** The path as the warning logs it; a path carrying a credential is not logged whole. */
  loggedPath: (url: URL) => string;
}

/**
 * Relays a GET for `url`'s path to barkloader, which is not browser-reachable.
 * Redirects are passed through, never followed, and the body is streamed,
 * never read, since it may be a large file.
 */
export async function relayGetToBarkloader(
  req: Request,
  url: URL,
  barkloaderUrl: string,
  logger: Logger,
  relay: BarkloaderRelay,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  const headers = new Headers();
  for (const name of relay.forwardedRequestHeaders) {
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
    logger.warn(relay.failure, {
      path: relay.loggedPath(url),
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(null, { status: 502 });
  }
  const relayed = new Headers();
  for (const name of relay.relayedResponseHeaders) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      relayed.set(name, value);
    }
  }
  return new Response(upstream.body, { status: upstream.status, headers: relayed });
}
