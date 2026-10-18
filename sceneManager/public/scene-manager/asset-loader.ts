// Reads the files widgets ask for (`widgetHost.assets.load`) and the files
// their settings name, ahead of the ask.
//
// A widget's frame is sandboxed with an opaque origin, so a stored file's
// presigned storage URL refuses its script (no CORS headers). The page reads
// the file instead, from the engine's read route on its own origin (see
// src/routes/asset-read.ts), and posts the bytes into the frame through the
// bridge. Deciding what a widget may read happens here, because the page
// knows each frame's module from the scene record and never from the widget:
// any file in the asset library, and its own module's files (the rules are
// module-sdk's `parseEngineAssetPath` and `widgetMayRead`).
//
// One cache serves the whole page, so a file several placements or alerts use
// at once is read once. Files a placement's settings name are read as soon as
// the placement is known, while its frame is still loading, so the widget's
// ask usually finds them already here.

import {
  type WidgetAssetErrorCode,
  assetReadPath,
  engineAssetPath,
  parseEngineAssetPath,
  widgetMayRead,
} from "@woofx3/module-sdk";

/**
 * How long a file read stays here after it arrives: long enough for the ask a
 * read-ahead was for, and for the placements and alerts that use one file at
 * once. After that the browser's own cache answers, which revalidates an
 * upload (it can be replaced under the same path) and costs no download while
 * it is unchanged; holding files for the life of an overlay that runs for
 * days would grow without bound and keep serving a replaced upload.
 */
export const ASSET_RETAIN_MS = 60_000;

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
 * The files the page is reading, and has read in the last `retainMs`, by
 * engine path. A read that fails is forgotten at once, so the next ask tries
 * again.
 */
export class AssetCache {
  private readonly entries = new Map<string, Promise<LoadedAsset>>();
  private readonly fetchFn: (url: string, init: RequestInit) => Promise<Response>;

  constructor(
    fetchFn?: (url: string, init: RequestInit) => Promise<Response>,
    private readonly retainMs: number = ASSET_RETAIN_MS
  ) {
    // Bound to the global for the same reason SceneEventSource binds it: a
    // bare `fetch` called as `this.fetchFn(...)` throws "Illegal invocation"
    // in the browser, before any request is sent.
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /** The file at `path`, read once for every ask while it is held. */
  load(path: string): Promise<LoadedAsset> {
    const held = this.entries.get(path);
    if (held !== undefined) {
      return held;
    }
    const reading = this.read(path);
    this.entries.set(path, reading);
    const forget = (): void => {
      if (this.entries.get(path) === reading) {
        this.entries.delete(path);
      }
    };
    reading.then(() => setTimeout(forget, this.retainMs), forget);
    return reading;
  }

  /** How many files are held or being read; diagnostic and test use. */
  size(): number {
    return this.entries.size;
  }

  /**
   * Start reading the files a widget of `moduleId` may read among `paths`, so
   * its ask finds them here. Failures are left for the ask to report.
   */
  readAhead(paths: readonly string[], moduleId: string): void {
    for (const path of paths) {
      if (readable(path, moduleId)) {
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
      if (!readable(path, moduleId)) {
        return Promise.reject(new AssetLoadError("out_of_scope", path));
      }
      return this.load(path);
    };
  }

  private async read(path: string): Promise<LoadedAsset> {
    let response: Response;
    try {
      const asset = parseEngineAssetPath(path);
      if (asset === null) {
        throw new AssetLoadError("not_engine_asset", path);
      }
      response = await this.fetchFn(assetReadPath(asset), {
        credentials: "same-origin",
      });
    } catch (err) {
      console.warn("[scene-manager] asset read failed", { path }, err);
      throw new AssetLoadError("unavailable", path);
    }
    if (response.status === 404) {
      throw new AssetLoadError("not_found", path);
    }
    if (!response.ok) {
      console.warn("[scene-manager] asset read refused", { path, status: response.status });
      throw new AssetLoadError("unavailable", path);
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch (err) {
      console.warn("[scene-manager] asset read cut short", { path }, err);
      throw new AssetLoadError("unavailable", path);
    }
    return { contentType: response.headers.get("Content-Type") ?? "", bytes };
  }
}

function readable(path: string, moduleId: string): boolean {
  const asset = parseEngineAssetPath(path);
  return asset !== null && widgetMayRead(asset, moduleId);
}
