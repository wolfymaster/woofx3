# Asset delivery

Module and user assets are served over HTTP through a public,
token-independent surface on sceneManager. Every asset URL is the asset's
repository key under one base:

```
{sceneManagerUrl}/assets/modules/{moduleKey}/{versionDir}/widgets/{manifestId}/{path}
{sceneManagerUrl}/assets/modules/{moduleKey}/{versionDir}/assets/{path}
{sceneManagerUrl}/assets/user/{applicationId}/{resourceId}/{fileName}
```

`sceneManagerUrl` is the `scene.publicUrl` engine setting, falling back to
the required `WOOFX3_SCENE_MANAGER_URL` (see
[Engine settings the UI configures](./engine-settings-ui.md)).

- **`modules/`** holds files unpacked from an installed module bundle.
  `versionDir` is the content-hash segment of the module's composite key
  (`{id}:{version}:{hash}`), so every version's files live under their
  own directory: upgrading a module never overwrites a previous version's
  bytes, and a key never changes content. The bundled `woofx3` widgets are
  an ordinary module under this prefix.
- **`user/`** holds generic user uploads — photos, video, audio a
  streamer stores through the control plane. Each resource occupies its
  own directory, so a derived thumbnail (`.../{resourceId}/thumbnail.png`)
  sits beside the upload it came from and is removed with it. These keys
  carry no version: replacing an upload means creating a new resource.

The api builds resource URLs, the workflow engine builds
`${woofx3_asset_url:...}` token values (see
[Expressions](../workflow/expressions.md)), and barkloader builds each
widget's resource base URL — all from the same setting.

## How an asset request is served

```
browser
  └─> GET {sceneManagerUrl}/assets/{key}          sceneManager
        └─> GET {barkloaderUrl}/assets/{key}      barkloader (not browser-reachable)
              ├─ S3 backend, not a widget bundle file → 302 to a presigned GET URL
              └─ file backend, or a widget bundle file → 200 with the bytes
```

sceneManager claims only `/assets/modules/` and `/assets/user/`; its own
static files under `/assets/` (such as `widget-host-shim.js`) are served
from its public directory. It forwards the path still percent-encoded,
relays `Location`, `Content-Type` and `Cache-Control`, and never follows a
redirect, so presigned bytes go straight from the bucket to the browser.

Barkloader checks that the key exists before redirecting, so a missing key
is the same 404 as any other rejection rather than a redirect to a storage
error. Presigned URLs are valid for 12 hours.

Widget bundle files (`modules/{moduleKey}/{versionDir}/widgets/...`) are
always served inline. A browser resolves a stylesheet's `url(...)` and a
module script's relative `import` against the URL it finally loaded from;
after a redirect that is a presigned URL, and the sibling it points at
would carry no signature.

### Caching

| Response | `Cache-Control` | Why |
|---|---|---|
| Inline `modules/` bytes | `public, max-age=31536000, immutable` | Keys are content-addressed |
| Inline `user/` bytes | `public, max-age=60, must-revalidate` | A thumbnail is written after its original |
| Redirect | `public, max-age=3600` | Well inside the presigned URL's 12 hours |

## The `<base>` tag

A widget document references its sibling files (`style.css`, `logo.png`,
…) by plain relative path. The frame assembler injects a `<base>` tag
immediately after the boot payload script and the shim script so those
resolve against the widget's asset root:

```html
<script>window.__WOOFX3_WIDGET_BOOT__ = { ... };</script>
<script src="/assets/widget-host-shim.js"></script>
<base href="https://scene.example.com/assets/modules/spotify_sr/3f9c2a1b/widgets/now_playing/">
```

The href is barkloader's `resourceBaseUrl` from
`GET /widgets/{moduleKey}/{manifestId}/frame`, built from the same setting
and the module's currently installed `versionDir`:

```
{sceneManagerUrl}/assets/modules/{moduleKey}/{versionDir}/widgets/{manifestId}/
```

Upgrading a module changes the base URL rather than the bytes behind it.
An operator pointing `scene.publicUrl` at a different host (e.g. behind a
tunnel or reverse proxy) changes where **every** widget's assets resolve
from, uniformly — and where overlay browser-source links point, since it's
the same setting.

## Traversal pipeline

Barkloader is the gate. `sanitize_asset_key`
(`barkloader/app/src/routes/assets.rs`) runs, in binding order:

1. **Decode**: strict percent-decoding — `%` must be followed by two hex
   digits and the result must be valid UTF-8.
2. **Reject backslashes.**
3. **Canonicalize**: drop empty segments, collapsing duplicate, leading
   and trailing slashes.
4. **Reject `.` and `..`**: either segment rejects the key; neither is
   ever resolved.
5. **Require an allowlisted prefix**: `modules/` or `user/`.

Every rejection — traversal attempt, bad prefix, missing key — is a bare
404, so a caller cannot probe the key space.

The same rejection is enforced upstream, at module-install time: barkloader's
`normalize_rel_path` rejects any `..`-containing path — including one that only
appears as a raw ZIP archive member name, not just a manifest-declared string —
before it can become a repository write (see
[Module manifest reference](../barkloader/modules.md)).

## Why asset URLs are public, not token-scoped

Asset URLs are built server-side before any specific scene or overlay token
is known — a single workflow execution may fan out to whichever scenes end
up rendering it — so there is no token to embed in them. Assets are
therefore public by design at every layer; only the storage bucket is
private, and presigned URLs are how bytes leave it. Scene pages, widget
frames and event streams stay behind an overlay token and session.
