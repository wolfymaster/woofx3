// Reads the files widgets ask for (`widgetHost.assets.load`) and the files
// their settings name, ahead of the ask.
//
// A widget's frame is sandboxed with an opaque origin, so a stored file's
// presigned storage URL refuses its script (no CORS headers). The page reads
// the file instead, from the engine's read route on its own origin (see
// src/routes/asset-read.ts), and posts the bytes into the frame through the
// bridge. Deciding what a widget may read happens here, because the page
// knows each frame's module from the scene record and never from the widget:
// any file in the asset library, and its own module's files.
//
// One cache serves the whole page, so a file several placements or alerts use
// is read once. Files a placement's settings name are read as soon as the
// placement is known, while its frame is still loading, so the widget's ask
// usually finds them already here.

import { type WidgetAssetErrorCode, engineAssetPath } from "@woofx3/module-sdk";

/** Must match `ASSET_READ_PREFIX` in src/routes/asset-read.ts. */
export const ASSET_READ_PREFIX = "/assets/read/";

/** Nesting deeper than any settings form produces; deeper values are not searched. */
const MAX_DEPTH = 32;

/**
 * Media kinds an element loads by URL itself, with no script reading the
 * bytes. Settings naming only these are not read ahead. Both the asset
 * library's MIME types and the dashboard's coarse kinds are recognised.
 */
const ELEMENT_LOADED_TYPE = /^(image|video|audio|font)(\/|$)/;

export interface LoadedAsset {
  contentType: string;
  bytes: ArrayBuffer;
}

export class AssetLoadError extends Error {
  constructor(
    readonly code: WidgetAssetErrorCode,
    path: string
  ) {
    super(`asset ${path}: ${code}`);
    this.name = "AssetLoadError";
  }
}

/**
 * The stable module id in a widget canonical id (`{moduleId}:widget:{id}`),
 * or null when it is not one. A versioned module key (`spotify:1.0.0:abc`)
 * gives its stable id, which is the one its files are stored under.
 */
export function moduleIdOfWidget(canonicalId: string): string | null {
  const marker = canonicalId.lastIndexOf(":widget:");
  if (marker <= 0) {
    return null;
  }
  const moduleId = canonicalId.slice(0, marker).split(":")[0] ?? "";
  return moduleId === "" ? null : moduleId;
}

/**
 * Whether a widget of module `moduleId` may read the engine file at `path`:
 * a file in the asset library (`/assets/user/{id}/...`) or one of its own
 * module's (`/assets/modules/{moduleId}/...`). Each segment is judged
 * decoded, so an encoded separator or dot segment cannot step out of either.
 */
export function assetInScope(path: string, moduleId: string): boolean {
  if (moduleId === "") {
    return false;
  }
  const segments = path.split("/");
  if (segments[0] !== "" || segments[1] !== "assets" || segments.length < 5) {
    return false;
  }
  const decoded: string[] = [];
  for (const segment of segments.slice(2)) {
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (value === "" || value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
      return false;
    }
    decoded.push(value);
  }
  if (decoded[0] === "user") {
    return true;
  }
  return decoded[0] === "modules" && decoded[1] === moduleId;
}

/**
 * Engine paths of the library files a placement's settings name that a
 * script will read rather than an element: every value the asset picker
 * stores for a library file (`{ id, url, type }`) whose type is not an
 * image, video, audio or font. A file hosted elsewhere is never read ahead.
 */
export function readAheadAssetPaths(settings: unknown, pageOrigin: string): string[] {
  const paths = new Set<string>();
  collect(settings, pageOrigin, paths, 0);
  return [...paths];
}

function collect(value: unknown, pageOrigin: string, paths: Set<string>, depth: number): void {
  if (depth > MAX_DEPTH || typeof value !== "object" || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collect(item, pageOrigin, paths, depth + 1);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id === "string" &&
    record.id !== "" &&
    record.source !== "url" &&
    typeof record.url === "string" &&
    !(typeof record.type === "string" && ELEMENT_LOADED_TYPE.test(record.type))
  ) {
    const path = engineAssetPath(record.url, pageOrigin);
    if (path !== null) {
      paths.add(path);
    }
    return;
  }
  for (const item of Object.values(record)) {
    collect(item, pageOrigin, paths, depth + 1);
  }
}

/**
 * Every file the page has read or is reading, by engine path. A read that
 * fails is forgotten, so the next ask tries again; one that succeeds is kept
 * for the life of the page; the browser's own cache is what spans reloads.
 */
export class AssetCache {
  private readonly entries = new Map<string, Promise<LoadedAsset>>();

  constructor(private readonly fetchFn: (url: string, init: RequestInit) => Promise<Response> = fetch) {}

  /** The file at `path`, read once however many times it is asked for. */
  load(path: string): Promise<LoadedAsset> {
    const held = this.entries.get(path);
    if (held !== undefined) {
      return held;
    }
    const reading = this.read(path);
    this.entries.set(path, reading);
    reading.catch(() => {
      if (this.entries.get(path) === reading) {
        this.entries.delete(path);
      }
    });
    return reading;
  }

  /**
   * Start reading the files a widget of `moduleId` may read among `paths`, so
   * its ask finds them here. Failures are left for the ask to report.
   */
  readAhead(paths: readonly string[], moduleId: string): void {
    for (const path of paths) {
      if (assetInScope(path, moduleId)) {
        this.load(path).catch(() => {});
      }
    }
  }

  /**
   * The loader a frame's bridge answers `asset.load` with: this cache,
   * limited to what a widget of `moduleId` may read.
   */
  scopedTo(moduleId: string): (path: string) => Promise<LoadedAsset> {
    return (path) => {
      if (!assetInScope(path, moduleId)) {
        return Promise.reject(new AssetLoadError("out_of_scope", path));
      }
      return this.load(path);
    };
  }

  private async read(path: string): Promise<LoadedAsset> {
    let response: Response;
    try {
      response = await this.fetchFn(`${ASSET_READ_PREFIX}${path.slice("/assets/".length)}`, {
        credentials: "same-origin",
      });
    } catch {
      throw new AssetLoadError("unavailable", path);
    }
    if (response.status === 404) {
      throw new AssetLoadError("not_found", path);
    }
    if (!response.ok) {
      throw new AssetLoadError("unavailable", path);
    }
    return { contentType: response.headers.get("Content-Type") ?? "", bytes: await response.arrayBuffer() };
  }
}
