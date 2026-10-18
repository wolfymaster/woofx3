# Marketplace catalog

The engine can read the marketplace catalog for a caller: search, the per-type counts, one listing, an author page, and a buyer's quote. Each method answers with the marketplace's JSON **unchanged**, so a caller that already parses the marketplace's answers parses the engine's the same way. Moving a caller's reads behind the engine changes where they come from and nothing else.

The methods are behind capability `marketplace.catalog` (see [Engine capabilities](./engine-capabilities.md)):

```ts
marketplaceSearch(query: MarketplaceCatalogQuery, buyerToken?): Promise<unknown>           // GET /catalog
marketplaceCounts(buyerToken?): Promise<unknown>                                           // GET /catalog/counts
marketplaceGetListing(listingId, buyerToken?): Promise<unknown>                            // GET /catalog/{id}
marketplaceGetAuthor(slug, query?: MarketplaceAuthorQuery, buyerToken?): Promise<unknown>  // GET /authors/{slug}
marketplaceQuote(listingId, buyerToken): Promise<unknown>                                  // GET /catalog/{id}/quote
```

The query types and the error helpers are in `shared/clients/typescript/api/marketplace-catalog.ts`. The routes are in `api/src/routes/marketplace-catalog.ts`, and they share the HTTP client, `api/src/marketplace-client.ts`, and its `marketplaceUrl` setting with [Marketplace installs](./marketplace-install.md).

## Query parameters

`MarketplaceCatalogQuery` uses the marketplace's own parameter names: `q`, `type` (an array, sent comma-separated), `category`, `author`, `featured`, `sort`, `limit` and `offset`. `MarketplaceAuthorQuery` is `limit` and `offset`. The quote and the counts take none.

- **Unknown keys are refused** before anything is sent. The engine builds the query string itself, so a caller can only send the marketplace the parameters it reads. A caller cannot slip in a `buyerRef`, for example. A misspelt filter is an error, not a filter that is silently ignored and returns the whole catalog.
- **Shapes are checked**: strings are strings, `type` is an array of strings, `featured` is a boolean, and `limit` and `offset` are integers.
- **Values are the marketplace's call.** The engine forwards a `type` or `sort` it has never heard of, and the marketplace refuses an unknown one with `400 invalid_request`. Engines update far more slowly than the marketplace, so a list kept in the engine would hide every new listing type or sort order from older engines until they updated.
- An empty string, an empty `type` list and `featured: false` send nothing, which is what they mean to the marketplace.
- Path segments (`listingId`, `slug`) are URL-encoded, so an id cannot reach another route.

## Buyer tokens

Every read takes an optional buyer token, which the engine forwards as the bearer and never parses, logs or stores. On the browse reads, a token with the `tier: "dev"` claim reveals dev-tier listings. A token without it reads exactly what an anonymous caller reads. An invalid or expired token gets the marketplace's 401, even though the read would work anonymously.

`marketplaceQuote` requires a token. A quote is about one buyer, and the engine has no credential to ask on anyone's behalf. The token names the buyer, so no `buyerRef` is sent.

A marketplace that predates buyer tokens answers any token with 401. A caller should send one only to a marketplace that accepts it.

## Errors

capnweb carries only an error's message across the wire, so a marketplace failure is thrown with a message in a fixed format. `parseMarketplaceCatalogError(err)` in `@woofx3/api` reads it back. The engine writes it with `formatMarketplaceCatalogError`, so the two cannot drift.

| `kind` | Message | When |
|---|---|---|
| `http` | `marketplace_http status=404 code=listing_not_found: listing not found` | The marketplace answered with a non-2xx. `code` and `message` come from its `{"error": {"code", "message"}}` envelope. `code` is `unknown` when the body was not an envelope, and the message then names the status. |
| `timeout` | `marketplace_timeout: …` | No answer within 10 seconds. |
| `unreachable` | `marketplace_unreachable: …` | No response at all, for example DNS, a refused connection, TLS or a redirect. The engine never follows redirects. |
| `disabled` | `marketplace_disabled: …` | `marketplaceUrl` is blank. Nothing is sent. |

`parseMarketplaceCatalogError` returns null for anything else: a refused argument, a 2xx body that is not JSON, or an engine fault. A caller should treat those as bugs.

A missing listing, a dev-tier listing and an unpublished listing all return the same 404 `listing_not_found`, and an unknown author returns 404 `author_not_found`. That matches the marketplace's rule that a 404 never confirms an id.
