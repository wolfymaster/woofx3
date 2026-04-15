import type { Logger } from "winston";
import type { DbClient } from "./db-client";

export interface AuthResult {
  valid: boolean;
  applicationId: string | null;
  description: string | null;
  callbackUrl: string | null;
  callbackToken: string | null;
}

interface CacheEntry {
  result: AuthResult;
  expiresAt: number;
}

export class ClientAuth {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 60_000;

  constructor(
    private db: DbClient,
    private logger: Logger
  ) {}

  async validate(clientId: string, clientSecret: string): Promise<AuthResult> {
    if (!clientId || !clientSecret) {
      return { valid: false, applicationId: null, description: null, callbackUrl: null, callbackToken: null };
    }

    const now = Date.now();
    const cached = this.cache.get(clientId);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }

    try {
      const resp = await this.db.validateClient(clientId, clientSecret);
      if (resp.status?.code === "OK" && resp.client) {
        const result: AuthResult = {
          valid: true,
          applicationId: resp.client.applicationId,
          description: resp.client.description,
          callbackUrl: resp.client.callbackUrl,
          callbackToken: resp.client.callbackToken,
        };
        this.cache.set(clientId, { result, expiresAt: now + this.ttlMs });
        this.logger.info("Auth: Client validated", { clientId, description: resp.client.description });
        return result;
      }
    } catch (err) {
      this.logger.warn("Auth: Client validation failed", { clientId, error: err instanceof Error ? err.message : String(err) });
    }

    const invalid: AuthResult = { valid: false, applicationId: null, description: null, callbackUrl: null, callbackToken: null };
    this.cache.set(clientId, { result: invalid, expiresAt: now + this.ttlMs });
    this.logger.warn("Auth: Invalid client credentials", { clientId });
    return invalid;
  }

  invalidateCache(): void {
    this.cache.clear();
    this.logger.debug("Client auth cache invalidated");
  }
}
