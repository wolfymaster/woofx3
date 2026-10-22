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

db-proxy has no authentication, NATS has none unless a token is configured (see
[Message bus hardening](#message-bus-hardening)), and hosts such as Railway put
every service in a project on one private network. So every other listener binds
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

## Message bus hardening

The embedded NATS server (`services/nats`) has four opt-in settings. Each is
off when unset, and the server then behaves exactly as it does without them.
Each is a `.woofx3.json` key or its `WOOFX3_*` variable:

| Key | Variable | Effect |
|---|---|---|
| `messagebusToken` | `WOOFX3_MESSAGEBUS_TOKEN` | Every client must present this token, on the TCP and the WebSocket listener. |
| `messagebusTcpDisabled` | `WOOFX3_MESSAGEBUS_TCP_DISABLED` | `true` turns off the plain TCP listener (`messagebusServerListeningPort`, 4222 by default), leaving only the WebSocket one. |
| `messagebusWebSocketSameOrigin` | `WOOFX3_MESSAGEBUS_WEBSOCKET_SAME_ORIGIN` | `true` rejects a WebSocket upgrade whose `Origin` names a different host and port than the one it was sent to. |
| `messagebusWebSocketAllowedOrigins` | `WOOFX3_MESSAGEBUS_WEBSOCKET_ALLOWED_ORIGINS` | A comma-separated list (`http://127.0.0.1:5173,https://app.example`): only upgrades from these origins are accepted. |

Keys are spelt `messagebusWebSocket…`, like `messagebusWebSocketPort`, and
variables `WOOFX3_MESSAGEBUS_WEBSOCKET_…`, like `WOOFX3_MESSAGEBUS_WEBSOCKET_PORT`.
The server also reads `messagebusWebsocket…` and `WOOFX3_MESSAGEBUS_WEB_SOCKET_…`
as the same settings.

A boolean or port the server cannot parse stops it at startup instead of running
it with less protection, or on another port, than was asked for. So does a
`messagebus…` key or `WOOFX3_MESSAGEBUS_…` variable the engine does not know,
so a misspelt setting cannot leave its hardening silently off. Bound beyond
loopback without a token, the server logs a warning at startup.

**The token.** The same key and variable configure the server and every client,
so one `WOOFX3_MESSAGEBUS_TOKEN` in the environment of the whole engine is
enough. The clients send it only when it is not blank:

| Client | Used by | Reads |
|---|---|---|
| Go, `shared/clients/golang/nats` | db, workflow | `WOOFX3_MESSAGEBUS_TOKEN` (`Config.Token`) |
| TypeScript, `shared/clients/typescript/nats` | api, sceneManager, twitch, woofwoofwoof | `woofx3MessagebusToken` (also `messagebusToken` in api and sceneManager) |
| Rust, `barkloader/app/src/services/nats.rs` | barkloader | `MESSAGEBUS_TOKEN`, then `WOOFX3_MESSAGEBUS_TOKEN` / `messagebusToken` |

Turn the token on for the server and every service together: a client without
it is refused as soon as the server requires it. `reward/` and `streamlabs/`
connect to an external NATS service, not the engine's, and do not read it.

**The TCP listener.** The engine's own services all connect over WebSocket
(`messagebusUrl`, `ws://127.0.0.1:4225`). The TCP listener is still used by
`docker-compose.dev.yml`, whose services connect to `nats://messagebus:4222`,
and by the `nats` CLI bundled in `infra/docker`, so it stays on unless a
deployment turns it off.

**Origins.** A web page can open a WebSocket to any address, including
`ws://127.0.0.1:4225` on the machine running the browser, and the browser always
sends the page's `Origin` with it. With `messagebusWebSocketSameOrigin` on, the
server refuses those upgrades. An upgrade with no `Origin` header is always
accepted, and that is what the engine's clients send: the Go client (nats.go),
the TypeScript client under Bun (`wsconnect`) and the Rust client (async-nats)
send none, which their tests pin. No browser code connects to the bus, so
same-origin breaks no engine client. The `Origin` header is enforced only by
browsers; a native program can send any value, so this protects against web
pages, not local processes, which the token is for.

**Binding.** `messagebusHost` defaults to `127.0.0.1`, but an explicitly blank
`messagebusHost` binds every interface (`0.0.0.0`). A packager shipping the
engine to run on a user's machine should set `messagebusHost` to `127.0.0.1`
explicitly, and should also set a token, disable TCP and turn same-origin on.

## Configuration

Configure a deployment with `WOOFX3_*` variables. They override the image's
baked `/app/.woofx3.json`, and a blank value never overrides a non-blank one, so
the file only supplies defaults. See [Runtime](./runtime.md) for how keys map to
variable names.

To read the config from somewhere other than the working directory and its
parents, set `WOOFX3_ROOT` (the directory holding `.woofx3.json` and `.env`) or
`WOOFX3_CONFIG` (the config file itself). Unset, every service searches upward
from its working directory. See
[Finding the config](./runtime.md#finding-the-config).

To keep the engine's state out of its install directory (a release unpacked
under Program Files on Windows cannot write there), set `WOOFX3_DATA_DIR` to an
absolute path. The relative database, module storage, module and upload paths, caches and every
log file then live under it. Unset, it has no effect on any path. See
[The data directory](./runtime.md#the-data-directory).

## Host and Origin checks

The api and sceneManager can refuse requests by their `Host` and `Origin`
headers. Both checks are off unless configured: the hosted dashboard reaches
engines directly from several origins (the app domain, PR previews, local dev),
so an engine that sets neither accepts every request and answers CORS with
`Access-Control-Allow-Origin: *`.

| Setting | When set |
|---|---|
| `WOOFX3_ALLOWED_HOSTS` | A request whose `Host` is not listed is answered `421 Misdirected Request`. This stops DNS rebinding: a page on a hostile name that resolves to the engine still sends its own name as the Host. |
| `WOOFX3_ALLOWED_ORIGINS` | A request that sends an `Origin` not listed is answered `403`, WebSocket upgrades and CORS preflights included. A request with no `Origin` is allowed. CORS echoes the request's origin with `Vary: Origin` instead of `*`. |

Each is a comma-separated list, read by both services, and each works without
the other. A malformed entry stops the service at startup, and so does a value
that is not a list at all, such as `true`.

Matching rules:

- **Hosts** are `name` or `name:port`, case-insensitive; IPv6 literals are
  bracketed (`[::1]`, `[::1]:8080`). A bare name matches on any port; with a
  port, only that port. A browser leaves the default port out of `Host`, so
  `name:80` and `name:443` also match a `Host` with no port. List every name the services are reached by, internal
  ones included: barkloader posts job results to the api at `WOOFX3_API_URL`,
  and health checks usually use `127.0.0.1`. Behind the edge, the Host is the
  public one, since Caddy passes it through.
- **Origins** are `scheme://host[:port]`, compared as web origins, so
  `https://app.example` and `https://app.example:443` are the same entry.
  `scheme://host:*` matches that scheme and host on any port (for example
  `http://localhost:*` for local dev servers). A scheme the URL standard gives
  no origin to, such as `tauri://localhost` from the desktop app's webview on
  macOS and Linux, is compared as `scheme://host[:port]`, case-insensitively;
  on Windows the webview sends `http://tauri.localhost`. The literal `null` matches the
  opaque origin sandboxed frames send, and nothing else matches it. There is
  no subdomain wildcard.

A browser sends no `Origin` on a top-level navigation or a same-origin `GET`,
which is why an absent Origin is allowed; OBS, the CLI and peer services send
none either. What an overlay sends when `WOOFX3_ALLOWED_ORIGINS` is set on
sceneManager:

- An **OBS browser source** loads `/scene/{id}` as a navigation (no Origin), and
  its same-origin `GET`s, the `/events` SSE stream included, send none. Its
  `POST`s (delivery acknowledgements, widget status, session refresh) send the
  page's own origin, so list sceneManager's public origin, as OBS reaches it.
- **Widget frames** are sandboxed with an opaque origin. Their CORS-mode loads
  from sceneManager (web fonts, module scripts) send `Origin: null`, so list
  `null` when widgets load anything from sceneManager. A listed `null` cannot
  tell one sandboxed page from another; the Host check and the session tokens
  remain the protection there. The api has no such caller, so give `null` to
  sceneManager alone, through its own environment rather than the shared
  `.woofx3.json`.
- The **scene editor** WebSocket sends the dashboard's origin.

For a desktop engine on loopback, for example:

```bash
# both services
WOOFX3_ALLOWED_HOSTS=localhost,127.0.0.1,[::1]
# api (the tauri origins admit the desktop app's webview)
WOOFX3_ALLOWED_ORIGINS=http://localhost:*,http://127.0.0.1:*,tauri://localhost,http://tauri.localhost
# sceneManager
WOOFX3_ALLOWED_ORIGINS=http://localhost:*,http://127.0.0.1:*,tauri://localhost,http://tauri.localhost,null
```

## Client registration

A dashboard or desktop shell becomes a client of the engine by calling
`registerClient` over `/api`, which returns the client id and secret it
authenticates with from then on. That response is the only place the secret
appears: the db proxy stores only its SHA-256 hash, so a client that loses its
secret registers again. Secrets issued before hashing are hashed when the db
proxy starts; their plain text is kept for one more release so that rolling
back to the previous release, which validates plain text, locks no client out.
A client created after the upgrade has no plain text, so after such a rollback
it registers again. Who may register is set by `WOOFX3_REGISTRATION_MODE`:

| Mode | Who may register |
|---|---|
| `open` | Anyone who reaches the engine. |
| `token` | Only a caller presenting the registration token. |
| `first` | Anyone while the engine has no registered client (trust on first use). After that, only a caller presenting the token, or nobody when there is none. |

Unset, the mode follows from the token: `token` when one is configured, `open`
when not. Managed engines are given `WOOFX3_REGISTRATION_TOKEN` by maintenance
and no mode, so they require it; a bring-your-own engine given neither stays
open.

The token comes from one of:

- `WOOFX3_REGISTRATION_TOKEN`, the token itself.
- `WOOFX3_REGISTRATION_TOKEN_FILE`, a path. If the file exists its trimmed
  contents are the token (an empty file stops the api). If not, the api
  generates a 256-bit token, writes it there with mode `0600` (creating the
  directory `0700`), and uses it. The file is written under a temporary name
  and hard-linked into place, so a reader never sees it half-written. A parent
  process such as a desktop shell reads the same file to register. On Windows
  the mode bits do not apply and the file takes its directory's permissions, so
  put it in a directory only the user can read, such as one under
  `%LOCALAPPDATA%`.

Setting both is a startup error, as are `open` with a token and `token`
without one.

`first` decides by asking the db proxy whether any client exists, on every
registration, so the lock survives restarts; removing every client opens
registration again. Registrations are handled one at a time in this mode, so two
callers racing on a new engine cannot both be first.

### Refusals

capnweb sends a rejected call's error name and message, but the receiving side
rebuilds any name it does not know as a plain `Error`. So each refusal is
carried in its message, which starts with a marker that a guard from
`@woofx3/api/rpc` recognises:

| Call | Message starts with | Guard |
|---|---|---|
| `registerClient` | `RegistrationRefused: ` | `isRegistrationRefused` |
| `authenticate` | `AuthenticationRefused: ` | `isAuthenticationRefused` |

The marker is for code, not people: `refusalReason(err)` returns the sentence
after it, to show to a user, or null when the error is not a refusal.

An authentication refusal means db-proxy does not know the client id and
secret. Retrying the same credentials cannot succeed, so a client stops and
asks for new ones instead of backing off. When the api cannot ask db-proxy, or
db-proxy fails, `authenticate` rejects with an ordinary error, which a client
retries. Accepted credentials are trusted for a minute without asking db-proxy
again, keyed by the client id and a hash of the secret, so neither a wrong
secret nor an earlier success changes the answer for another secret.

## Barkloader processing callbacks

barkloader reports asynchronous asset jobs (thumbnails) by POSTing to the api's
`/webhooks/barkloader/processing`, sending the engine secret
(`WOOFX3_BARKLOADER_KEY`) as `Authorization: Bearer <key>`.

The callback URL arrives in the processing request, so barkloader accepts one
only on the api's origin (scheme, host and port; default ports are the same
origin written or not) and answers `400` to any other. It resolves the api's
URL the way the api does: `WOOFX3_API_URL` when set, otherwise
`http://127.0.0.1:<WOOFX3_API_PORT>` (port `8080` when that is unset too).
When that URL is on loopback, `localhost`, `127.0.0.1` and `::1` all name it,
but only on its port. A `WOOFX3_API_URL` that is not an http(s) URL stops
barkloader at startup. If the api is reached at an address other than its
default, set `WOOFX3_API_URL` for barkloader to the same value the api uses.

The api checks that header only when `WOOFX3_BARKLOADER_WEBHOOK_AUTH=required`;
unset (or `off`) it accepts every callback. A callback without the right token
is then answered `401` and not recorded. Because the check is opt-in,
barkloader and the api can be updated in either order: turn it on once the
running barkloader sends the header.

## Startup

The entrypoint (`build/entrypoint.sh`) runs the database migrations with the
bundled `migrate` tool before the orchestrator starts any service. A failed
migration exits the container non-zero, so a deploy fails instead of booting
services against a half-migrated schema.

The image runs as UID 65532 and keeps its state in `/app/data`. A host that
mounts a root-owned volume there must start the container as root (Railway:
`RAILWAY_RUN_UID=0`); the entrypoint then hands `/app/data` to 65532 and drops
privileges before migrating or starting anything.

The orchestrator starts each service once the services it depends on are up.
The api declares `GET /ready` as its health endpoint in `services.json`, so the
edge starts once the api reports ready, or after 30 seconds if it has not by
then; a timeout is logged as a warning and never stops the engine. A service's
`health_timeout` in `services.json` raises that limit for it. The probe goes to
`127.0.0.1` on the port the api reads: `WOOFX3_API_PORT`, else `apiPort` in
`.woofx3.json` (`5050` in the image), else `5050`.

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
- **Sharing the asset bucket.** The replica can live in the same bucket as
  barkloader's assets (`S3_BUCKET`) under a prefix of its own, such as
  `module-storage`. Barkloader keeps to its `user/`, `modules/` and
  `archives/` prefixes, so the two never overlap; any cleanup added to
  barkloader must stay inside those prefixes, or it can delete the replica.

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
   storage, which makes the final flush to the replica (bounded at 10 seconds).

The host must allow at least 25 seconds between SIGTERM and SIGKILL; on
Railway, set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` to 30 or more.

### Supervision by a parent process

A program that starts the orchestrator itself, such as a desktop shell, can ask
it for machine-readable status. Both switches are off by default, and then the
orchestrator behaves exactly as above: services share its stdout and stderr, and
only a signal stops it.

- `WOOFX3_SUPERVISOR_STATUS=stdout-jsonl` writes status as JSON lines on stdout.
  Stdout then carries nothing else: the orchestrator logs to its log file only,
  and each service's stdout and stderr are appended to `<service>.output.log`
  in the log directory (`<data dir>/logs` under
  [`WOOFX3_DATA_DIR`](./runtime.md#the-data-directory), else `logs/` next to the
  orchestrator).
- `--status-file <path>` writes the same lines to a file, truncated at start.
  Alone, it changes nothing else.
- `--exit-on-stdin-eof` stops the services and exits, as on SIGTERM, when the
  orchestrator's stdin closes. A parent that keeps the write end of a pipe open
  is then covered even when it is killed outright. The services get the null
  device as stdin.

Each line is one event, with an RFC 3339 `time`:

```json
{"event":"service","time":"2026-10-17T12:00:00.1Z","name":"api","status":"starting","pid":4242}
{"event":"service","time":"2026-10-17T12:00:03.2Z","name":"api","status":"healthy","pid":4242}
{"event":"ready","time":"2026-10-17T12:00:04.0Z"}
{"event":"service","time":"2026-10-17T12:05:00.0Z","name":"api","status":"stopped","pid":4242,"message":"exit status 0"}
{"event":"stopped","time":"2026-10-17T12:05:01.0Z"}
```

- `service` — a service moved to `starting`, `healthy`, `unhealthy` or
  `stopped` (with how it exited in `message`), or was `skipped` because its
  prebuilt binary is not installed.
- `ready` — every service is healthy at once, sent once per run. A service with
  a `health_endpoint` in `services.json` is healthy when a `GET` of it answers
  `200`; one without is healthy as soon as its process has started, whether or
  not it has finished starting up. A service whose check times out is
  `unhealthy` but is still checked, and turns `healthy` when its check passes.

  In the shipped `services.json`, `ready` therefore means:

  - the api's `GET /ready` answered `200`: db-proxy is reachable, the database
    is fully migrated, and barkloader has reported ready over the message bus
    (see [Readiness and version](#readiness-and-version) below);
  - sceneManager's `GET /health` answered `200`: its HTTP server is listening
    (on `WOOFX3_SCENE_MANAGER_PORT`, `9101` by default);
  - the message bus, twitch, wooflow, woofwoofwoof and the edge each have a
    running process. None of them serves an HTTP health route, so nothing more
    is known about them, beyond the bus working for barkloader.

  Both checks go to `127.0.0.1`, so a deployment that sets
  `WOOFX3_ALLOWED_HOSTS` must list it.
- `error` — a service could not be started (`name` set), or the orchestrator
  could not start at all (no `name`; it exits non-zero after this line).
- `stopped` — every service has been stopped, and its own `stopped` event
  written, and the orchestrator is exiting. A service that cannot be reaped
  within 5 seconds of being killed may be missing its event.

Consumers must ignore event types and fields they do not know.

### Windows

Windows has no SIGTERM, so the orchestrator stops services differently there.
The two phases and the 25 seconds are the same.

- **Stopping a service.** Each service starts in a console process group of its
  own. To ask one to stop, the orchestrator sends it `CTRL_BREAK_EVENT`, and
  kills it if it has not exited when the grace period is up. Go services and
  Caddy receive the event as `os.Interrupt`, Bun services as `SIGBREAK`, and
  barkloader through its ctrl-break handler. All of them treat it as a graceful
  shutdown.
- **The orchestrator needs a console.** A console control event can only be
  sent through a console that the sender shares with the target. A parent that
  starts the orchestrator without a visible window should use
  `CREATE_NO_WINDOW`, which gives it a hidden console. It should not use
  `DETACHED_PROCESS`, which gives it none. Without a console, every stop
  request fails, and each service is killed straight away (with a warning in
  the log). db-proxy then gets no final flush.
- **Services never outlive the orchestrator.** The orchestrator puts itself in
  a job object that kills every process in it when the orchestrator exits, and
  the services inherit that job. Ending the orchestrator from Task Manager, or
  with `TerminateProcess`, therefore ends the services too, but with no graceful
  stop. For a graceful stop, a parent should use `--exit-on-stdin-eof` and close
  the pipe.
- **Stopping the orchestrator.** Ctrl+C or Ctrl+Break in its console stops it as
  SIGTERM does on Linux. Ctrl+C reaches only the orchestrator, which then stops
  the services in order. Closing the console window, logging off or shutting
  down also stops it. However, Windows ends the process about 5 seconds after
  those events, which is well short of the grace period. The job then kills
  whatever is still running.

On Linux and macOS, nothing of this applies: services are stopped with SIGTERM,
and there is no job. Services outlive an orchestrator killed with SIGKILL.
(`--exit-on-stdin-eof` covers the death of the orchestrator's parent, not of the
orchestrator itself.)

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
  "uptimeSeconds": 3725,
  "capabilities": {
    "schema": 1,
    "enabled": ["alerts.queueControls", "analytics.aggregates", "analytics.gauges"]
  }
}
```

- `name` — `WOOFX3_ENGINE_NAME`, which the provisioner sets to the engine's
  `eng-<id8>` service name; `null` when unset, as on a local engine.
- `version` — the same release `/ready` reports.
- `startedAt` — when the api process started. A deploy starts a new process,
  so this is the last deploy or the last restart, whichever came later.
- `uptimeSeconds` — whole seconds since then, from a monotonic clock.
- `capabilities` — the feature ids this build supports, sorted: the same list
  `getEngineCapabilities` returns (see
  [engine-capabilities.md](engine-capabilities.md)), readable without a
  registered client. `schema` is `ENGINE_CAPABILITIES_SCHEMA`. The example
  above is shortened; a real engine lists every id it supports.
  It includes the hosting ids for `WOOFX3_HOSTING`, as below.

`WOOFX3_HOSTING` declares how the engine is run: `managed`, `self` or `local`.
`getEngineInfo()` reports it as `hosting`, and `local` adds the
`engine.localMode` capability. Unset, `getEngineInfo()` has no `hosting` field
and no hosting capability is listed; any other value stops the api at startup.

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
