# Deploying the engine

The production image (`Dockerfile.production`) runs the whole engine in one
container: every service under the orchestrator, behind one public port.

## One public port

Only the **edge** listens beyond loopback. It is Caddy, started by the
orchestrator as the `edge` service, configured by `build/config/Caddyfile.edge`,
and it listens on `$PORT` (default `8080`):

| Path | Goes to |
|---|---|
| `/api`, `/api/*` | the api (capnweb HTTP batch and WebSocket) |
| `/ready` | the api |
| everything else | sceneManager (overlays, the `/events` SSE stream, assets, the upload relay) |

Responses are proxied unbuffered, so SSE events and capnweb frames arrive as
they are written, and WebSocket upgrades pass straight through.

The split lives in the engine, not in front of it, because some hosts give a
service a single port and a single domain (Railway does). It works the same for
a bring-your-own engine: point one tunnel or reverse proxy at `$PORT` and both
apps are reachable at one origin.

A release archive (not the image) ships `Caddyfile.edge` but not Caddy. The
orchestrator skips a `binary` service whose file is not installed, so an archive
runs its services directly and is reached on their own ports.

## Everything else stays on loopback

db-proxy and NATS have no authentication, and hosts such as Railway put every
service in a project on one private network. So every other listener binds
`127.0.0.1` by default:

| Service | Setting | Default |
|---|---|---|
| db-proxy | `WOOFX3_DATABASE_PROXY_HOST` | `127.0.0.1` |
| NATS (client and WebSocket) | `WOOFX3_MESSAGEBUS_HOST` | `127.0.0.1` |
| api | `WOOFX3_API_HOST` | `127.0.0.1` |
| sceneManager | `WOOFX3_SCENE_MANAGER_HOST` | `127.0.0.1` |
| barkloader | — | always `127.0.0.1` |

Set a host to `0.0.0.0` only where services run in separate network namespaces
and must reach each other, as `docker-compose.dev.yml` does.

## Configuration

Configure a deployment with `WOOFX3_*` variables. They override the image's
baked `/app/.woofx3.json`, and a blank value never overrides a non-blank one, so
the file only supplies defaults. See [Runtime](./runtime.md) for how keys map to
variable names.

## Startup

The entrypoint (`build/entrypoint.sh`) runs the database migrations with the
bundled `migrate` tool before the orchestrator starts any service. A failed
migration exits the container non-zero, so a deploy fails instead of booting
services against a half-migrated schema.

The image runs as UID 65532 and keeps its state in `/app/data`. A host that
mounts a root-owned volume there must start the container as root (Railway:
`RAILWAY_RUN_UID=0`); the entrypoint then hands `/app/data` to 65532 and drops
privileges before migrating or starting anything.
