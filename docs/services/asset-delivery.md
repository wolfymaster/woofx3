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

sceneManager claims only `/assets/modules/` and `/assets/user/` here (and
`/assets/upload/` and `/assets/media/`, below); its own static files under `/assets/` (such as `widget-host-shim.js`) are served
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

Barkloader resolves each frame (entry HTML, `resourceBaseUrl`, theme) once and
serves it from memory after that, keyed by module, widget, theme and the
public URL. An install, upgrade, rollback, uninstall or storage backend swap
clears every cached frame, so the next request resolves against what is
installed now. A changed `scene.publicUrl` needs no clear: it is part of the
key.

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

## External media

A placement's media setting can name a file hosted outside the engine:
`{ "source": "url", "name", "url", "type" }`, beside the library's
`{ "id", "name", "url", "type" }`. The frame of a widget with a theme
contract only loads images and media from the engine's origins (see
[Rendering and fallback](../barkloader/modules.md#rendering-and-fallback)),
so for those widgets sceneManager points such a value's `url` at the
engine's media proxy before it reaches an overlay:

```
browser (widget frame)
  └─> GET {publicUrl}/assets/media/{token}               sceneManager
        └─> GET {barkloaderUrl}/assets/media/{token}     barkloader
              └─> GET https://the.file/elsewhere.mp4     the upstream host
```

A widget without a theme contract has no such policy: its settings reach
it as entered and it loads the file from its host directly.

### What is rewritten

An object in placement settings, at any depth, marked `"source": "url"`
with an absolute http(s) `url`: the shape the dashboard's picker stores for
a file hosted elsewhere. Nothing else is: library values carry the engine's
own URLs, and a bare string or an unmarked object cannot be told apart from
a link or an API endpoint a widget calls. A URL already on the engine's
public origin is left as it is.

Which placements are rewritten is decided by framing: barkloader's frame
answer for the widget has a `theme` when the widget declares a contract,
and the placement's meta then carries `mediaProxyBase`, the proxy's URL
prefix under barkloader's public URL (taken from the widget's resource base
URL, so a public URL with a path prefix keeps it). The rewrite happens
everywhere sceneManager hands settings to an overlay:

- the scene page and `GET /scene/{id}/config` (the overlay's view of the
  scene document, see [Scene documents](./scene-documents.md#what-overlays-see));
- every SSE `scene-ops` event, so a live edit in the scene editor reaches a
  widget already pointed at the proxy without reloading its frame;
- `POST /scene/{id}/draft-config` (below);
- an alert widget's frame, whose boot payload carries its settings.

### Drafts: only what an editor chose is signed

`POST /scene/{id}/draft-config` is authorized by an overlay session, which
anything showing the overlay holds, so the placements it posts are not
trusted to choose what the engine fetches. It signs a URL only when that
URL is already in the scene's published or draft document, where only an
editor (through its authenticated editor socket) or a save puts it. A URL
the editor has just picked reaches the document as the editor's op, whose
`scene-ops` event makes the previewing page ask for its draft again, and
the URL is signed then.

The answer carries `mediaUrls`: per placement id, each URL signed mapped to
its proxy URL. The editor posts settings to a previewing page as they are
typed, and the page points them at the proxy with that map. Each answer
replaces the last, so the page holds only what the newest draft names, and
a URL it has signed no longer asks for another draft.

### The token

`{base64url(url)}.{expiresAt}.{hex HMAC-SHA256(key, base64url(url) + "." + expiresAt)}`,
where `expiresAt` is in unix seconds and `key` is HMAC-SHA256 of the label
`woofx3 media proxy v1` under the engine secret (`WOOFX3_BARKLOADER_KEY`).
sceneManager signs, barkloader verifies; the label keeps these signatures
apart from upload grants made with the same secret. URLs over 2048 bytes
are not signed and stay as entered.

A token is good for at least seven days, its expiry rounded up to the next
whole day, so every proxy URL minted for one file on one day is the same
URL and browsers keep their cached copy. An overlay can stay open for
days, so the scene page reads the expiries of the proxy URLs it holds and,
a day before the soonest, fetches its scene again (`/config`, or its draft
while previewing one), which brings fresh URLs; a widget sees new URLs for
the same files. A token grants only what the proxy does for that one URL
until it expires, and rotating the secret revokes every token.

### What the proxy fetches and relays

- A token that does not verify, or has expired, gets a bare 404.
- **http or https**, with no credentials in the URL. Plain http is allowed
  because the browser never sees the upstream: the overlay loads the file
  from the engine either way, and the address checks are what keep the
  fetch off private networks.
- Every address a host resolves to must be public: loopback, private
  (RFC 1918), link-local (and so cloud metadata), CGNAT, multicast,
  reserved and documentation ranges are refused, and so is IPv6 outside
  global unicast (`2000::/3`), among it unique local, deprecated site-local
  and discard-only addresses. IPv6 forms that carry an IPv4 address
  (mapped, compatible, translated, NAT64 `64:ff9b::/96` and the local-use
  `64:ff9b:1::/48`, 6to4) are judged by that IPv4 address; Teredo is
  refused outright. The check runs in the resolver the connection is made
  from, so the address vetted is the address connected to, and a literal
  address in the URL is checked the same way. An `HTTP_PROXY` in the
  environment is ignored.
- Redirects are followed by the proxy, at most 5, and every hop is checked
  like the first.
- Only `Range` and `If-Range` are forwarded from the browser; no cookies or
  authorization go upstream.
- Only a 200 or 206 with an `image/*`, `audio/*` or `video/*`
  `Content-Type` and no content encoding is relayed (a 416 passes through
  as is); anything else is a 502, and a refused destination a 403.
- The file may be at most 512 MiB, the largest upload the engine accepts,
  judged by `Content-Length` or the total in `Content-Range`, and counted as
  it streams.
- Timeouts: 5 s to connect, 15 s to the response headers, 30 s between
  reads of the body. A long video streams for as long as it keeps arriving.

The response carries the upstream's `Content-Type`, `Content-Length`,
`Content-Range`, `Accept-Ranges`, `ETag` and `Last-Modified`, plus
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Cache-Control: public, max-age=3600` (the upstream's file may change), and
`Content-Security-Policy: default-src 'none'; …; sandbox`, so a relayed SVG
opened directly cannot run as a page on the engine's origin. There is no
server-side cache; browsers cache by the URL, which stays the same for a
day. sceneManager adds no CORS headers: frames load the file through
`img`, `video` and `audio` elements, which need none, and no other origin
has a reason to read the bytes.

## Why asset URLs are public, not token-scoped

Asset URLs are built server-side before any specific scene or overlay token
is known — a single workflow execution may fan out to whichever scenes end
up rendering it — so there is no token to embed in them. Assets are
therefore public by design at every layer; only the storage bucket is
private, and presigned URLs are how bytes leave it. Scene pages, alert
frames and event streams stay behind an overlay token and session. A scene
widget's frame document is public too: it is the widget's code and nothing
else, and the placement reaches it through the URL's fragment.
