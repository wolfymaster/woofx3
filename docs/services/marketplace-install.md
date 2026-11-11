# Marketplace installs

The engine can install a marketplace listing by its id. It reads the listing, claims it for the buyer, downloads the archive, checks it, and installs it itself. Whatever the caller is, the engine installs only what the marketplace recorded for that listing.

The methods:

```ts
installMarketplaceListing(listingId, { approvedPermissions, approvedLocalEndpoints, buyerToken?, licenseKey? }): Promise<MarketplaceInstallResult>
inspectMarketplaceListing(listingId, buyerToken?): Promise<MarketplaceListingInspection>
getInstalledModuleLicense(moduleId): Promise<{ listingId, key } | null>
installMarketplaceBundle(listingId, buyerToken?): Promise<MarketplaceBundleInstallResult>
```

The types are in `shared/clients/typescript/api/api.ts`. The routes are in `api/src/routes/marketplace.ts`, and the HTTP client is `api/src/marketplace-client.ts`.

## Configuration

| Key (`.woofx3.json` / variable) | Default | Meaning |
|---|---|---|
| `marketplaceUrl` / `WOOFX3_MARKETPLACE_URL` | `https://marketplace.woofx3.tv` | The marketplace API. Blank turns the marketplace off: these three methods and the [catalog reads](./marketplace-catalog.md) then refuse every call. |
| `marketplaceDownloadHosts` / `WOOFX3_MARKETPLACE_DOWNLOAD_HOSTS` | `f35f44146e8730089a795954e32183e8.r2.cloudflarestorage.com` | Comma-separated hosts that archive downloads may come from. A bare host means HTTPS on the default port. An entry with a scheme (`https://a.example:8443`, `http://127.0.0.1:9000`) is an exact origin. `http://` is accepted only for a loopback host (`localhost`, `127.x.x.x`, `[::1]`), for a local marketplace. |

The default host is the Cloudflare R2 account endpoint where the public marketplace presigns its downloads. A marketplace with a different `R2_ACCOUNT_ID` needs its own host here. Both values are checked at startup, so a malformed one stops the api from starting instead of failing the first install.

A blank value never overrides a non-blank one from a lower source (see [Runtime](./runtime.md)). To turn installs off, set `WOOFX3_MARKETPLACE_URL` to blank and leave `marketplaceUrl` out of `.woofx3.json`.

## Buyer tokens

The engine has no marketplace credential of its own. A caller acting for a buyer passes the buyer token that the dashboard minted. An install sends it as a bearer token on `POST /catalog/{id}/acquire`, `GET /modules/{id}/download` and `GET /catalog/{id}/bundle`, and reads the listing itself (`GET /catalog/{id}`) anonymously. The [catalog reads](./marketplace-catalog.md) forward it on the browse routes and the quote. The engine never sends the token on any other route, because the marketplace answers a buyer token there with 401, and it never parses, logs or stores the token.

Without a token, the engine claims the listing anonymously and downloads with the key the claim answers with. Only a free listing can be claimed that way; a paid one is refused with `account_required`. An anonymous claim sends the engine's install id as `X-Install-Id`, which the marketplace keys the claim on, so claiming the same listing again answers with the same entitlement and key. A marketplace from before ignores the header and makes a new entitlement with a key of its own for each claim, so a caller that already has the key (for example from `getInstalledModuleLicense`) should still pass it, and a reinstall reuses the key the installed module holds. The install id is never sent beside a buyer token.

## License keys and the install id

Every module download carries a license key once the marketplace issues them. The key comes from the caller (`licenseKey`) or from the engine's own claim (`POST /catalog/{id}/acquire` answers `license: { key, listingId, edition }`). The engine sends it as `X-License-Key`, with its install id as `X-Install-Id`, on `GET /modules/{id}/download`. A key from a free claim works on its own. A key from a purchase, an upgrade or a gift also needs the buyer token of the account that holds it, which the engine sends as usual.

The install id is a random UUID the engine makes the first time it downloads with a key and keeps in its settings under `engine.install_id`. The marketplace counts the distinct install ids a key has downloaded to and refuses a new one past its limit (`activation_limit`). A repeat download from the same engine is not a new install. A fresh database gets a new id, and so counts as a new install.

The key is a credential. The engine never logs it; its logs say only whether an install had one (`hasLicense`).

The key an install downloaded with is kept on the installed module, next to its marketplace provenance, sealed with the engine's secrets key (`WOOFX3_SECRETS_KEY`) like secret module settings. The api hands it to barkloader as the `marketplace_license_key` form field, and barkloader passes it to the db proxy with the listing and edition. `getInstalledModuleLicense(moduleId)` reads it back for the module whose manifest id is `moduleId`: `{ listingId, key }`, or null when the module came from elsewhere or without a key. It throws for a module that is not installed. For an install made without an account this is the only copy of the key. Uninstalling the module deletes its row, and the key with it. A key that no longer opens (the secrets key changed) reads as none.

An install that names a listing replaces the kept key with its own, or with none when it had none; an upload clears it; an install that names no origin keeps it.

### Transitional paths

Three paths exist only to serve a marketplace or an engine from before license keys:

- A claim that answers with no `license` (a marketplace that issues no keys): the install downloads without a key.
- A claim refused with 401 `unauthorized` when there is no buyer token (a marketplace from before anonymous claims, as opposed to `account_required`, which is a paid listing): the install downloads without a key.
- The download without a license key, which works for a free listing and for a listing the buyer token's buyer holds. [Inspecting a listing](#inspecting-a-module) depends on it too.

Remove all three together once every engine reports the `marketplace.licenseKeys` capability and the marketplace has dropped its anonymous download for free and paid listings. Coverage of the capability across the fleet is not tracked yet, so the first condition cannot be checked today. Removing them also means the inspection must move to a path that does not download anonymously.

## Installing a module

`installMarketplaceListing` handles module and theme listings:

1. `GET /catalog/{id}` reads the listing's type, name, version, edition and `moduleKey` (the module id). Other listing types are refused.
2. Without a `licenseKey`, `POST /catalog/{id}/acquire` claims the listing (for the buyer token's buyer, or anonymously) and answers with the key. A 402 returns `{ status: "payment_required", intent }`, where `intent` is the purchase to pay (`{ id, amountCents, currency, kind, expiresAt }`), and nothing is downloaded. Any other refusal throws. With a `licenseKey` nothing is claimed.
3. `GET /modules/{id}/download` with the key and install id returns a presigned URL. If the response has no valid `sha256`, the engine refuses it.
4. The engine fetches the archive only from an allowed download host and never follows a redirect. The archive is capped at 50 MiB, counted as the body arrives, so a body that declares no length or a false one is cut off once it passes the cap. The fetch, body included, must finish within 30 seconds.
5. If `sizeBytes` is present, the archive's length must equal it. Its SHA-256 must always equal `sha256`.
6. The engine reads the manifest that barkloader would install from, using the same name ranking and root rules. Every permission it declares must be in `approvedPermissions`, and every `local[]` endpoint id must be in `approvedLocalEndpoints`. If not, the result is `{ status: "needs_approval", name, version, unapproved, unapprovedLocalEndpoints }` and nothing is installed. A manifest that is not JSON is refused, because nobody could review it.
7. The manifest's `id` must equal the listing's module id. If not, the engine sends `module.install_failed` and throws, naming the listing, the module id and the manifest id.
8. The install key is described in [Install keys](#install-keys). The dashboard stores this key and correlates install webhooks by it.
9. If that key is already installed, the engine sends `module.installed` with `alreadyInstalled: true` and returns `{ status: "installed", moduleKey, alreadyInstalled: true }`. Otherwise it hands the archive to barkloader with the listing id and edition as the install's marketplace provenance, and returns `{ status: "installed", moduleKey }`. Barkloader finishes the install asynchronously and reports it with `module.installed` or `module.install_failed`. When the key is already installed but the module holds no key, or another one, from the same listing, the engine first records the key this install used (sealed, like any kept key), so a later install does not claim again.

A refusal from the claim or the download throws in the `marketplace_http status=<status> code=<code>: <message>` format of the [catalog reads](./marketplace-catalog.md), which `parseMarketplaceCatalogError` reads back. The codes a licensed install can meet:

| Code | Status | From | Meaning |
|---|---|---|---|
| `account_required` | 401 | claim, download | A paid listing claimed with no buyer token, or a bought key downloaded without its buyer's token |
| `buyer_mismatch` | 403 | download | A bought key with another buyer's token |
| `not_entitled` | 403 | download | The key does not unlock this listing, or its entitlement was revoked |
| `entitlement_revoked` | 403 | claim | The buyer's entitlement was revoked |
| `activation_limit` | 409 | download | The key has been used on as many installs as it allows |
| `listing_unavailable` | 409 | claim | The listing is unpriced, unpublished, superseded or delisted |
| `downloads_blocked` | 410 | claim, download | The marketplace blocked the module |
| `rate_limited` | 429 | claim | Too many anonymous claims; try again later |

If the download or one of its checks fails after the install key is known, the engine sends `module.install_failed` and then throws. Every install webhook that the api sends itself carries `source: "marketplace"`. Barkloader's own completion events do not have a `source`.

The engine counts every `local[]` entry that has an id, including entries that barkloader would reject as invalid. Barkloader refuses the whole install when an entry is invalid, so the extra entries can only lead to an approval request for an install that would fail anyway. They can never let an unapproved endpoint through.

## Installing from a URL

`installModuleFromUrl(downloadUrl, moduleKey, ctx)` is the older install path, where the caller already holds a presigned download URL. It fetches through the same guarded download as step 4 above:

- Only an `https` URL on one of the download hosts is fetched, or an `http` URL on a loopback download host. Every other scheme (`file:`, `data:`, `ftp:`) and every other host is refused before anything is fetched.
- Redirects are refused, and the 50 MiB cap and 30 second deadline apply.
- When `ctx.sha256` is given (hex, any case), the archive must match it. It is optional so that existing callers keep working; a caller that has the marketplace's download answer should pass its `sha256`.
- With the marketplace turned off (`marketplaceUrl` blank) there is no download allow-list, so the call is refused.

A refused download sends `module.install_failed` and throws, as in step 4.

## Install keys

The install key is `{moduleId}:{version}:{first 7 hex of sha256}`. `moduleId` is the listing's `moduleKey` in the catalog: the manifest id that every edition of the module shares. It is not the listing id. Barkloader computes the same key from the archive (manifest id, manifest version, archive hash) and refuses an install whose expected key differs.

A new edition of a module is a new listing (`cozy-v2` is edition 2 of module `cozy`), but it installs under the same module id. So:

| Listing | Edition | Install key |
|---|---|---|
| `cozy` | 1 | `cozy:1.4.0:abc1234` |
| `cozy-v2` | 2 | `cozy:2.0.0:def5678` |

For edition 1 the listing id and the module id are the same, so its keys are the ones it always had. A listing without a `moduleKey` uses its listing id.

Installing edition 2 over edition 1 is an upgrade: the key differs, so the install proceeds, and barkloader replaces the installed module in place, as it does for any new version of a module. The module row keeps its id, the streamer's setting values are kept because settings are keyed by module id (see [Install-time registration](../barkloader/modules.md#install-time-registration)), resources the new manifest no longer declares are pruned, and functions it drops are archived. Installing the same edition and build again is caught by the already-installed check, because its key is unchanged.

Which listing and edition is installed is never read from the key. It is the module's marketplace provenance (`marketplaceListingId`, `marketplaceEdition` on the module), which every marketplace install sends, together with its license key, and which replaces the recorded values on an upgrade. An install that sends no provenance, such as a manual upload, keeps the recorded values.

## Inspecting a module

`inspectMarketplaceListing` runs steps 1, 3, 4, 5 and 7 without claiming the listing. Its review comes before the streamer consents, so it downloads without a license key, with the buyer token when there is one. The marketplace allows that for a listing that is free now and for one the token's buyer holds; a listing that turned paid after an anonymous free claim cannot be inspected this way. It returns what the review shows:

- the module id (`moduleId`), the edition, the install key, `sha256` and size
- the manifest's id, name, version and description
- the permissions and local endpoints
- the files under the module root, listed the way `listModuleFiles` lists them after the install

## Installing a bundle

`installMarketplaceBundle` handles overlay and alert listings. If there is a buyer token, it claims the listing first, and a 402 returns `{ status: "payment_required" }`. It then reads `GET /catalog/{id}/bundle`. An overlay becomes a scene through `createScene`, and an alert becomes an alert composition through `createAlertComposition`. Each sends the usual `scene.created` webhook. The result is `{ status: "installed", listingId, engineId, kind }`.
