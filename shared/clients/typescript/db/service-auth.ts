/**
 * The .woofx3.json key of the service token db-proxy requires of every
 * caller; its variable is WOOFX3_DB_PROXY_TOKEN.
 */
export const DB_PROXY_TOKEN_CONFIG_KEY = "dbProxyToken";

/**
 * How a TypeScript service reaches db-proxy: its base URL and the
 * `Authorization: Bearer <token>` header db-proxy refuses requests without.
 * The shape is a twirpscript ClientConfiguration, so it is passed as-is to the
 * generated RPC functions.
 */
export interface DbProxyClientConfig {
  baseURL: string;
  headers: Record<string, string>;
}

/**
 * The one place a TypeScript db-proxy client configuration is built. The
 * token is trimmed, the same as db-proxy and the Go and Rust clients do.
 * Throws on a blank URL or token: callers validate both at startup, so either
 * one being blank here is a wiring bug.
 */
export function dbProxyClientConfig(baseURL: string, token: string): DbProxyClientConfig {
  if (baseURL.trim() === "") {
    throw new Error("db proxy base URL is empty");
  }
  const trimmed = token.trim();
  if (trimmed === "") {
    throw new Error("db proxy service token is empty");
  }
  return { baseURL, headers: { Authorization: `Bearer ${trimmed}` } };
}
