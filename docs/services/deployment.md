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
| `/health`, `/ready` | the api |
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

## Module storage

Module storage (`ctx.storage`) is an embedded SQLite file owned by db-proxy,
separate from the system database. It is the one piece of engine state that
lives on the engine's own disk, so it is the piece that decides how an engine
survives a redeploy or a move to another host.

| Key (`.woofx3.json` / variable) | Required | Meaning |
|---|---|---|
| `storagePath` / `WOOFX3_STORAGE_PATH` | yes | The SQLite file, e.g. `/app/data/module-storage.db`. |
| `storageReplicaUrl` / `WOOFX3_STORAGE_REPLICA_URL` | no | Litestream replica URL. Unset is local mode. |
| `storageReplicaAccessKeyId` / `WOOFX3_STORAGE_REPLICA_ACCESS_KEY_ID` | no | S3 access key for the replica. |
| `storageReplicaSecretAccessKey` / `WOOFX3_STORAGE_REPLICA_SECRET_ACCESS_KEY` | no | S3 secret key for the replica. |

Set the credentials as variables on the host, never in the baked
`.woofx3.json`. When they are unset, the replica client falls back to the
standard AWS sources (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, instance
roles).

### Local mode

With no replica URL, db-proxy opens the file and serves. SQLite's automatic
checkpointing keeps the write-ahead log bounded, every commit is synced to disk
before it is acknowledged, and the file on disk is the only copy: back up
`/app/data` the way you back up anything else on that machine.

### Replicated mode

With a replica URL, db-proxy embeds [Litestream](https://litestream.io) and
streams every commit to S3-compatible object storage (S3, R2, B2, MinIO, or a
`file://` directory):

```
s3://<bucket>/engines/<engine-id>/storage?endpoint=https://<account>.r2.cloudflarestorage.com&region=auto
```

- **Restore before serving.** When the storage file is missing, db-proxy
  restores it from the replica before it listens at all. A replica with no
  backup yet (a new engine) starts an empty file. A restore that fails, for
  any other reason, leaves db-proxy not serving and retrying; it never starts
  with an empty store in place of the real one. `GET /ready` stays `503`
  throughout, because db-proxy does not answer until storage is open.
- **Durability.** A graceful shutdown flushes everything to the replica
  before db-proxy exits. A crash can lose up to about one second of writes,
  Litestream's sync interval.
- **Moving between modes** needs no tooling. Local to replicated: start with a
  replica URL; Litestream uploads the existing file as its first snapshot.
  Replicated to local: start once with the URL on a host with no file, so it
  restores, then remove the URL.

**One writer per replica path.** Two engines writing the same bucket path can
leave a replica that cannot be restored. Give every engine its own path, and
never run two containers of one engine at once. Railway does not overlap
deploys of a service that has a volume attached; without a volume, that
guarantee is gone and an engine would need a lease before opening storage.

**Keep the volume.** Replication makes a volume optional, but with one a
redeploy reopens the local file instead of restoring it, which is faster and
does not depend on the bucket being reachable at boot. Without one, every boot
restores from the bucket (seconds at per-streamer sizes, growing with the
database).

### Shutdown

On SIGTERM the orchestrator stops the services in two phases and kills whatever
is still running after 25 seconds.

1. The services that depend on others are signalled first and get up to 8
   seconds. This is when the workflow engine lets runs in flight finish, and
   records the ones it has to abandon as failed (see
   [Stopping the Engine](../workflow/execution.md#stopping-the-engine)). db-proxy
   and the message bus are still up, so those outcomes can be written and
   announced.
2. db-proxy and the message bus are signalled once those services have exited,
   or their 8 seconds are up. db-proxy stops serving, then closes module
   storage, which makes the final flush to the replica (bounded at 15 seconds).

The host must allow at least 25 seconds between SIGTERM and SIGKILL; on
Railway, set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` to 30 or more.

## Readiness and version

`GET /ready` (served by the api, reachable through the edge) answers `200`
only once the engine can be depended on, and `503` until then:

```json
{
  "ready": true,
  "version": "v0.1.0",
  "migrations": { "applied": "0042_workflow_run_history", "latest": "0042_workflow_run_history", "pending": 0 },
  "services": { "dbProxy": true, "barkloader": true }
}
```

- `services.dbProxy` — db-proxy answered its `CommonService.MigrationStatus` RPC.
- `migrations` — how much of the chain this release ships the database has
  applied; ready needs `pending: 0`. All three fields are `null` while db-proxy
  cannot be asked.
- `services.barkloader` — barkloader's last `HEARTBEAT` said ready, less than
  30 seconds ago (it reports ready once its bundled modules are installed).
- `version` — the image's `WOOFX3_VERSION` build argument (the release tag), or
  `dev` for an unversioned build. `getEngineInfo` returns it too.

`GET /health` stays a liveness check: it answers `200` as soon as the api
process does, whatever its dependencies are doing. It is public, so its body
holds only descriptive facts that are safe for anyone to read:

```json
{
  "status": "ok",
  "name": "eng-0a1b2c3d",
  "version": "v0.1.0",
  "startedAt": "2026-10-01T12:00:00.000Z",
  "uptimeSeconds": 3725
}
```

- `name` — `WOOFX3_ENGINE_NAME`, which the provisioner sets to the engine's
  `eng-<id8>` service name; `null` when unset, as on a local engine.
- `version` — the same release `/ready` reports.
- `startedAt` — when the api process started. A deploy starts a new process,
  so this is the last deploy or the last restart, whichever came later.
- `uptimeSeconds` — whole seconds since then, from a monotonic clock.

Readiness is deliberately strict about the message bus. barkloader reports
ready once its bundled modules are installed, and it can only report anything
while it holds a bus connection, so an engine whose bus never comes up stays
`503` and a deploy gated on `/ready` fails. That is the intended answer: with
no bus nothing publishes or receives events, and an engine that serves HTTP
while delivering no alerts is worse than one that plainly failed to start.
Services wait a minute for the bus before giving up on it, so a boot race is
not what this reports.

None of this needs a registered client. A freshly provisioned engine reports
ready before anyone registers with it, which is what lets the dashboard
register at all.

## The Twitch link

An engine exists before its streamer connects Twitch, so `twitch` and
`woofwoofwoof` start **idle** when no account is linked: they stay up, report
ready on their heartbeat, and say they are waiting for a Twitch link. Neither
needs `WOOFX3_TWITCH_CHANNEL_NAME`; without one, the channel is whoever links
the account. `twitchapi` requests answered while idle report that Twitch is not
linked.

Linking in the UI writes the token to engine settings and publishes
`setting.integration.token.updated`, which is what moves both services from
waiting to connected, with no restart.

**Known gap:** relinking or unlinking *while twitch is already connected* does
not rebuild its EventSub connection; it keeps the one it has until the engine
restarts. woofwoofwoof's chat client does reload on that event.
