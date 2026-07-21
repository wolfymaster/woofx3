# Engine settings the UI configures

A small set of engine behaviors are stored as rows in the engine's DB-backed
`settings` table (`db/proto/v1/setting.proto`) rather than static
deploy-time config, specifically so the UI can let an operator change them
without a redeploy. Two exist today, both surfaced through the same
`getEngineInfo()` / `set*()` pair on `Woofx3EngineApi`
(`shared/clients/typescript/api/api.ts`, implemented in
`api/src/routes/engine.ts`):

| Setting key | Read via | Write via | What it controls |
|---|---|---|---|
| `widget_asset_base_url` | `getEngineInfo().widgetAssetBaseUrl` | `setWidgetAssetBaseUrl(value)` | Where the **browser** composes overlay widget asset URLs from (already implemented in the UI — use it as the reference implementation). |
| `assets.baseUrl` | `getEngineInfo().assetsBaseUrl` | `setAssetsBaseUrl(value)` | Where the **workflow engine** substitutes `${woofx3_asset_url}` from when it resolves a step's parameters server-side, before dispatch (e.g. an alert action's `mediaUrl`). New — this doc specs the UI half of it. |

This spec covers `assets.baseUrl`. Build it exactly like whatever settings
form already calls `setWidgetAssetBaseUrl` — same section of the settings
page, same input component, same save affordance. The two fields are
siblings, not variants of each other.

## Why a second field instead of reusing `widgetAssetBaseUrl`

They resolve different things for different consumers and can legitimately
point at different hosts:

- `widgetAssetBaseUrl` is read **client-side**, by the overlay editor, to
  build `<iframe>` / `<img>` sources when previewing/composing widgets.
- `assetsBaseUrl` is read **server-side**, by the workflow engine, to
  substitute `${woofx3_asset_url}` inside a workflow step's parameters at
  execution time (see `docs/workflow/expressions.md`).

In the common case an operator points both at the same storage backend, but
nothing enforces that, and a module's workflow steps have no way to reach
`widgetAssetBaseUrl` — they only ever see `${woofx3_asset_url}`.

## API contract

```ts
// Read (call once per session, same as the rest of getEngineInfo — no new round trip)
const { assetsBaseUrl } = await api.getEngineInfo();

// Write
const { success } = await api.setAssetsBaseUrl(newValue);
```

`assetsBaseUrl` is a plain string, trailing slash already stripped by the
server. Full type/doc-comments: `EngineInfo` and `Woofx3EngineApi` in
`shared/clients/typescript/api/api.ts`.

## Key behavioral difference from `widgetAssetBaseUrl`: there is no "unset" state

`widgetAssetBaseUrl` returns `""` when unconfigured, and the UI shows a
"widget unavailable" placeholder in that state.

`assetsBaseUrl` **never returns an empty string.** If no override has been
saved, the engine falls back to barkloader's own `/assets` route
(`workflow/asset_settings.go`), and `getEngineInfo()` returns that computed
default. There is always a working value — don't build an "unavailable"
empty state for this field.

This means the form needs to distinguish two things the API alone doesn't:
*the effective value* (what `getEngineInfo()` returned) vs. *whether the
operator explicitly configured it* (as opposed to seeing the barkloader
default). If that distinction matters for the UX you're building (e.g. "using
default" vs "custom" badge), track it client-side after the operator's own
edit — the API doesn't currently expose "is this the default." If that's not
worth building, it's fine to just always show the effective value.

## Form field spec

- **Label**: "Workflow asset base URL" (or similar — match your existing
  copy style for `widgetAssetBaseUrl`'s label).
- **Help text**: "URL prefix the workflow engine uses to resolve
  `${woofx3_asset_url}` in workflow steps (e.g. alert media/audio). Leave
  blank to use the engine's default asset server."
- **Input**: single-line text/URL input, same component `widgetAssetBaseUrl`
  uses.
- **Initial value**: `getEngineInfo().assetsBaseUrl` (the effective value,
  default or override — always populated).
- **Validation**: same as `widgetAssetBaseUrl` — must be empty or a
  syntactically valid absolute URL (`http://` / `https://`). No further
  server-side validation is performed; a malformed value is stored as-is and
  workflow steps will fail to resolve their URLs at runtime, so client-side
  validation is the only guard.
- **Save**: call `setAssetsBaseUrl(value.trim())` on submit/blur (match
  whatever trigger `setWidgetAssetBaseUrl` uses). Submitting an empty string
  clears the override — `getEngineInfo()` will then return the barkloader
  default on next read, not `""`.
- **Error handling**: `{ success: false }` from `setAssetsBaseUrl` means the
  underlying `SetSetting` RPC failed (e.g. db-proxy unreachable) — surface a
  generic save-failed toast/error, same as the widget field.

## Out of scope

- No new capnweb methods beyond `setAssetsBaseUrl` / the extended
  `getEngineInfo` — nothing else on `Woofx3EngineApi` changes.
- No per-workflow override — `assets.baseUrl` is one value per application,
  same scoping as `widget_asset_base_url`.
- No migration/backfill needed — an unset setting already resolves
  correctly via the barkloader-default fallback described above.
