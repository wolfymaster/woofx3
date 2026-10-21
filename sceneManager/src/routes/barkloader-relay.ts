import type { Logger } from "@woofx3/common/runtime";

/** How a request is relayed to barkloader and its answer passed back. */
export interface BarkloaderRelay {
  /** The method sent on; a `PUT` streams the request body through unread. Defaults to `GET`. */
  method?: "GET" | "PUT";
  /** Request headers passed on to barkloader; nothing else of the request is. */
  forwardedRequestHeaders: readonly string[];
  /** Response headers passed back to the browser; nothing else of the response is. */
  relayedResponseHeaders: readonly string[];
  /** What the warning says when barkloader cannot be reached or refuses. */
  failure: string;
  /** The path as the warning logs it; a path carrying a credential is not logged whole. */
  loggedPath: (url: URL) => string;
  /** The barkloader path asked for; `url`'s own path by default. */
  upstreamPath?: (url: URL) => string;
  /**
   * Follow barkloader's redirect here rather than passing it back, sending the
   * forwarded headers again; a redirect from that second hop is not followed.
   * For a page that must read the bytes itself, which a redirect to presigned
   * storage (no CORS headers) would stop.
   */
  followRedirect?: boolean;
  /**
   * The upstream statuses passed back as they are; any other is logged and
   * answered 502. Every status is passed back when absent.
   */
  passStatus?: (status: number) => boolean;
  /** Headers set on every answer, over the relayed ones. */
  responseHeaders?: (url: URL) => Record<string, string>;
}

/** Statuses whose response must not carry a body. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Relays a request for `url` to barkloader, which is not browser-reachable.
 * Redirects are passed through unless the relay follows one, and the body is
 * streamed, never read, since it may be a large file either way. The one
 * place the scene manager talks HTTP to barkloader's asset routes.
 */
export async function relayToBarkloader(
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
  const method = relay.method ?? "GET";
  const upstreamUrl = `${barkloaderUrl.replace(/\/+$/, "")}${relay.upstreamPath?.(url) ?? url.pathname}`;
  const warn = (fields: Record<string, unknown>): void => {
    logger.warn(relay.failure, { path: relay.loggedPath(url), ...fields });
  };

  let upstream: Response;
  try {
    upstream = await fetchFn(upstreamUrl, {
      method,
      headers,
      redirect: "manual",
      ...(method === "PUT"
        ? // Required by the fetch spec to send a ReadableStream body without buffering it first.
          ({ body: req.body, duplex: "half" } as RequestInit)
        : {}),
    });
    const location = upstream.headers.get("Location");
    if (relay.followRedirect && upstream.status >= 300 && upstream.status < 400 && location !== null) {
      // Barkloader names where the bytes are; nothing else chooses it. Not
      // `redirect: "error"`: Bun counts a 304 as a redirect and throws, which
      // would fail every revalidation. A redirect from this hop is refused
      // below as not passed.
      upstream = await fetchFn(location, { method: "GET", headers, redirect: "manual" });
    }
  } catch (err) {
    warn({ error: err instanceof Error ? err.message : String(err) });
    return new Response(null, { status: 502 });
  }

  if (relay.passStatus && !relay.passStatus(upstream.status)) {
    warn({ status: upstream.status });
    return new Response(null, { status: 502 });
  }

  const relayed = new Headers();
  for (const name of relay.relayedResponseHeaders) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      relayed.set(name, value);
    }
  }
  for (const [name, value] of Object.entries(relay.responseHeaders?.(url) ?? {})) {
    relayed.set(name, value);
  }
  const body = NULL_BODY_STATUSES.has(upstream.status) ? null : upstream.body;
  return new Response(body, { status: upstream.status, headers: relayed });
}
