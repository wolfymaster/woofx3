# Asset Prefix Rules

Widget assets — everything under a manifest's declared `assets` directory — are served
over HTTP through the api proxy surface. Relative asset references inside a widget
document resolve against a configurable prefix that points at the widget's asset root.

## How widget assets are served

Barkloader stores installed widget assets under `modules/{module_key}/widgets/{id}/...`
in its configured repository (file or S3 backend) and serves them at:

```
GET /assets/modules/{moduleKey}/widgets/{manifestId}/{path}
```

Streamware proxies these through the overlay token path so they appear at a stable
URL relative to the assembled frame document:

```
/o/{token}/widget-assets/{moduleKey}/{manifestId}/{path}
```

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
<base href="../widget-assets/spotify_sr/now_playing/">
```

### Relative mode (default)

When `WOOFX3_WIDGET_ASSET_BASE_URL` is not set (or is empty), the `<base>` href is:

```
../widget-assets/{moduleKey}/{manifestId}/
```

This is relative to the frame URL (`/o/{token}/frame/{id}`), which resolves to
`/o/{token}/widget-assets/{moduleKey}/{manifestId}/`. The api proxy forwards any
request under `/overlay/{token}/widget-assets/...` to streamware's
`/o/{token}/widget-assets/...` route, which in turn proxies to barkloader. The overlay
therefore works correctly through any number of proxy layers.

### CDN override (absolute mode)

When `WOOFX3_WIDGET_ASSET_BASE_URL` is set to an absolute URL (e.g.
`https://cdn.example.com/widgets`), the `<base>` href becomes:

```
https://cdn.example.com/widgets/modules/{moduleKey}/{manifestId}/
```

In this mode widget assets bypass streamware and barkloader entirely and are served
directly from the CDN. Built-in widgets always use the relative mode regardless of
this setting — their assets live in streamware's own public directory.

The config key is `woofx3WidgetAssetBaseUrl` in `streamware/src/config.ts`.

## Traversal pipeline

Every untrusted path component — whether from an HTTP request or from the widget
catalog's `entry` field — passes through the traversal pipeline defined in
`streamware/src/widget-asset-proxy.ts` (`sanitizeAssetPath`).

Steps in binding order:

1. **Decode**: `decodeURIComponent(raw)` — any decode error returns `null` (rejected).
2. **Normalize**: replace `\` with `/`, collapse `//+` to `/`, strip leading `/` so
   the result is always relative.
3. **Reject `.` and `..`**: split on `/`, reject if any segment is `.` or `..`.
4. **Return** the cleaned path, or `null` on any rejection.

A `null` result causes the proxy to return HTTP 404. The same function is applied by
the frame assembler when resolving the manifest `entry` field before constructing the
barkloader fetch URL.

### Prefix guard (module-level)

`WidgetAssetProxy.proxy()` applies the pipeline independently to `moduleKey`,
`manifestId`, and the tail path. Each component is then `encodeURIComponent`-encoded
individually before being joined into the upstream URL:

```
barkloaderUrl/assets/modules/{clean_module}/widgets/{clean_manifest}/{clean_tail}
```

This means a crafted request like `/widget-assets/../../../secrets/key` is rejected at
step 3 (the `..` segment) before any upstream request is made.

## Barkloader asset route

The canonical barkloader route for widget assets is:

```
GET /assets/modules/{moduleKey}/widgets/{manifestId}/{path...}
```

Streamware's `WidgetAssetProxy` proxies to this URL, forwarding the `Content-Type`
response header verbatim. The response status is passed through unchanged; a 404 from
barkloader (asset not installed) surfaces as a 404 to the widget.

Authentication on asset serving is currently absent by design: assets are assumed
public. The proxy layer in streamware is the designated seam where an authentication
check can be inserted in the future without changing widget authoring conventions.
