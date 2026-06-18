import type { SharedLogger } from "@woofx3/common/logging";
import type { ResolveOverlayTokenRequest, ResolveOverlayTokenResponse } from "../db";

/** Successful resolution of an overlay token (design 2.1). */
export interface ResolvedOverlayToken {
  sceneId: string;
  applicationId: string;
}

/** The slice of DbClient the resolver depends on (injectable for tests). */
export interface OverlayTokenDb {
  resolveOverlayToken(req: ResolveOverlayTokenRequest): Promise<ResolveOverlayTokenResponse>;
}

export interface OverlayTokenResolverOptions {
  /** Cache TTL in milliseconds. Design 2.1 fixes this at 30s. */
  ttlMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

export const OVERLAY_TOKEN_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: ResolvedOverlayToken | null;
  expiresAt: number;
}

/**
 * Mask a token for log output (design 5.2.8): keep the `ovl_` prefix
 * plus four characters, elide the rest. Never log plaintext tokens.
 */
export function maskToken(token: string): string {
  if (token.length <= 8) {
    return `${token.slice(0, 4)}…`;
  }
  return `${token.slice(0, 8)}…`;
}

/**
 * Resolves overlay tokens via the db-proxy with a 30s TTL cache.
 *
 * Uniformity invariant (design 2.1, no enumeration oracle): revoked,
 * unknown, and transport-error cases all surface as `null` — callers
 * cannot distinguish them. Definitive misses (db answered NOT_FOUND)
 * are negatively cached for the TTL; transport errors are NOT cached
 * so a recovering db-proxy is retried on the next request.
 *
 * The NATS subscription on `db.overlay_token.updated.*` calls
 * `invalidateAll()` to poison the cache ahead of TTL expiry.
 */
export class OverlayTokenResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly db: OverlayTokenDb | null,
    private readonly logger: SharedLogger,
    opts: OverlayTokenResolverOptions = {}
  ) {
    this.ttlMs = opts.ttlMs ?? OVERLAY_TOKEN_CACHE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async resolve(token: string): Promise<ResolvedOverlayToken | null> {
    if (!token) {
      return null;
    }
    if (!this.db) {
      // No db-proxy configured: every token is unresolvable. The
      // overlay shell still renders; `./config` returns {scene:null}.
      return null;
    }

    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value;
    }

    let response: ResolveOverlayTokenResponse;
    try {
      response = await this.db.resolveOverlayToken({ token });
    } catch (err) {
      // Transport / server error: uniform null, but uncached so the
      // next request retries instead of pinning a 30s outage window.
      this.logger.warn("overlay token resolve failed", {
        token: maskToken(token),
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    const ok = response.status?.code === "OK" && !!response.sceneId && !!response.applicationId;
    const value: ResolvedOverlayToken | null = ok
      ? { sceneId: response.sceneId, applicationId: response.applicationId }
      : null;
    this.cache.set(token, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }

  /**
   * Poison the entire cache. Called from the NATS subscription on
   * `db.overlay_token.updated.*` — outbox events deliberately omit
   * the plaintext token, so per-token invalidation is impossible and
   * a full poison is the correct (and cheap) response.
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /** Drop a single cached token (e.g. after a socket-level recheck). */
  invalidate(token: string): void {
    this.cache.delete(token);
  }

  /** Cache size — test/diagnostic surface only. */
  cacheSize(): number {
    return this.cache.size;
  }
}
