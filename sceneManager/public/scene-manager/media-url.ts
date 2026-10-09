// External media in placement settings, as the server and the page both see it.
//
// A `media` / `asset` setting stores an object whose `url` the widget loads:
// `{ id, name, url, type }` for a file in the engine's library, and
// `{ source: "url", name, url, type }` for a file hosted elsewhere. Themeable
// widget frames only load media from the engine's origins, so the server
// rewrites an external value's `url` to a signed engine media proxy URL
// before settings reach such a frame (see src/scene/media-proxy.ts). This
// module finds those values and reads proxy URLs; it holds no secret, so the
// page can use it to apply rewrites the server already made.
//
// Detection is by the shape the dashboard's picker stores for a file hosted
// elsewhere: an object marked `source: "url"` with an absolute http(s)
// `url`. Nothing else is rewritten: a bare string, or an object the picker
// did not make, cannot be told apart from a link or an API endpoint a
// widget calls. Library values pass through untouched; their URLs are the
// engine's.

/**
 * The path of the engine's media proxy under its public URL. Must match the
 * route in barkloader/app/src/routes/media.rs and sceneManager's relay.
 */
export const MEDIA_PROXY_PATH = "/assets/media/";

/** Nesting deeper than any settings form produces; deeper values are left as they are. */
const MAX_DEPTH = 32;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is an absolute http(s) URL. */
export function isAbsoluteHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
}

/** The URL of an external media value, or null when `value` is not one. */
export function externalMediaUrl(value: unknown): string | null {
  if (
    !isPlainObject(value) ||
    value.source !== "url" ||
    typeof value.url !== "string" ||
    !isAbsoluteHttpUrl(value.url)
  ) {
    return null;
  }
  return value.url;
}

/**
 * `value` with the `url` of every external media value in it replaced by
 * `replace(url)`; a value `replace` returns undefined for is kept. Objects and
 * arrays on the way to a replaced value are copied, everything else is shared.
 */
export function rewriteExternalMedia<T>(value: T, replace: (url: string) => string | undefined): T {
  return rewrite(value, replace, 0) as T;
}

function rewrite(value: unknown, replace: (url: string) => string | undefined, depth: number): unknown {
  if (depth > MAX_DEPTH || typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const rewritten = rewrite(item, replace, depth + 1);
      changed ||= rewritten !== item;
      return rewritten;
    });
    return changed ? next : value;
  }
  const record = value as Record<string, unknown>;
  const external = externalMediaUrl(record);
  if (external !== null) {
    const replaced = replace(external);
    return replaced === undefined || replaced === external ? record : { ...record, url: replaced };
  }
  let next: Record<string, unknown> | null = null;
  for (const [key, item] of Object.entries(record)) {
    const rewritten = rewrite(item, replace, depth + 1);
    if (rewritten !== item) {
      next ??= { ...record };
      next[key] = rewritten;
    }
  }
  return next ?? record;
}

/** Every external media URL in `value`, once each. */
export function externalMediaUrls(value: unknown): string[] {
  const urls = new Set<string>();
  rewriteExternalMedia(value, (url) => {
    urls.add(url);
    return undefined;
  });
  return [...urls];
}

/**
 * A media proxy token: `{base64url(url)}.{expiresAt}.{hex HMAC-SHA256}`. Must
 * match the format `MediaProxy.urlFor` mints (src/scene/media-proxy.ts) and
 * barkloader verifies.
 */
const MEDIA_PROXY_TOKEN = /^[A-Za-z0-9_-]+\.(\d+)\.[0-9a-f]{64}$/;

/**
 * When a media proxy URL stops working, in unix seconds, or null when `url`
 * is not one minted under `base` (a placement's `mediaProxyBase`). The page
 * reads the expiry to fetch fresh URLs before it passes (see index.ts). Only
 * URLs under the placement's own proxy base count, so an external URL that
 * merely looks like a token never schedules a refresh.
 */
export function mediaProxyExpiry(url: string, base: string): number | null {
  if (!url.startsWith(base)) {
    return null;
  }
  const match = MEDIA_PROXY_TOKEN.exec(url.slice(base.length));
  return match ? Number(match[1]) : null;
}

/**
 * The soonest a media proxy URL under `base` in `value` expires, in unix
 * seconds, or null when it holds none or the placement has no proxy base.
 */
export function earliestMediaProxyExpiry(value: unknown, base: string | undefined): number | null {
  if (base === undefined) {
    return null;
  }
  let earliest: number | null = null;
  for (const url of externalMediaUrls(value)) {
    const expiry = mediaProxyExpiry(url, base);
    if (expiry !== null && (earliest === null || expiry < earliest)) {
      earliest = expiry;
    }
  }
  return earliest;
}

/**
 * `value` with each external media value whose `url` is a key of `urls`
 * pointed at the URL it maps to. The server builds an overlay's view of a
 * placement with this (src/scene/media-proxy.ts), and the page applies the
 * proxy URLs a draft answer carries with it, so both rewrite alike.
 */
export function replaceMediaUrls<T>(value: T, urls: ReadonlyMap<string, string>): T {
  if (urls.size === 0) {
    return value;
  }
  return rewriteExternalMedia(value, (url) => urls.get(url));
}

/**
 * A draft-config answer's `mediaUrls` (placement id, then upstream URL, to
 * proxy URL), with anything not of that shape left out.
 */
export function parseMediaUrls(value: unknown): Map<string, Map<string, string>> {
  const placements = new Map<string, Map<string, string>>();
  if (!isPlainObject(value)) {
    return placements;
  }
  for (const [id, urls] of Object.entries(value)) {
    if (!isPlainObject(urls)) {
      continue;
    }
    const signed = new Map<string, string>();
    for (const [upstream, proxied] of Object.entries(urls)) {
      if (typeof proxied === "string") {
        signed.set(upstream, proxied);
      }
    }
    placements.set(id, signed);
  }
  return placements;
}
