# Engine settings the UI configures

A single URL setting lives in the engine's DB-backed `settings` table
(`db/proto/v1/setting.proto`) rather than static deploy-time config,
specifically so the UI can let an operator change it without a redeploy:

| Setting key | Read via | Write via | What it controls |
|---|---|---|---|
| `overlay.publicUrl` | `getEngineInfo().overlayPublicUrl` | `setOverlayPublicUrl(value)` | The single public base URL for reaching this deployment's overlay surface — both token-scoped overlay access (`/overlay/{token}/...`, what `mintOverlayToken`/`rotateOverlayToken`/`listOverlayTokens` compose their `url` from) **and** every widget/module asset kind (module widgets, module assets, builtin widgets, reserved user uploads), via the same `/overlay/assets/...` route. |

Separately, `getStorageConfig()`/`setStorageConfig()` manage which
**repository backend** barkloader writes bytes to (`provider`,
`destination`, `bucket`, etc.) — that's about where bytes are physically
stored, unrelated to where they're publicly reachable from. Don't add a
URL field there; see "History" below for why that was tried and reverted.

## Why there's only one URL setting

Everything — overlay traffic and asset bytes alike — is proxied through
the same api-gateway `/overlay/` surface today
(`api/src/overlay-proxy.ts`'s dumb `/overlay/` → `/o/` rewrite handles
both `/overlay/{token}/...` and `/overlay/assets/...` identically). Given
that, a second "where do assets live" setting would just be a second name
for the same value, and a third "where is the streamware app" setting
would be a third name for it — more places to configure the same thing,
not more capability.

## History (why this used to be three settings, and why that was wrong)

An earlier iteration split this into `streamware.baseUrl` (for reaching
the streamware app) and `storage.baseUrl` (for asset resolution),
reasoning that (a) asset URLs need to be constructible without a
per-viewer overlay token, so they shouldn't live under the token-scoped
`/o/{token}/` tree, and (b) storage might someday live somewhere streamware
doesn't front (S3 behind a CDN, bypassing the proxy for reads).

(a) is real and still true — asset routes remain public/token-independent
(see [Asset prefix rules](../woofwoofwoof/streamware/asset-prefix.md)) —
but it doesn't require a *separate setting*, only a separate *route*,
which streamware already has (`/o/assets/...`, non-token). (b) was
designing for a scenario that isn't built and wasn't planned — nothing in
this codebase serves assets from anywhere other than through streamware's
proxy. Three settings meant three places to independently misconfigure
for a capability that doesn't exist. Collapsed back to one.

## API contract

```ts
const { overlayPublicUrl } = await api.getEngineInfo();
await api.setOverlayPublicUrl(newValue);
```

`overlayPublicUrl` is a plain string, trailing slash already stripped by
the server.

## Resolution and fallback — no hardcoded default

`overlay.publicUrl` (DB) → this service's own env-configured
`overlayPublicUrl` (`WOOFX3_OVERLAY_PUBLIC_URL`) → **empty string**. There
is deliberately no further hardcoded literal (e.g. no baked-in
`http://127.0.0.1:9100` guess) beyond the env/config layer in streamware
or workflow — if a deployment hasn't configured either the DB setting or
the env var, asset URLs resolve as host-less relative paths
(`/overlay/assets/modules/...`) rather than pointing at a made-up address.
Set `WOOFX3_OVERLAY_PUBLIC_URL` (or the DB setting) explicitly for any
deployment where that matters.

api's own default is a partial exception, and deliberately so: `api/src/config.ts`'s
`overlayPublicUrl` falls back to `` `http://127.0.0.1:${port}` `` when
totally unconfigured — derived from this same process's own already-resolved
`port`, not an independent guess about a different service's address, so
it can't drift out of sync the way a duplicated literal could.

## Form field spec

- **Label**: "Public URL" (or similar).
- **Help text**: "Base URL this deployment is publicly reachable at — used
  both for overlay browser-source links and for resolving module/widget
  assets. Leave blank to use the server's own configured default."
- **Input**: single-line text/URL input.
- **Initial value**: `getEngineInfo().overlayPublicUrl`.
- **Validation**: empty or a syntactically valid absolute URL
  (`http://` / `https://`). No further server-side validation — a
  malformed value is stored as-is and resolution fails at request time,
  so client-side validation is the only guard.
- **Save**: call `setOverlayPublicUrl(value.trim())` on submit/blur.
  Submitting an empty string clears the override.
- **Error handling**: `{ success: false }` means the underlying
  `SetSetting` RPC failed (e.g. db-proxy unreachable) — surface a generic
  save-failed toast/error.

## Out of scope

- No per-workflow override — `overlay.publicUrl` is one value per
  deployment (process-wide, not even per-application).
- Real user-asset upload (the `/user/...` prefix this setting's resolved
  URL can reference) is reserved but not implemented — don't build UI for
  it yet.
