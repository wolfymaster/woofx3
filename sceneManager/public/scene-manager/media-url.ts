// External media in placement settings, as the server and the page both see it.
//
// A `media` / `asset` setting stores an object whose `url` the widget loads:
// `{ id, name, url, type }` for a file in the engine's library, and
// `{ source: "url", name, url, type }` for a file hosted elsewhere. Themeable
// widget frames only load media from the engine's origins, so the server
// rewrites an external value's `url` to a signed engine media proxy URL
// before settings reach an overlay (see src/scene/media-proxy.ts). This
// module finds those values; it holds no secret, so the page can use it to
// apply rewrites the server already made.
//
// Detection is by shape, the same classification the dashboard's picker
// uses: an object with an absolute http(s) `url` that is marked
// `source: "url"`, or that has a `type` but no library `id`. A bare string is
// left alone: without the widget's settings schema it cannot be told apart
// from a link or an API endpoint a widget calls, and the picker never stores
// one. Library values pass through untouched; their URLs are the engine's.

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
  if (!isPlainObject(value) || typeof value.url !== "string" || !isAbsoluteHttpUrl(value.url)) {
    return null;
  }
  if (value.source === "url") {
    return value.url;
  }
  const libraryId = typeof value.id === "string" && value.id !== "";
  return !libraryId && typeof value.type === "string" ? value.url : null;
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
