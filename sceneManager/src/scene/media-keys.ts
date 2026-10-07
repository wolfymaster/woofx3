/**
 * The engine media a placement's settings or an alert layout reference, as
 * repository keys (`user/{resourceId}/{fileName}`, `modules/.../assets/...`).
 * The scene page fetches these into its media cache ahead of the widget that
 * plays them (see public/scene-manager/media-cache.ts).
 *
 * Settings are walked without knowing any widget's schema: a string is media
 * when it is an engine asset URL, or the `${woofx3_asset_url:<key>}` token a
 * module workflow carries until the engine resolves it. Anything else, and any
 * other expression, is not something the page could fetch ahead of time.
 */

/** Must match `MEDIA_KEY_PATTERN` in public/scene-manager/media-cache.ts. */
const MEDIA_KEY_PATTERN = /^(user|modules)\/[^?#]+$/;

const ASSET_URL_TOKEN = /^\$\{woofx3_asset_url:([^}]+)\}$/;

const ASSET_PATH_PREFIX = "/assets/";

/** How deep a settings value is walked; layouts nest a few levels at most. */
const MAX_DEPTH = 8;

/** The most keys one scene prefetches, so a huge workflow set cannot fill the page's memory. */
export const MAX_MEDIA_KEYS = 64;

/**
 * The repository key `value` names, or null. Widget bundle and theme files are
 * not media: the frame document loads them itself, from its `<base>`.
 */
export function mediaKeyOf(value: string): string | null {
  const token = ASSET_URL_TOKEN.exec(value);
  const key = token ? token[1]! : keyOfAssetUrl(value);
  if (key === null || !isMediaKey(key)) {
    return null;
  }
  return key;
}

/** Whether `key` is a repository key the media route serves. */
export function isMediaKey(key: string): boolean {
  if (!MEDIA_KEY_PATTERN.test(key)) {
    return false;
  }
  const segments = key.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  // modules/{moduleKey}/{versionDir}/widgets|themes/...
  return !(segments[0] === "modules" && (segments[3] === "widgets" || segments[3] === "themes"));
}

/** Add every media key in `value` to `into`, up to `MAX_MEDIA_KEYS`. */
export function collectMediaKeys(value: unknown, into: Set<string>, depth = 0): void {
  if (into.size >= MAX_MEDIA_KEYS || depth > MAX_DEPTH) {
    return;
  }
  if (typeof value === "string") {
    const key = mediaKeyOf(value);
    if (key !== null) {
      into.add(key);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMediaKeys(item, into, depth + 1);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      collectMediaKeys(item, into, depth + 1);
    }
  }
}

function keyOfAssetUrl(value: string): string | null {
  if (!value.includes(ASSET_PATH_PREFIX)) {
    return null;
  }
  let pathname: string;
  try {
    pathname = new URL(value).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(ASSET_PATH_PREFIX)) {
    return null;
  }
  try {
    return pathname
      .slice(ASSET_PATH_PREFIX.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}
