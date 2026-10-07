// The page's cache of the media its widgets play.
//
// A widget frame is sandboxed into an opaque origin, and the browser never
// uses its HTTP cache for an opaque-origin document's requests: a widget that
// loads its own media downloads it again every time it is framed, which for
// an alert layout is every alert. The page is not sandboxed, so it fetches
// the bytes itself, through `/scene/{sceneId}/media/{key}`, and a widget asks
// for them with `host.loadMedia` (see widget-bridge.ts).
//
// Bytes are held in memory for the life of the page, and in the Cache API so
// a reloaded overlay -- or OBS started again -- has them before the first
// alert. The Cache API exists only in a secure context, which an overlay
// loaded over plain http from another machine is not; it then keeps the
// memory copy alone.

import { isMediaKey, mediaKeyOf } from "../../src/scene/media-keys";

/** Must match `MAX_MEDIA_BYTES` in src/routes/media.ts. */
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

/** Bytes held in memory before the least recently used file is let go. */
export const MAX_MEMORY_BYTES = 256 * 1024 * 1024;

/** Files fetched at once by `prefetch`, so a long manifest does not starve the widgets' own requests. */
export const PREFETCH_CONCURRENCY = 3;

export interface MediaCacheOptions {
  sceneId: string;
  sceneBase: string;
  /** What `sceneBase` resolves against; the page's own URL by default. */
  pageUrl?: string;
  fetchFn?: typeof fetch;
  /** Bytes held in memory; `MAX_MEMORY_BYTES` by default. */
  maxMemoryBytes?: number;
  /** `globalThis.caches`, or null where the Cache API does not exist. */
  cacheStorage?: CacheStorage | null;
  /** Logs a fetch that failed, which otherwise only shows as a widget loading its URL itself. */
  warn?: (message: string, detail: Record<string, unknown>) => void;
}

export class MediaCache {
  private readonly memory = new Map<string, Blob>();
  private memoryBytes = 0;
  private readonly inFlight = new Map<string, Promise<Blob | null>>();
  private readonly fetchFn: typeof fetch;
  private readonly cacheName: string;
  private readonly cacheStorage: CacheStorage | null;

  constructor(private readonly opts: MediaCacheOptions) {
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.cacheName = `woofx3-media:${opts.sceneId}`;
    this.cacheStorage = opts.cacheStorage === undefined ? defaultCacheStorage() : opts.cacheStorage;
  }

  /** The bytes a widget's media URL names, or null when this cache does not serve that URL. */
  async load(url: string): Promise<Blob | null> {
    const key = mediaKeyOf(url);
    return key === null ? null : this.get(key);
  }

  /** The bytes stored under a repository key, fetched once however many widgets ask. */
  get(key: string): Promise<Blob | null> {
    if (!isMediaKey(key)) {
      return Promise.resolve(null);
    }
    const held = this.memory.get(key);
    if (held !== undefined) {
      this.memory.delete(key);
      this.memory.set(key, held);
      return Promise.resolve(held);
    }
    const pending = this.inFlight.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const loading = this.fetchKey(key).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, loading);
    return loading;
  }

  /** Start fetching `keys`, a few at a time. Never rejects: a file that fails is fetched again when asked for. */
  async prefetch(keys: readonly string[]): Promise<void> {
    const queue = keys.filter((key) => !this.memory.has(key));
    const workers = Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, async () => {
      for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
        await this.get(key);
      }
    });
    await Promise.all(workers);
  }

  /**
   * Drop every persisted file not in `keep`, the scene's manifest, so the
   * persisted set stays as large as what the scene can play rather than
   * everything it ever played.
   */
  async prune(keep: readonly string[]): Promise<void> {
    if (this.cacheStorage === null) {
      return;
    }
    const kept = new Set(keep.map((key) => this.mediaUrl(key)));
    try {
      const cache = await this.cacheStorage.open(this.cacheName);
      for (const request of await cache.keys()) {
        if (!kept.has(request.url)) {
          await cache.delete(request);
        }
      }
    } catch (err) {
      this.warn("media cache prune failed", { error: errorMessage(err) });
    }
  }

  private async fetchKey(key: string): Promise<Blob | null> {
    const url = this.mediaUrl(key);
    const persisted = await this.readPersisted(url);
    if (persisted !== null) {
      this.remember(key, persisted);
      return persisted;
    }
    let response: Response;
    try {
      response = await this.fetchFn(url, { credentials: "same-origin" });
    } catch (err) {
      this.warn("media fetch failed", { key, error: errorMessage(err) });
      return null;
    }
    if (!response.ok) {
      // 413 is a file too large to cache, which the widget plays from its URL.
      if (response.status !== 413) {
        this.warn("media fetch refused", { key, status: response.status });
      }
      await response.body?.cancel();
      return null;
    }
    let blob: Blob;
    try {
      blob = await response.blob();
    } catch (err) {
      this.warn("media download failed", { key, error: errorMessage(err) });
      return null;
    }
    if (blob.size > MAX_MEDIA_BYTES) {
      return null;
    }
    this.remember(key, blob);
    await this.persist(url, blob);
    return blob;
  }

  private remember(key: string, blob: Blob): void {
    this.memory.set(key, blob);
    this.memoryBytes += blob.size;
    for (const [oldest, held] of this.memory) {
      if (this.memoryBytes <= (this.opts.maxMemoryBytes ?? MAX_MEMORY_BYTES) || oldest === key) {
        break;
      }
      this.memory.delete(oldest);
      this.memoryBytes -= held.size;
    }
  }

  private async readPersisted(url: string): Promise<Blob | null> {
    if (this.cacheStorage === null) {
      return null;
    }
    try {
      const cache = await this.cacheStorage.open(this.cacheName);
      const hit = await cache.match(url);
      return hit ? await hit.blob() : null;
    } catch {
      return null;
    }
  }

  private async persist(url: string, blob: Blob): Promise<void> {
    if (this.cacheStorage === null) {
      return;
    }
    try {
      const cache = await this.cacheStorage.open(this.cacheName);
      await cache.put(url, new Response(blob, { headers: { "Content-Type": blob.type } }));
    } catch (err) {
      // Over the origin's storage quota, most likely; the memory copy still serves this page.
      this.warn("media cache write failed", { error: errorMessage(err) });
    }
  }

  private mediaUrl(key: string): string {
    const path = `${this.opts.sceneBase}/media/${key.split("/").map(encodeURIComponent).join("/")}`;
    return new URL(path, this.opts.pageUrl ?? location.href).toString();
  }

  private warn(message: string, detail: Record<string, unknown>): void {
    this.opts.warn?.(`[scene-manager] ${message}`, detail);
  }
}

function defaultCacheStorage(): CacheStorage | null {
  return typeof caches === "undefined" ? null : caches;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
