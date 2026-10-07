# Asset delivery

Module and user assets are served over HTTP through a public,
token-independent surface on sceneManager. Every asset URL is the asset's
repository key under one base:

```
{sceneManagerUrl}/assets/modules/{moduleKey}/{versionDir}/widgets/{manifestId}/{path}
{sceneManagerUrl}/assets/modules/{moduleKey}/{versionDir}/assets/{path}
{sceneManagerUrl}/assets/user/{resourceId}/{fileName}
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

## The scene media cache

A widget frame is sandboxed without `allow-same-origin`, so its document has an
opaque origin, and the browser keeps no HTTP cache for an opaque-origin
document's requests. Every `Cache-Control` above is therefore ignored for
media a widget loads itself: an alert layout's frames are created per alert,
and each one downloads its sound or clip again. A prefetch by the scene page
does not help either, since the page and the frame do not share a cache.

The page is not sandboxed, so it holds the media instead and hands the bytes
to the widget through `host.loadMedia` (see [Module SDK](../barkloader/sdk.md#media)):

```
scene page
  ├─> GET /scene/{sceneId}/media-manifest         every key the scene can play
  ├─> GET /scene/{sceneId}/media/{key}            sceneManager
  │     └─> GET {barkloaderUrl}/assets/{key}      redirect followed server-side
  └─> media.value { blob } ─> widget frame        object URL inside the frame
```

- **The manifest** lists the media in the scene's placements' settings, and
  in the layout of every enabled workflow's alert step that targets one of
  its alert widgets (`sceneManager/src/scene/media-manifest.ts`). A step
  whose target is an expression counts as targeting every alert widget. A
  string is media when it is an engine asset URL or a
  `${woofx3_asset_url:<key>}` token; widget bundle and theme files are not.
  Each alert delivery also carries its layout's keys, so an alert whose media
  the manifest missed starts downloading before its frames load.
- **The media route** follows a storage redirect rather than relaying it. The
  page has to read the bytes, which a cross-origin response allows only when
  the bucket carries a CORS policy, and a fresh bucket has none. It is behind
  the scene's session, and refuses a file over 64 MiB (413); the widget then
  loads that file from its own URL, uncached.
- **The page** holds up to 256 MiB in memory and persists every file in the
  Cache API (`woofx3-media:{sceneId}`), so an overlay reloaded, or OBS started
  again, has its media before the first alert. Files the manifest no longer
  lists are pruned when the scene loads. The Cache API exists only in a
  secure context: an overlay loaded over plain `http` from another machine
  keeps the memory copy alone.

## How an upload is stored

A caller never sends bytes through the api. It asks for a grant, PUTs
once to the URL the grant names, then reports completion:

```
browser
  ├─> api.requestUploadUrl(...)                    api (capnweb)
  │     └─> POST {barkloaderUrl}/assets/upload-url barkloader
  │           ├─ relay (default) → PUT {scene.publicUrl}/assets/upload/{token}
  │           └─ direct, S3 only → presigned PUT at the bucket
  ├─> PUT {uploadUrl}  (bytes, exactly the grant's headers)
  └─> api.completeUpload(resourceId, size)         row becomes "ready"
```

The grant's shape is identical either way, so nothing upstream branches on
the provider or the mode.

### Relay or direct

`storage.uploadMode` chooses where the browser sends the bytes: `relay`
(the default) or `direct`. The file backend cannot presign and always
relays, whatever the setting says.

Relay is the default because a presigned PUT straight at a bucket only
works from a browser if that bucket carries a CORS policy allowing PUT
from the dashboard's origin. A bucket without one — which is what a fresh
R2 or S3 bucket is — refuses the preflight, so the upload fails before a
byte is sent, and nothing in the engine can see it happen: the failure is
between the browser and the bucket. The relay goes through an edge that
already answers the preflight, so uploads work against any backend with
no bucket configuration.

Set `direct` to spend the bucket's bandwidth instead of the engine's, once
that bucket allows `PUT` with `content-type` from the dashboard's origin.

When relaying, the PUT lands on sceneManager, the only browser-reachable
edge, which streams the body on to barkloader without buffering it and
relays the answer:

```
browser
  └─> PUT {sceneManagerUrl}/assets/upload/{token}  sceneManager
        └─> PUT {barkloaderUrl}/assets/upload/{token}
```

Barkloader writes the bytes through the same repository either way, so a
relayed upload lands in the same bucket a presigned one would.

`/assets/upload/{token}` accepts only PUT (405 otherwise) and answers a
CORS preflight allowing PUT with `Content-Type`, since the dashboard is a
different origin. The token is a bearer capability in the URL, so no
origin is privileged over another. An upload over the size limit is
refused from its declared `Content-Length` before any bytes are relayed;
the limit is 512 MiB, and sceneManager and barkloader must agree on it.

The token is an HMAC-signed grant naming one key, one content type and one
expiry (`barkloader/app/src/services/upload_token.rs`). Barkloader holds
the signing secret and is the only party that judges it. It refuses a
grant that is expired (410), forged or not under `user/` (403), sent as a
content type other than the one it was issued for (403), or whose key
already holds an object (409) — a stored object is the record that the
grant was spent, which makes a grant single-use without a table of spent
tokens. Bytes are written to a staging file and renamed into place, so a
key never names a half-written object.

## Thumbnails

`api.requestProcessing(resourceId)` asks barkloader to derive
`thumbnail.png` beside the upload. It returns once the work is accepted;
the result lands on the resource as `thumbnailUrl`.

An image is decoded, bounded to 512 px on its longest edge and re-encoded
as PNG. Audio has nothing to show and keeps a null thumbnail.

The engine carries no video decoder, so a video's thumbnail is made from a
frame the caller captures — a browser can already play the clip. The
caller uploads that frame as the video's poster, then asks for processing:

```
browser
  ├─> capture one frame of the video as an image
  ├─> api.requestPosterUploadUrl(resourceId, contentType)
  │     └─> POST {barkloaderUrl}/assets/poster-upload-url
  ├─> PUT {uploadUrl}  (the frame, exactly the grant's headers)
  └─> api.requestProcessing(resourceId)
```

The poster grant has the same shape and rules as an upload grant, minus
the resource: a poster is not a resource and no row points at it.
Barkloader runs it through the image path, so what is stored as the
thumbnail is always the engine's own re-encoding, and then deletes the
poster whether or not it decoded, which frees the grant's key for a
replacement. A video
processed with no poster keeps a null thumbnail, as audio does.

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
