# Asset Prefix Rules

Widget and module assets are served over HTTP through a public,
token-independent surface on streamware. Relative asset references inside a
widget document resolve against an absolute `<base>` tag pointing at the
widget's asset root, itself derived from the same single engine setting
used for overlay access: `overlay.publicUrl`.

## The unified URL scheme

Every asset kind — module widgets, generic module assets, and builtin
(engine-bundled) widgets — is served under the same base:

```
{overlayPublicUrl}/overlay/assets/modules/{moduleId}/widgets/{widgetManifestId}/{relPath}
{overlayPublicUrl}/overlay/assets/modules/{moduleId}/assets/{relPath}
{overlayPublicUrl}/overlay/assets/builtin/widgets/{widgetManifestId}/{relPath}
{overlayPublicUrl}/overlay/assets/user/...   (reserved — not yet implemented)
```

These public-facing paths never change across a module upgrade — they
deliberately carry no version information, since a widget's own HTML
references sibling files (`style.css`, `logo.png`, …) by plain relative
path and can't be rewritten. `WidgetAssetProxy` (streamware) resolves the
module's *current* version-scoped storage directory server-side (via
`ModuleVersionResolver`, cached and invalidated on `db.module.installed.*`)
and injects it before forwarding to barkloader — see "How widget assets
are served" below.

`overlayPublicUrl` is resolved from the `overlay.publicUrl` engine setting
(db-proxy `settings` table, process-wide — not scoped per application),
falling back to this service's own env-configured `WOOFX3_OVERLAY_PUBLIC_URL`
when unset, and to an empty string beyond that (no further hardcoded
guess — see [Engine settings the UI configures](../../services/engine-settings-ui.md)
for why there's only this one setting, not a separate one for asset
resolution).

## Why asset routes are public, not token-scoped

An earlier version of this design nested asset routes under
`/o/{token}/...` and required a valid overlay token before proxying. That
doesn't work: asset references can be constructed by the workflow engine
server-side, before any specific overlay/token is known (a single workflow
execution may fan out to whichever scenes end up rendering it) — there is no
token to embed in the URL at that point. Asset bytes are therefore public by
design, matching barkloader's own `/assets/{key}` route (which has no auth of
its own — see below). Only the streamware app's own state-bearing routes
(`config`, `frame`, `events`) remain token-gated.

## How widget assets are served

Barkloader stores installed widget assets under
`modules/{moduleId}/{versionDir}/widgets/{id}/...` (and generic module
assets under `modules/{moduleId}/{versionDir}/assets/...`) in its
configured repository (file or S3 backend). `versionDir` is the short
content-hash segment of the module's composite key
(`{id}:{version}:{hash}` — see barkloader's `module_install.rs`
`version_dir`): every version's files live under their own directory, so
upgrading a module never overwrites a previous version's bytes, and a
rollback can always find them again. Barkloader itself serves these
byte-exact repository keys with no translation:

```
GET /assets/modules/{moduleId}/{versionDir}/widgets/{manifestId}/{path}
GET /assets/modules/{moduleId}/{versionDir}/assets/{path}
```

Streamware's `WidgetAssetProxy` is what resolves `{versionDir}` — the
public route below never sees it.

Builtin widgets are seeded into the same repository storage (see the
`seed-builtin-widgets` CLI subcommand on the barkloader binary) and served the
same way, without a module-id segment:

```
GET /assets/builtin/widgets/{manifestId}/{path}
```

Streamware exposes these at a stable, public path — not nested under any
overlay token:

```
GET /o/assets/modules/{moduleId}/widgets/{manifestId}/{path}
GET /o/assets/modules/{moduleId}/assets/{path}
GET /o/assets/builtin/widgets/{manifestId}/{path}
```

The api gateway forwards to these unmodified: its existing `/overlay/` →
`/o/` dumb proxy (`api/src/overlay-proxy.ts`) already rewrites any path
verbatim, so `GET /overlay/assets/modules/...` reaches streamware's
`/o/assets/modules/...` with zero gateway-side changes needed for this route
family. Externally, assets are reachable at
`{overlayPublicUrl}/overlay/assets/modules/...`.

From a widget's perspective (already loaded at `/o/{token}/frame/{instanceId}`), the
`<base>` tag set by the frame assembler makes asset references like `./cover.png` or
`images/logo.svg` resolve to the correct absolute URL without any widget-side
configuration.

## The `<base>` tag

The frame assembler injects a `<base>` tag immediately after the boot payload script
and the shim script:

```html
<script>window.__WOOFX3_WIDGET_BOOT__ = { ... };</script>
<script src="../assets/widget-host-shim.js"></script>
<base href="https://streamware.example.com/overlay/assets/modules/spotify_sr/widgets/now_playing/">
```

The href is always absolute, resolved through `overlayPublicUrl`:

```
{overlayPublicUrl}/overlay/assets/modules/{moduleId}/widgets/{manifestId}/
{overlayPublicUrl}/overlay/assets/builtin/widgets/{manifestId}/
```

There is no relative/CDN-override branching — builtin and module-contributed
widgets are both served through the repository behind the same one base URL.
An operator pointing `overlay.publicUrl` at a different host (e.g. behind a
different tunnel or reverse proxy) changes where **every** widget's assets
resolve from, uniformly — and where overlay browser-source links point, since
it's the same setting.

## Traversal pipeline

Every untrusted path component — whether from an HTTP request or from the widget
catalog's `entry` field — passes through the traversal pipeline defined in
`streamware/src/overlay/asset-proxy.ts` (`sanitizeAssetPath`).

Steps in binding order:

1. **Decode**: `decodeURIComponent(raw)` — any decode error returns `null` (rejected).
2. **Normalize**: replace `\` with `/`, collapse `//+` to `/`, strip leading `/` so
   the result is always relative.
3. **Reject `.` and `..`**: split on `/`, reject if any segment is `.` or `..`.
4. **Return** the cleaned path, or `null` on any rejection.

A `null` result causes the proxy to return HTTP 404. The same function is applied by
the frame assembler when resolving the manifest `entry` field before constructing the
barkloader fetch URL.

The same rejection is enforced upstream, at module-install time: barkloader's
`normalize_rel_path` rejects any `..`-containing path — including one that only
appears as a raw ZIP archive member name, not just a manifest-declared string —
before it can become a repository write (see
[Module manifest reference](../../barkloader/modules.md)).

### Prefix guard (module-level)

`WidgetAssetProxy` applies the pipeline independently to every untrusted path
component (`moduleKey`, `manifestId`, and the tail path). Each component is then
`encodeURIComponent`-encoded individually before being joined into the upstream URL:

```
barkloaderUrl/assets/modules/{clean_module}/widgets/{clean_manifest}/{clean_tail}
barkloaderUrl/assets/modules/{clean_module}/assets/{clean_tail}
barkloaderUrl/assets/builtin/widgets/{clean_manifest}/{clean_tail}
```

This means a crafted request like `/o/assets/modules/../../../secrets/key` is
rejected at step 3 (the `..` segment) before any upstream request is made.

## Barkloader asset route

The canonical barkloader routes for these asset kinds are:

```
GET /assets/modules/{moduleId}/widgets/{manifestId}/{path...}
GET /assets/modules/{moduleId}/assets/{path...}
GET /assets/builtin/widgets/{manifestId}/{path...}
```

Streamware's `WidgetAssetProxy` proxies to these URLs, forwarding the
`Content-Type` response header verbatim. The response status is passed through
unchanged; a 404 from barkloader (asset not installed) surfaces as a 404 to
the widget.

Authentication on asset serving is absent by design, at every layer: assets
are assumed public. Barkloader's `/assets/{key}` route has no auth of its own
(it's loopback-only, reached only by streamware internally); streamware's
`/o/assets/...` route reachable from the browser is equally unauthenticated,
for the structural reason explained above. The proxy layer in streamware is
the designated seam where a finer-grained check could be inserted in the
future without changing widget authoring conventions — but note any such
check could not be per-overlay-token, since not every asset URL's producer
has a token in scope.
