import type { SharedLogger } from "@woofx3/common/logging";

/** The slice of DbClient ModuleVersionResolver depends on (injectable for tests). */
export interface ModuleVersionDb {
  getModuleKeyForModuleId(moduleId: string): Promise<string | null>;
}

export interface ModuleVersionResolverOptions {
  /** Cache TTL in milliseconds. */
  ttlMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

export const MODULE_VERSION_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

/**
 * Resolves a module's current version directory — the trailing hash
 * segment of its composite module_key (`{id}:{version}:{hash}`) — via
 * the db-proxy, with a TTL cache. Shared by `WidgetAssetProxy` (browser
 * asset requests) and `FrameAssembler` (server-side entry-HTML fetch),
 * since both need to translate a module's stable id into the
 * version-scoped storage directory barkloader currently serves its
 * files from (see barkloader's `module_install.rs` `version_dir`).
 *
 * Same pattern as `OverlayTokenResolver`: transport/lookup errors are
 * NOT cached (a recovering db-proxy is retried on the next request); a
 * definitive "module not found" answer IS cached for the TTL. A cache
 * miss during the TTL window right after an upgrade just means briefly
 * resolving to the *previous* version's (still-present, still-valid)
 * directory — never a broken or missing asset. `invalidateAll()` is
 * wired to the `db.module.installed.*` NATS subject (see
 * `nats-subscriptions.ts`) to shrink that window in practice.
 */
export class ModuleVersionResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly db: ModuleVersionDb | null,
    private readonly logger: SharedLogger,
    opts: ModuleVersionResolverOptions = {}
  ) {
    this.ttlMs = opts.ttlMs ?? MODULE_VERSION_CACHE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async resolve(moduleKey: string): Promise<string | null> {
    if (!this.db) {
      return null;
    }

    const cached = this.cache.get(moduleKey);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value;
    }

    let composite: string | null;
    try {
      composite = await this.db.getModuleKeyForModuleId(moduleKey);
    } catch (err) {
      this.logger.warn("module-version-resolver: module lookup failed", {
        moduleKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    // `composite` is `{id}:{version}:{hash}` — the version directory is
    // just the trailing hash segment (see barkloader's `version_dir`).
    const versionDir = composite ? composite.split(":").pop() || null : null;
    this.cache.set(moduleKey, { value: versionDir, expiresAt: this.now() + this.ttlMs });
    return versionDir;
  }

  /** Poison the entire cache. */
  invalidateAll(): void {
    this.cache.clear();
  }

  /** Drop a single module's cached version dir. */
  invalidate(moduleKey: string): void {
    this.cache.delete(moduleKey);
  }

  /** Cache size — test/diagnostic surface only. */
  cacheSize(): number {
    return this.cache.size;
  }
}
