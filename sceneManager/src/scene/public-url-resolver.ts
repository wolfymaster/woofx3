import type { Logger } from "@woofx3/common/runtime";

export const PUBLIC_URL_SETTING_KEY = "scene.publicUrl";
export const PUBLIC_URL_CACHE_TTL_MS = 30_000;

/** The slice of DbClient the resolver depends on (injectable for tests). */
export interface PublicUrlDb {
  getSetting(key: string, applicationId: string): Promise<string | null>;
}

export interface PublicUrlResolverOptions {
  ttlMs?: number;
  now?: () => number;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Resolves `scene.publicUrl` — this deployment's public base URL for
 * sceneManager itself (used to build built-in widgets' resourceBaseUrl
 * and anything else sceneManager needs an absolute self-URL for) — via
 * the db-proxy with a 30s TTL cache, falling back to the process's own
 * env-configured default.
 *
 * Never throws and never returns empty unless both the DB setting and
 * the caller-supplied default are unset.
 */
export class PublicUrlResolver {
  private cached: CacheEntry | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly defaultUrl: string;

  constructor(
    private readonly db: PublicUrlDb | null,
    defaultUrl: string,
    private readonly logger: Logger,
    opts: PublicUrlResolverOptions = {}
  ) {
    this.defaultUrl = trimTrailingSlash(defaultUrl);
    this.ttlMs = opts.ttlMs ?? PUBLIC_URL_CACHE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async resolve(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.now()) {
      return this.cached.value;
    }

    let value = this.defaultUrl;
    if (this.db) {
      try {
        const setting = await this.db.getSetting(PUBLIC_URL_SETTING_KEY, "");
        if (setting) {
          value = trimTrailingSlash(setting);
        }
      } catch (err) {
        this.logger.warn("Failed to resolve scene.publicUrl setting; using default", {
          error: err instanceof Error ? err.message : String(err),
          default: this.defaultUrl,
        });
      }
    }

    this.cached = { value, expiresAt: this.now() + this.ttlMs };
    return value;
  }
}
