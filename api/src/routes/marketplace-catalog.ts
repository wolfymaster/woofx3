import {
  formatMarketplaceCatalogError,
  type MarketplaceAuthorQuery,
  type MarketplaceCatalogQuery,
} from "@woofx3/api";
import {
  authorSearchParams,
  catalogSearchParams,
  type MarketplaceClient,
  MarketplaceError,
  MarketplaceTimeoutError,
  MarketplaceUnreachableError,
} from "../marketplace-client";
import { routeModule } from "./context";

/**
 * Marketplace catalog reads through the engine.
 *
 * Each method answers with the marketplace's JSON unchanged, so a caller
 * parses it exactly as it parses the marketplace's own answer. The engine
 * adds no identity of its own: a caller acting for a buyer passes that
 * buyer's token, which is forwarded and never read, logged or stored.
 *
 * A marketplace failure is rethrown in the `marketplace_*` message format of
 * `@woofx3/api`'s `formatMarketplaceCatalogError`, because capnweb carries
 * only an error's message and the caller needs the status and code back.
 */

function requireCatalog(marketplace: MarketplaceClient | null): MarketplaceClient {
  if (!marketplace) {
    throw new Error(
      formatMarketplaceCatalogError({
        kind: "disabled",
        message: "The marketplace is turned off on this engine (marketplaceUrl is blank)",
      })
    );
  }
  return marketplace;
}

function requireId(caller: string, field: string, value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${caller}: ${field} is required`);
  }
  return value;
}

function optionalToken(caller: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${caller}: buyerToken must be a string`);
  }
  return value;
}

/** Runs one marketplace read, rethrowing its failure in the catalog error format. */
async function passThrough(read: () => Promise<unknown>): Promise<unknown> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof MarketplaceError) {
      throw new Error(
        formatMarketplaceCatalogError({
          kind: "http",
          status: err.status,
          code: err.code || "unknown",
          message: err.detail || err.message,
        })
      );
    }
    if (err instanceof MarketplaceTimeoutError) {
      throw new Error(formatMarketplaceCatalogError({ kind: "timeout", message: err.message }));
    }
    if (err instanceof MarketplaceUnreachableError) {
      throw new Error(formatMarketplaceCatalogError({ kind: "unreachable", message: err.message }));
    }
    throw err;
  }
}

export const marketplaceCatalogRoutes = routeModule({
  async marketplaceSearch(query: MarketplaceCatalogQuery, buyerToken?: string): Promise<unknown> {
    const caller = "marketplaceSearch";
    const params = catalogSearchParams(caller, query);
    const token = optionalToken(caller, buyerToken);
    const marketplace = requireCatalog(this.marketplace);
    return await passThrough(() => marketplace.searchCatalog(params, token));
  },

  async marketplaceCounts(buyerToken?: string): Promise<unknown> {
    const token = optionalToken("marketplaceCounts", buyerToken);
    const marketplace = requireCatalog(this.marketplace);
    return await passThrough(() => marketplace.catalogCounts(token));
  },

  async marketplaceGetListing(listingId: string, buyerToken?: string): Promise<unknown> {
    const caller = "marketplaceGetListing";
    const id = requireId(caller, "listingId", listingId);
    const token = optionalToken(caller, buyerToken);
    const marketplace = requireCatalog(this.marketplace);
    return await passThrough(() => marketplace.catalogListing(id, token));
  },

  async marketplaceGetAuthor(slug: string, query?: MarketplaceAuthorQuery, buyerToken?: string): Promise<unknown> {
    const caller = "marketplaceGetAuthor";
    const id = requireId(caller, "slug", slug);
    const params = authorSearchParams(caller, query);
    const token = optionalToken(caller, buyerToken);
    const marketplace = requireCatalog(this.marketplace);
    return await passThrough(() => marketplace.author(id, params, token));
  },

  async marketplaceQuote(listingId: string, buyerToken: string): Promise<unknown> {
    const caller = "marketplaceQuote";
    const id = requireId(caller, "listingId", listingId);
    // A quote is about a buyer, and the engine holds no marketplace
    // credential of its own to ask on anyone's behalf.
    const token = requireId(caller, "buyerToken", buyerToken);
    const marketplace = requireCatalog(this.marketplace);
    return await passThrough(() => marketplace.quote(id, token));
  },
});
