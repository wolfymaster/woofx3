import { createHash } from "node:crypto";
import type { SharedLogger } from "@woofx3/common/logging";
import type { DbClient } from "./db-client";

/** How long a successful credential check is reused before the db proxy is asked again. */
export const DEFAULT_AUTH_CACHE_TTL_MS = 60_000;

export interface AuthenticatedClient {
  description: string | null;
  callbackUrl: string | null;
  callbackToken: string | null;
}

/**
 * Why a credential check did not admit the caller. `invalid_credentials` is
 * the db proxy's answer; `auth_unavailable` means it could not be asked, so
 * the same credentials may well succeed on a retry.
 */
export type AuthFailure = { kind: "invalid_credentials" } | { kind: "auth_unavailable"; message: string };

export type AuthResult = { ok: true; value: AuthenticatedClient } | { ok: false; error: AuthFailure };

export interface ClientAuthOptions {
  ttlMs: number;
  now?: () => number;
}

interface CacheEntry {
  clientId: string;
  client: AuthenticatedClient;
  expiresAt: number;
}

/**
 * Cache key for one credential pair. The secret is hashed so the cache never
 * holds it in the clear, and is part of the key so a cached success for one
 * secret never admits another.
 */
function credentialKey(clientId: string, clientSecret: string): string {
  return `${clientId}:${createHash("sha256").update(clientSecret).digest("hex")}`;
}

/**
 * Checks client credentials against the db proxy, reusing a success for
 * `ttlMs`. Only successes are cached: a wrong secret must not lock the real
 * one out, and an unreachable db proxy must not read as a wrong secret.
 */
export class ClientAuth {
  private readonly cache = new Map<string, CacheEntry>();
  /** Every cache key held for a client id, so one client can be dropped without clearing the rest. */
  private readonly keysByClient = new Map<string, Set<string>>();
  /**
   * Bumped by invalidateCache. A check records the generation before asking
   * the db proxy and caches its success only if it is unchanged, so an
   * invalidation that lands while the check is in flight is not undone.
   */
  private readonly generations = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly db: DbClient,
    private readonly logger: SharedLogger,
    options: ClientAuthOptions
  ) {
    if (!Number.isInteger(options.ttlMs) || options.ttlMs <= 0) {
      throw new Error(`ClientAuth: ttlMs must be a positive integer, got ${options.ttlMs}`);
    }
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? (() => Date.now());
  }

  async validate(clientId: string, clientSecret: string): Promise<AuthResult> {
    if (!clientId || !clientSecret) {
      return { ok: false, error: { kind: "invalid_credentials" } };
    }

    const key = credentialKey(clientId, clientSecret);
    const cached = this.cache.get(key);
    if (cached) {
      if (cached.expiresAt > this.now()) {
        return { ok: true, value: cached.client };
      }
      this.forget(key, clientId);
    }

    const generation = this.generation(clientId);
    let resp: Awaited<ReturnType<DbClient["validateClient"]>>;
    try {
      resp = await this.db.validateClient(clientId, clientSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn("Auth: could not reach the db proxy to validate a client", { error: message });
      this.logger.debug("Auth: validation unavailable for client", { clientId });
      return { ok: false, error: { kind: "auth_unavailable", message } };
    }

    const code = resp.status?.code;
    if (code === "NOT_FOUND") {
      this.logger.warn("Auth: invalid client credentials");
      this.logger.debug("Auth: invalid credentials for client", { clientId });
      return { ok: false, error: { kind: "invalid_credentials" } };
    }
    // Only NOT_FOUND is the db proxy rejecting the credentials. Any other
    // answer (a database error, a missing client record) says nothing about
    // them, so it must not tell the caller to stop retrying.
    if (code !== "OK" || !resp.client) {
      const message = `db proxy answered client validation with ${code ?? "no status"}`;
      this.logger.warn("Auth: db proxy gave no verdict on a client", { status: code ?? null });
      this.logger.debug("Auth: validation unavailable for client", { clientId });
      return { ok: false, error: { kind: "auth_unavailable", message } };
    }

    const client: AuthenticatedClient = {
      description: resp.client.description,
      callbackUrl: resp.client.callbackUrl,
      callbackToken: resp.client.callbackToken,
    };
    if (this.generation(clientId) === generation) {
      this.remember(key, clientId, client);
    }
    this.logger.debug("Auth: client validated", { clientId, description: client.description });
    return { ok: true, value: client };
  }

  /** Drop every cached success for `clientId`, such as when the client is deleted. */
  invalidateCache(clientId: string): void {
    this.generations.set(clientId, this.generation(clientId) + 1);
    const keys = this.keysByClient.get(clientId);
    if (!keys) {
      return;
    }
    for (const key of keys) {
      this.cache.delete(key);
    }
    this.keysByClient.delete(clientId);
    this.logger.debug("Client auth cache invalidated", { clientId });
  }

  private generation(clientId: string): number {
    return this.generations.get(clientId) ?? 0;
  }

  /**
   * Caches a success and drops this client's expired entries, so a secret
   * that is never presented again does not stay in the cache once a newer
   * one for the same client has been checked.
   */
  private remember(key: string, clientId: string, client: AuthenticatedClient): void {
    const now = this.now();
    let keys = this.keysByClient.get(clientId);
    if (!keys) {
      keys = new Set();
      this.keysByClient.set(clientId, keys);
    }
    for (const held of keys) {
      const entry = this.cache.get(held);
      if (!entry || entry.expiresAt <= now) {
        this.cache.delete(held);
        keys.delete(held);
      }
    }
    this.cache.set(key, { clientId, client, expiresAt: now + this.ttlMs });
    keys.add(key);
  }

  private forget(key: string, clientId: string): void {
    this.cache.delete(key);
    const keys = this.keysByClient.get(clientId);
    if (!keys) {
      return;
    }
    keys.delete(key);
    if (keys.size === 0) {
      this.keysByClient.delete(clientId);
    }
  }
}
