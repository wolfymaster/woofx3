import type { SharedLogger } from "@woofx3/common/logging";

// Renamed from "overlay.publicUrl" to "scene.publicUrl" when
// sceneManager replaced streamware as this setting's primary owner
// (see db migration 0031_rename_overlay_public_url_setting) — same
// setting, same purpose, kept in sync here so streamware keeps
// resolving it correctly during the deprecation window.
export const OVERLAY_PUBLIC_URL_SETTING_KEY = "scene.publicUrl";
export const OVERLAY_PUBLIC_URL_CACHE_TTL_MS = 30_000;

/** The slice of DbClient the resolver depends on (injectable for tests). */
export interface OverlayPublicUrlDb {
  getSetting(key: string, applicationId: string): Promise<string | null>;
}

export interface OverlayPublicUrlResolverOptions {
  /** Cache TTL in milliseconds. Matches the 30s TTL used elsewhere for
   * this exact "DB setting with config fallback" pattern. */
  ttlMs?: number;
  /** Clock injection for tests. */
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
 * Resolves the `overlay.publicUrl` engine setting via the db-proxy with a
 * 30s TTL cache. A single global value — matches barkloader's
 * `storage.provider`/`storage.s3.*` convention (this describes the
 * deployment's own network topology, not anything per-application).
 *
 * The single public base URL for reaching this deployment's overlay
 * surface — both the token-scoped `/o/{token}/` tree (via the api
 * gateway's `/overlay/{token}/` proxy) and, via the same `/overlay/`
 * surface, every widget/module asset kind (append `/overlay/assets`
 * yourself at the call site — this resolver returns the bare base, since
 * not every consumer wants the asset suffix; see frame-assembler.ts and
 * docs/services/engine-settings-ui.md for why there's only one setting
 * here rather than a separate "asset storage" URL).
 *
 * Never throws and never returns null — a lookup failure or no db-proxy
 * client configured falls back to `defaultUrl` (this service's own
 * env-configured `WOOFX3_OVERLAY_PUBLIC_URL`). If that's also unset,
 * `defaultUrl` is an empty string — deliberately no further hardcoded
 * guess; callers get a host-less relative URL rather than a URL pointing
 * at a made-up address.
 */
export class OverlayPublicUrlResolver {
  private cached: CacheEntry | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly defaultUrl: string;

  constructor(
    private readonly db: OverlayPublicUrlDb | null,
    defaultUrl: string,
    private readonly logger: SharedLogger,
    opts: OverlayPublicUrlResolverOptions = {}
  ) {
    this.defaultUrl = trimTrailingSlash(defaultUrl);
    this.ttlMs = opts.ttlMs ?? OVERLAY_PUBLIC_URL_CACHE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async resolve(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.now()) {
      return this.cached.value;
    }

    let value = this.defaultUrl;
    if (this.db) {
      try {
        const setting = await this.db.getSetting(OVERLAY_PUBLIC_URL_SETTING_KEY, "");
        if (setting) {
          value = trimTrailingSlash(setting);
        }
      } catch (err) {
        this.logger.warn("Failed to resolve overlay.publicUrl setting; using default", {
          error: err instanceof Error ? err.message : String(err),
          default: this.defaultUrl,
        });
      }
    }

    this.cached = { value, expiresAt: this.now() + this.ttlMs };
    return value;
  }
}
