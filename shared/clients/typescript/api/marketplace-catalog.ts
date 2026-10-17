/**
 * Marketplace catalog reads through the engine: the query shapes the
 * `marketplace*` RPC methods take, and the error format they throw.
 *
 * The engine passes the marketplace's JSON through unchanged, so a caller
 * parses an answer exactly as it would parse the marketplace's own. Errors
 * cannot pass through the same way: capnweb carries only an error's message
 * across the wire, so the marketplace's status and error code travel inside
 * the message in the format below, and `parseMarketplaceCatalogError` reads
 * them back out. The engine writes with `formatMarketplaceCatalogError`, so
 * the two cannot drift.
 */

/** The listing types the marketplace serves today. */
export type MarketplaceCatalogListingType = "module" | "theme" | "emote" | "overlay" | "alert";

/** The catalog orders the marketplace serves today. */
export type MarketplaceCatalogSort = "relevance" | "newest" | "name" | "popular" | "trending";

/**
 * `GET /catalog`'s query, named as the marketplace names it.
 *
 * The engine forwards only these keys and refuses any other, but it does not
 * judge `type` or `sort` values: the marketplace refuses an unknown one with
 * 400 `invalid_request`, and an engine is updated far less often than the
 * marketplace, so a list kept here would hold back every new type or order
 * until the engine caught up.
 */
export interface MarketplaceCatalogQuery {
  /** Free text. */
  q?: string;
  /** Sent comma-separated. Empty means every type. */
  type?: MarketplaceCatalogListingType[];
  category?: string;
  /** An author's username (slug). */
  author?: string;
  /** Only curated listings, in `featuredRank` order. `false` sends nothing, which is what it means. */
  featured?: boolean;
  sort?: MarketplaceCatalogSort;
  limit?: number;
  offset?: number;
}

/** `GET /authors/{slug}`'s query: one page of the author's listings. */
export interface MarketplaceAuthorQuery {
  limit?: number;
  offset?: number;
}

/**
 * Why a catalog read failed, as `parseMarketplaceCatalogError` reports it.
 *
 * - `http`: the marketplace answered with a non-2xx. `code` is the code from
 *   its `{"error": {"code", "message"}}` envelope (`"unknown"` when the body
 *   was not one) and `message` the envelope's message, written for people.
 * - `timeout`: the marketplace did not answer in time.
 * - `unreachable`: the engine could not reach the marketplace at all.
 * - `disabled`: the engine's `marketplaceUrl` is blank; it never calls one.
 */
export type MarketplaceCatalogError =
  | { kind: "http"; status: number; code: string; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "unreachable"; message: string }
  | { kind: "disabled"; message: string };

const HTTP_PATTERN = /^marketplace_http status=(\d{3}) code=([^\s:]+): ([\s\S]*)$/;
const OTHER_PATTERN = /^marketplace_(timeout|unreachable|disabled): ([\s\S]*)$/;

/** The error message the engine throws for `error`. Inverse of `parseMarketplaceCatalogError`. */
export function formatMarketplaceCatalogError(error: MarketplaceCatalogError): string {
  if (error.kind === "http") {
    const code = /^[^\s:]+$/.test(error.code) ? error.code : "unknown";
    return `marketplace_http status=${error.status} code=${code}: ${error.message}`;
  }
  return `marketplace_${error.kind}: ${error.message}`;
}

/**
 * The marketplace failure an engine catalog read threw, or null when the
 * error is something else (a refused argument, an engine fault).
 */
export function parseMarketplaceCatalogError(err: unknown): MarketplaceCatalogError | null {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : null;
  if (message === null) {
    return null;
  }
  const http = HTTP_PATTERN.exec(message);
  if (http) {
    return { kind: "http", status: Number(http[1]), code: http[2], message: http[3] };
  }
  const other = OTHER_PATTERN.exec(message);
  if (other) {
    return { kind: other[1] as "timeout" | "unreachable" | "disabled", message: other[2] };
  }
  return null;
}
