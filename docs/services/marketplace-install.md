# Marketplace installs

The engine can install a marketplace listing by its id. It reads the listing, claims it for the buyer, downloads the archive, checks it, and installs it itself. Whatever the caller is, the engine installs only what the marketplace recorded for that listing.

The methods are behind capability `modules.marketplaceInstall` (see [Engine capabilities](./engine-capabilities.md)):

```ts
installMarketplaceListing(listingId, { approvedPermissions, approvedLocalEndpoints, buyerToken? }): Promise<MarketplaceInstallResult>
inspectMarketplaceListing(listingId, buyerToken?): Promise<MarketplaceListingInspection>
installMarketplaceBundle(listingId, buyerToken?): Promise<MarketplaceBundleInstallResult>
```

The types are in `shared/clients/typescript/api/api.ts`. The routes are in `api/src/routes/marketplace.ts`, and the HTTP client is `api/src/marketplace-client.ts`.

## Configuration

| Key (`.woofx3.json` / variable) | Default | Meaning |
|---|---|---|
| `marketplaceUrl` / `WOOFX3_MARKETPLACE_URL` | `https://marketplace.woofx3.tv` | The marketplace API. Blank turns the marketplace off: these three methods and the [catalog reads](./marketplace-catalog.md) then refuse every call. |
| `marketplaceDownloadHosts` / `WOOFX3_MARKETPLACE_DOWNLOAD_HOSTS` | `f35f44146e8730089a795954e32183e8.r2.cloudflarestorage.com` | Comma-separated hosts that archive downloads may come from. A bare host means HTTPS on the default port. An entry with a scheme (`http://127.0.0.1:9000`) is an exact origin, for a local marketplace. |

The default host is the Cloudflare R2 account endpoint where the public marketplace presigns its downloads. A marketplace with a different `R2_ACCOUNT_ID` needs its own host here. Both values are checked at startup, so a malformed one stops the api from starting instead of failing the first install.

A blank value never overrides a non-blank one from a lower source (see [Runtime](./runtime.md)). To turn installs off, set `WOOFX3_MARKETPLACE_URL` to blank and leave `marketplaceUrl` out of `.woofx3.json`.

## Buyer tokens

The engine has no marketplace credential of its own. A caller acting for a buyer passes the buyer token that the dashboard minted. An install sends it as a bearer token on `POST /catalog/{id}/acquire`, `GET /modules/{id}/download` and `GET /catalog/{id}/bundle`, and reads the listing itself (`GET /catalog/{id}`) anonymously. The [catalog reads](./marketplace-catalog.md) forward it on the browse routes and the quote. The engine never sends the token on any other route, because the marketplace answers a buyer token there with 401, and it never parses, logs or stores the token.

Without a token, the engine reads the listing and downloads anonymously. That only works for a free, public listing, and the engine does not claim the listing for anyone. A paid listing's download then fails with the marketplace's 401 or 403.

## Installing a module

`installMarketplaceListing` handles module and theme listings:

1. `GET /catalog/{id}` reads the listing's type, name and version. Other listing types are refused.
2. `POST /catalog/{id}/acquire` runs only when there is a buyer token. A 402 returns `{ status: "payment_required" }` and nothing is downloaded. Any other refusal throws.
3. `GET /modules/{id}/download` returns a presigned URL. If the response has no valid `sha256`, the engine refuses it.
4. The engine fetches the archive only from an allowed download host and never follows a redirect. The archive is capped at 50 MiB.
5. If `sizeBytes` is present, the archive's length must equal it. Its SHA-256 must always equal `sha256`.
6. The engine reads the manifest that barkloader would install from, using the same name ranking and root rules. Every permission it declares must be in `approvedPermissions`, and every `local[]` endpoint id must be in `approvedLocalEndpoints`. If not, the result is `{ status: "needs_approval", name, version, unapproved, unapprovedLocalEndpoints }` and nothing is installed. A manifest that is not JSON is refused, because nobody could review it.
7. The install key is `{listingId}:{version}:{first 7 hex of sha256}`. The dashboard stores this key and correlates install webhooks by it.
8. If that key is already installed, the engine sends `module.installed` with `alreadyInstalled: true` and returns `{ status: "installed", moduleKey, alreadyInstalled: true }`. Otherwise it hands the archive to barkloader and returns `{ status: "installed", moduleKey }`. Barkloader finishes the install asynchronously and reports it with `module.installed` or `module.install_failed`.

If the download or one of its checks fails after the key is known, the engine sends `module.install_failed` and then throws. Every install webhook that the api sends itself carries `source: "marketplace"`. Barkloader's own completion events do not have a `source`.

The engine counts every `local[]` entry that has an id, including entries that barkloader would reject as invalid. Barkloader refuses the whole install when an entry is invalid, so the extra entries can only lead to an approval request for an install that would fail anyway. They can never let an unapproved endpoint through.

## Inspecting a module

`inspectMarketplaceListing` runs steps 1, 3, 4 and 5 without claiming the listing. It returns what the review shows:

- the install key, `sha256` and size
- the manifest's id, name, version and description
- the permissions and local endpoints
- the files under the module root, listed the way `listModuleFiles` lists them after the install

## Installing a bundle

`installMarketplaceBundle` handles overlay and alert listings. If there is a buyer token, it claims the listing first, and a 402 returns `{ status: "payment_required" }`. It then reads `GET /catalog/{id}/bundle`. An overlay becomes a scene through `createScene`, and an alert becomes an alert composition through `createAlertComposition`. Each sends the usual `scene.created` webhook. The result is `{ status: "installed", listingId, engineId, kind }`.
