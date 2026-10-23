import { createHash } from "node:crypto";
import { comparableOriginOf } from "@woofx3/common/http/request-guard";
import type { SharedLogger } from "@woofx3/common/logging";
import type * as clientPb from "@woofx3/db/client.pb";
import type { DbClient } from "./db-client";

/** How long an accepted pair of credentials is trusted without asking db-proxy again. */
export const CLIENT_AUTH_CACHE_TTL_MS = 60_000;

/**
 * What db-proxy said about a pair of credentials. A failure to ask it is not
 * a verdict: `validate` throws instead, so a transient outage is never
 * mistaken for credentials that will never work.
 */
export type ClientAuthVerdict =
  | {
      kind: "accepted";
      description: string;
      /**
       * The web origin the client may authenticate from, in comparable form
       * (`comparableOriginOf`), for a client a browser paired; null for a
       * registered client, which may authenticate from anywhere.
       */
      boundOrigin: string | null;
    }
  | { kind: "refused" };

interface CacheEntry {
  verdict: ClientAuthVerdict & { kind: "accepted" };
  expiresAt: number;
}

export class ClientAuth {
  /**
   * Accepted credentials only, keyed by the client id and a hash of the
   * secret presented, so a cached success never admits another secret and a
   * wrong secret never changes the answer for the right one. Refusals are not
   * cached: each costs one db-proxy call, and caching one would let anyone
   * who knows a client id lock that client out.
   */
  private cache = new Map<string, CacheEntry>();
  /**
   * Bumped by every `invalidateCache`. A validation that was already asking
   * db-proxy when the cache was cleared may carry a verdict from before the
   * change that cleared it, so it is answered but not cached.
   */
  private epoch = 0;

  constructor(
    private db: Pick<DbClient, "validateClient">,
    private logger: SharedLogger,
    private now: () => number = () => Date.now()
  ) {}

  /** Throws when db-proxy cannot be asked or answers with anything but a verdict. */
  async validate(clientId: string, clientSecret: string): Promise<ClientAuthVerdict> {
    if (!clientId || !clientSecret) {
      return { kind: "refused" };
    }

    const key = cacheKey(clientId, clientSecret);
    const now = this.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.verdict;
    }

    const epoch = this.epoch;
    let resp: Awaited<ReturnType<DbClient["validateClient"]>>;
    try {
      resp = await this.db.validateClient(clientId, clientSecret);
    } catch (err) {
      throw new Error(
        `could not validate client credentials with db-proxy: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const code = resp.status?.code;
    if (code === "OK" && resp.client) {
      const verdict = {
        kind: "accepted",
        description: resp.client.description,
        boundOrigin: boundOriginOf(clientId, resp.client),
      } as const;
      if (epoch === this.epoch) {
        this.cache.set(key, { verdict, expiresAt: now + CLIENT_AUTH_CACHE_TTL_MS });
      }
      this.logger.info("Auth: Client validated", { clientId, description: resp.client.description });
      return verdict;
    }
    if (code === "NOT_FOUND") {
      this.logger.warn("Auth: Invalid client credentials", { clientId });
      return { kind: "refused" };
    }
    throw new Error(`db-proxy answered client validation with ${code ?? "no status"}`);
  }

  invalidateCache(): void {
    this.epoch += 1;
    this.cache.clear();
    this.logger.debug("Client auth cache invalidated");
  }
}

/**
 * The origin a validated client is bound to, from db-proxy's kind and origin.
 * Throws on a combination db-proxy's constraints rule out: admitting such a
 * client unbound would let a paired browser's secret work from any origin.
 */
function boundOriginOf(clientId: string, client: Pick<clientPb.Client, "kind" | "origin">): string | null {
  switch (client.kind) {
    case "CLIENT_KIND_REGISTERED":
      return null;
    case "CLIENT_KIND_PAIRED": {
      const origin = comparableOriginOf(client.origin);
      if (origin === null) {
        throw new Error(`paired client ${clientId} has no usable origin: ${JSON.stringify(client.origin)}`);
      }
      return origin;
    }
    default:
      throw new Error(`client ${clientId} has kind ${client.kind}, which db-proxy never stores`);
  }
}

function cacheKey(clientId: string, clientSecret: string): string {
  const secretHash = createHash("sha256").update(clientSecret).digest("hex");
  return `${clientId}:${secretHash}`;
}
