# streamware

On-stream alert renderer and OBS controller for woofx3.

Subscribes to `ui.notify.alert` on the local message bus (published by the
workflow engine's `alert` action) and pushes alerts to connected browser
overlays over a WebSocket. Also bridges the legacy `slobs` NATS subject
for `scene_change`, `source_change`, and `source_blur` so existing OBS
control triggers keep working during the migration off `streamlabs/`.

## Layout

- `src/` — Bun service: HTTP + WebSocket server, NATS subscriptions, OBS
  client.
- `ui/` — Vite + React overlay SPA. Built into `ui/dist/` and served
  statically by the Bun server in production.
- `public/` — alert media assets (audio, gifs, lottie JSON), served at
  `/public/...`.

## Running

```bash
# One-time install
bun install
cd ui && bun install && cd ..

# Dev: starts backend (--watch) + Vite UI in parallel.
bun run dev
# - backend on http://localhost:9101 (alerts WS, /public, /health)
# - vite    on http://localhost:5173 (SPA + HMR; proxies /ws/alerts and
#                                     /public/* through to the backend)

# Production
bun run build:ui       # produces ui/dist/, served by the Bun server
bun run start
```

OBS browser source URL:
- Production: `http://localhost:9101/overlay/alerts`
- Dev: `http://localhost:5173/` (Vite HMR)

Individual processes are still available as `bun run dev:server` and
`bun run dev:ui` if you want to drive them separately.
