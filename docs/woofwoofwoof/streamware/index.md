# Streamware — Overlay Architecture

Streamware is the woofx3 service responsible for scene management and widget display.
It renders the HTML pages that OBS browser sources load. Every overlay is identified
by a unique token (never the raw scene id), served through the woofx3 api proxy so
streamware itself is never reachable from outside the engine.

## Role

| Responsibility | File |
|---|---|
| Overlay SPA shell + scene config route (`/o/{token}/`) | `streamware/src/server.ts` |
| Token resolution and cache | `streamware/src/overlay/token-resolver.ts` |
| Scene config assembly (token → widget instances) | `streamware/src/overlay/scene-host.ts` |
| Widget frame assembly (entry fetch + scaffold inject) | `streamware/src/overlay/frame-assembler.ts` |
| Widget asset proxy → barkloader | `streamware/src/overlay/asset-proxy.ts` |
| P2 overlay WebSocket (`/o/{token}/events`) + NATS fan-out | `streamware/src/storage/broadcaster.ts`, `streamware/src/nats-subscriptions.ts` |
| Scene manager + P1 parent-side bridge | `streamware/ui/src/SceneOverlay.tsx`, `lib/widgetBridge.ts` |
| Event queue (pre-existing, unchanged — see [Event queue](../../streamware/alert-queue.md)) | `streamware/src/events/queue-manager.ts` |

Paths above reflect the post-`e867c0c` domain-directory reorganization
(`streamware/src/` is now split into `overlay/`, `events/`, `storage/`, etc. rather
than flat top-level files).

## How overlays are served

```
OBS browser source
  └─> GET /overlay/{token}/**   (api :9100 — the only public surface)
        └─> GET /o/{token}/**   (streamware :9101 loopback)
              ├─ /o/{token}/          → SPA shell (React, served from ui dist)
              ├─ /o/{token}/config    → scene config JSON (token → scene)
              ├─ /o/{token}/frame/{instanceId}?nonce=... → assembled widget frame
              ├─ /o/{token}/widget-assets/{moduleKey}/{manifestId}/**
              │                       → proxied to barkloader GET /assets/modules/...
              ├─ /o/{token}/assets/widget-host-shim.js → the P1 shim IIFE
              └─ /o/{token}/events    → P2 WebSocket (woofx3.overlay-events v1)
```

The api proxy strips `/overlay/{token}` and forwards to streamware as
`/o/{token}/...`. All URLs inside the SPA shell and widget frames are relative to
the overlay root, so they survive any proxy prefix unchanged.

## Target-state architecture

```mermaid
flowchart LR
    subgraph external [Public]
        OBS[OBS browser source]
        ConvexUI[Convex UI / woofx3-ui]
        Client[API client]
    end

    subgraph engine [woofx3 engine - local]
        API[api :9100\nCap'n Web RPC\noverlay proxy\nwebhook out]
        SW[streamware :9101 loopback\noverlay host + frame assembler\n/o/{token}/** + WS P2\nalert queue unchanged]
        SWUI[streamware/ui\nscene manager\nP1 parent side\nP2 event source]
        BL[barkloader :3005\nmodule runtime\nGET /assets/** repository]
        DB[db proxy\nPostgres/SQLite + BadgerDB\noverlay_tokens table]
        NATS[(NATS\nCloudEvents)]
        WF[workflow]
        TW[twitch]
    end

    Client -- RPC --> API
    ConvexUI -- RPC --> API
    API -- HMAC webhook --> ConvexUI
    API -- Bearer webhook\nOVERLAY_TOKEN_MINTED/REVOKED --> ConvexUI

    OBS -- "GET /overlay/{token}/** (api proxy)" --> API
    API -- "GET /o/{token}/** (loopback)" --> SW
    SW -- "frame assembly\nGET /assets/modules/..." --> BL
    SW -- widget frame doc --> SWUI
    SWUI -- "P1 postMessage\nwoofx3.widget v1" --> SWUI
    SWUI -- "P2 WS /o/{token}/events\nwoofx3.overlay-events v1" --> SW

    SW -- Twirp --> DB
    API -- Twirp --> DB
    BL -- Twirp --> DB
    DB -- "db.overlay_token.*" --> NATS
    SW <-- "db.overlay_token.updated.*\ndb.scene.updated.*\nmodule.storage.*.changed\nwidget.event" --> NATS
    API <-- "db.overlay_token.created.*\nmodule.storage.*.changed" --> NATS
    WF --> NATS
    TW --> NATS
    BL --> NATS
```

## Sub-pages

- [Overlay tokens](./overlay-tokens.md) — mint, revoke, rotate; revocation semantics
- [Widget protocol (P1)](./widget-protocol.md) — `woofx3.widget` v1 postMessage API
- [Asset prefix rules](./asset-prefix.md) — widget asset base URL, traversal pipeline
- [P2 event source](./p2-event-source.md) — `woofx3.overlay-events` v1 transports
- [spotify_sr walkthrough](./spotify-sr-walkthrough.md) — end-to-end example
