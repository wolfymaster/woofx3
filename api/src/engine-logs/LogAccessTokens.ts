import { createHmac, timingSafeEqual } from "node:crypto";
import type { LogAccess, LogAccessScope } from "@woofx3/api";

export interface LogAccessTokensConfig {
  /** How long a token is valid. The browser dials as soon as it has one, so seconds are enough. */
  ttlMs: number;
}

export const DEFAULT_LOG_ACCESS_TOKENS_CONFIG: LogAccessTokensConfig = { ttlMs: 60_000 };

const SCOPES: ReadonlySet<string> = new Set(["stream", "export"]);

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Signs and checks the short-lived tokens that let a browser, which cannot set
 * headers on an `EventSource` or a download link, reach the log routes. A token
 * names one scope, so a tail token cannot download the export. The key lives in
 * memory only: a restart voids every token, which is fine for a minute of life.
 */
export class LogAccessTokens {
  constructor(
    private readonly key: Uint8Array,
    private readonly now: () => number,
    private readonly config: LogAccessTokensConfig
  ) {
    if (key.length < 32) {
      throw new Error("LogAccessTokens needs a key of at least 32 bytes");
    }
    if (config.ttlMs <= 0) {
      throw new Error("LogAccessTokens ttlMs must be positive");
    }
  }

  issue(scope: LogAccessScope): LogAccess {
    if (!SCOPES.has(scope)) {
      throw new Error(`unknown log access scope ${JSON.stringify(scope)}`);
    }
    const expiresAtMs = this.now() + this.config.ttlMs;
    const payload = base64url(Buffer.from(JSON.stringify({ scope, exp: expiresAtMs })));
    return { token: `${payload}.${this.sign(payload)}`, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  /** True only for an untampered, unexpired token issued for `scope`. */
  verify(token: string, scope: LogAccessScope): boolean {
    const [payload, signature, extra] = token.split(".");
    if (payload === undefined || signature === undefined || extra !== undefined) {
      return false;
    }
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return false;
    }
    try {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        scope?: unknown;
        exp?: unknown;
      };
      return claims.scope === scope && typeof claims.exp === "number" && claims.exp > this.now();
    } catch {
      return false;
    }
  }

  private sign(payload: string): string {
    return base64url(createHmac("sha256", this.key).update(payload).digest());
  }
}
