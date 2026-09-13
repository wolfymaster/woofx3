# Engine settings the UI configures

A single URL setting lives in the engine's DB-backed `settings` table
(`db/proto/v1/setting.proto`) rather than static deploy-time config,
specifically so the UI can let an operator change it without a redeploy:

| Setting key | Read via | Write via | What it controls |
|---|---|---|---|
| `scene.publicUrl` | `getEngineInfo().overlayPublicUrl` | `setOverlayPublicUrl(value)` | The public base URL sceneManager is reachable at. Scene links (`{url}/scene/{sceneId}?token={token}`, what `mintOverlayToken`/`rotateOverlayToken`/`listOverlayTokens` return) and every asset URL (`{url}/assets/{repositoryKey}`) are built from it. |

The RPC names still say "overlay" because they are Convex's public
contract; only the setting key changed (db migration
`0031_rename_overlay_public_url_setting`).

Separately, `getStorageConfig()`/`setStorageConfig()` manage which
**repository backend** barkloader writes bytes to (`provider`,
`destination`, `bucket`, etc.) — that's about where bytes are physically
stored, not the URL a browser requests them from. Don't add a URL field
there.

## Who reads it

| Service | Builds |
|---|---|
| api | Scene links on overlay tokens; `url` and `thumbnailUrl` on user resources |
| workflow | `${woofx3_asset_url:...}` token values (see [Expressions](../workflow/expressions.md)) |
| barkloader | The `resourceBaseUrl` a widget frame's `<base>` tag points at |

Each resolves the same row — process-wide, not per application — and
caches it for 30 seconds.

## Why there's only one URL setting

Every browser-facing request goes to sceneManager: scene pages, widget
frames, and asset bytes alike. Assets are relayed — sceneManager forwards
`/assets/...` to barkloader, which redirects to presigned storage or
serves the bytes itself (see
[Asset delivery](./asset-delivery.md)). A
separate "asset URL" setting would be a second name for the same host.

## API contract

```ts
const { overlayPublicUrl } = await api.getEngineInfo();
await api.setOverlayPublicUrl(newValue);
```

`overlayPublicUrl` is a plain string, trailing slash already stripped by
the server.

## Resolution and fallback

`scene.publicUrl` (DB) → `sceneManagerUrl` (`WOOFX3_SCENE_MANAGER_URL`).
The fallback is required: api, workflow and barkloader each refuse to
start without it, so a public URL always resolves to a configured
address, never to an empty or guessed one.

## Form field spec

- **Label**: "Public URL" (or similar).
- **Help text**: "Base URL this deployment's scenes are publicly reachable
  at — used both for overlay browser-source links and for module, widget
  and uploaded assets. Leave blank to use the server's own configured
  default."
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

- No per-workflow override — `scene.publicUrl` is one value per
  deployment (process-wide, not even per-application).
