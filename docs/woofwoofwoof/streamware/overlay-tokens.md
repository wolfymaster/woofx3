# Overlay Tokens

Every browser-source URL contains an overlay token — a unique, unguessable identifier
that resolves to exactly one scene owned by one application. The token is never the raw
scene id.

## Format

```
ovl_<base58-encoded random bytes>
```

Tokens are stored in plaintext in the `overlay_tokens` table in the woofx3 system
database (Postgres/SQLite via db-proxy). The token itself is the access credential;
no separate secret is needed because the token is unguessable by construction.

## Token lifecycle

Tokens are managed via RPC on the api (`api :9100`). Streamware never issues or
stores tokens — it only resolves them.

> **Known gap (as of the `313762c` api route split):** the mint/revoke/rotate/list
> RPCs described below are declared on the shared client interface
> (`shared/clients/typescript/api/api.ts`) and still have thin db-proxy wrapper
> methods in `api/src/db-client.ts`, but **no route file under `api/src/routes/`
> calls them** — they were dropped when `api/src/api.ts` was split into
> per-domain route modules and never re-added. `createScene`
> (`api/src/routes/scenes.ts`) also no longer auto-mints a token on scene
> creation, despite that behavior being described elsewhere (see the
> [spotify_sr walkthrough](./spotify-sr-walkthrough.md)). Today there is no
> working RPC path to mint, revoke, rotate, or list overlay tokens through the
> api. The sections below describe the intended/previous behavior; treat them
> as the contract to restore, not the current state.

### Mint

```
POST api → mintOverlayToken({ sceneId: "...", label: "OBS main" })
→ { tokenId, token, url: "http://127.0.0.1:8080/overlay/ovl_xxxxx/" }
```

The `url` is the ready-to-paste browser-source URL. It uses the configured
`overlayPublicUrl` (or the api's own origin as a fallback) so it works behind any
proxy. The api publishes a `db.overlay_token.created.{appId}` event on NATS after
the db-proxy write; the Bearer webhook channel projects this to registered clients as
`OVERLAY_TOKEN_MINTED`.

### Revoke

```
POST api → revokeOverlayToken({ tokenId: "..." })
```

Revocation tombstones the row in the db. The api publishes
`db.overlay_token.updated.{appId}`. Streamware's NATS subscription on that subject
(`streamware/src/nats-subscriptions.ts:116-119`) currently only calls
`OverlayTokenResolver.invalidateAll()` (cache poison) — it does **not** re-resolve
live overlay WebSocket connections, push a `control` frame, or close any socket.

> **Known gap:** the `control`/`token.revoked` push described below (and the
> scene manager's `onControlFrame` handling of it) is real, working code on the
> *receiving* end — but nothing on the streamware server currently sends it.
> A revoked token's already-open WebSocket keeps receiving broadcasts
> indefinitely; only a fresh connection (e.g. after page reload) is denied by
> the poisoned cache. If you're debugging "the overlay didn't go blank when I
> revoked the token," this is why.

The intended behavior, once the cache-invalidation handler also re-resolves live
connections, is: any socket whose token no longer resolves receives a P2 `control`
frame and is closed:

```json
{ "proto": "woofx3.overlay-events", "v": 1, "frame": { "kind": "control", "action": "token.revoked" } }
```

The scene manager's `onControlFrame` handler sets the overlay to the `revoked` render
state (blank `<div data-state="revoked">`). The underlying scene is untouched; mint a
new token to re-enable the URL.

### Rotate

Rotation is mint-then-revoke: mint a new token for the same scene, update the
browser source in OBS, then revoke the old token. Both tokens resolve to the same
scene during the switchover window.

## Token → scene mapping

One token maps to exactly one scene (one-to-one). The mapping is scoped to an
`applicationId`; tokens from different applications cannot resolve each other's scenes.
Multiple tokens may point at the same scene (e.g. separate OBS profiles), but each
token is independently revocable.

The resolution is performed by `OverlayTokenResolver`
(`streamware/src/overlay/token-resolver.ts`), which wraps the db-proxy
`resolveOverlayToken` RPC with a 30-second TTL cache
(`OVERLAY_TOKEN_CACHE_TTL_MS = 30_000`). Transport errors are not cached (so a
recovering db-proxy is retried); definitive misses (db returned NOT_FOUND) are
negatively cached for the full TTL.

## Revocation semantics — no enumeration oracle

Revoked tokens, unknown tokens, and transport errors all surface identically as
`null` from `OverlayTokenResolver.resolve()`. The server returns the same blank
document for every failure path (HTTP 200, `BLANK_FRAME_DOC`). This uniformity means:

- An attacker brute-forcing tokens receives no signal distinguishing an invalid token
  from a revoked one.
- The `./config` route returns `{ scene: null }` for any unresolvable token; the SPA
  shell renders an empty overlay.
- Logs mask tokens after the first 8 characters (`ovl_XXXX…`) via `maskToken()` in
  `streamware/src/overlay/token-resolver.ts`.

## Overlay URL format

The browser-source URL that OBS pastes is:

```
{overlayPublicUrl}/overlay/{token}/
```

`overlayPublicUrl` is configured on the api (e.g. `http://127.0.0.1:9100`). The api
strips `/overlay/{token}` and proxies to streamware at:

```
http://127.0.0.1:9101/o/{token}/
```

No query parameters are needed. The trailing slash matters: the SPA shell fetches
`./config`, `./frame/{id}`, and `./events` as relative URLs — they must resolve under
the token path prefix, not alongside it.
