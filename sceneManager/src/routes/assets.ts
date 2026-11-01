import { join, normalize } from "node:path";
import type { BunFile } from "bun";

/**
 * The overlay's own script, whose URL the (uncached) shell renders with a
 * content version, so a browser never asks for it again until it changes.
 */
export const OVERLAY_SCRIPT_PATH = "/assets/scene-manager/index.js";

const VERSIONED_CACHE_CONTROL = "public, max-age=31536000, immutable";
const VERSION_MISMATCH_CACHE_CONTROL = "no-cache";
/**
 * For a URL with no version in it, such as the widget shim's in a frame
 * document cached for good. A browser uses its copy at once and refreshes it
 * in the background, so a page load never waits on a revalidation. The cost:
 * the first load after a sceneManager upgrade can run the previous copy.
 */
const UNVERSIONED_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=86400";

/** Content versions by file and modification time. A redeploy or rebuild changes the time. */
const contentVersions = new Map<string, { modifiedAt: number; version: string }>();

async function contentVersionOf(file: BunFile, path: string): Promise<string> {
  const known = contentVersions.get(path);
  if (known?.modifiedAt === file.lastModified) {
    return known.version;
  }
  const version = new Bun.CryptoHasher("sha256")
    .update(await file.arrayBuffer())
    .digest("base64url")
    .slice(0, 16);
  contentVersions.set(path, { modifiedAt: file.lastModified, version });
  return version;
}

/** `path` under `/assets/` with its content version; `path` itself when the file is missing. */
export async function versionedAssetUrl(path: string, publicDir: string): Promise<string> {
  const onDisk = join(normalize(publicDir), path.slice("/assets/".length));
  const file = Bun.file(onDisk);
  if (!(await file.exists())) {
    return path;
  }
  return `${path}?v=${await contentVersionOf(file, onDisk)}`;
}

/**
 * `GET /assets/*` — everything sceneManager itself serves statically:
 * the client scene-manager script and the widget-host-shim.
 * Traversal-safe: the resolved path must stay within `publicDir`.
 *
 * Widget files are not served here. Every widget, including the bundled
 * ones, is a module widget served from barkloader's repository.
 *
 * A request naming the current content version (`?v=`) is cached for good. A
 * stale version still gets the current file, uncached. Every response carries
 * the version as its `ETag`, so a revalidation costs no body.
 */
export async function handleStaticAssetRoute(req: Request, url: URL, publicDir: string): Promise<Response> {
  const root = normalize(publicDir);
  const rel = url.pathname.slice("/assets/".length);
  const safe = normalize(join(root, rel));
  if (safe !== root && !safe.startsWith(root + "/")) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(safe);
  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }
  const version = await contentVersionOf(file, safe);
  const requested = url.searchParams.get("v");
  const headers = {
    ETag: `"${version}"`,
    "Cache-Control":
      requested === null
        ? UNVERSIONED_CACHE_CONTROL
        : requested === version
          ? VERSIONED_CACHE_CONTROL
          : VERSION_MISMATCH_CACHE_CONTROL,
  };
  if (req.headers.get("If-None-Match") === headers.ETag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(file, { headers });
}
