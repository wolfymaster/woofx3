# Connectors host

`connectors` is the Bun service that holds the engine's connections to
third-party platforms and local apps. Each connection is an **adapter**. The
**host** is the always-on part around them: it reads whether each adapter is
linked and enabled, runs the adapter only while it should run, and answers the
request subjects adapters serve even while they are down.

It ships with two adapters, `twitch` (see [The Twitch adapter](#the-twitch-adapter))
and `obs` (see [The OBS adapter](#the-obs-adapter)), and runs in every packaged engine (`build/config/services.json`), where the
orchestrator checks its `/health` before reporting the engine ready.

```
           setting.integration.*.updated
api ──────────────────────────────────────▶ settings watcher ──▶ supervisor ──▶ adapter start/stop
                                                  │                    │
                                       db-proxy ◀─┘ (link readers)     ▼
caller ── request (e.g. twitchapi) ──▶ served subjects ──▶ adapter handler, or an "unavailable" reply
```

Code lives in `connectors/src/host/`; `server.ts` only wires it to the shared
runtime (see [Runtime](./runtime.md)). The host also serves the
[platform gateway](./platform-gateway.md) (`connectors/src/gateway/`), the
engine's platform-neutral way to post, announce and pin, which fans each
request out to the platform adapters' egress handlers.

## Linked and enabled

An adapter decides whether it should run from a **link state**,
`{connected, enabled}`, which a **link reader** builds from engine settings.
Every adapter id (`ADAPTER_IDS` in `host/adapter-ids.ts`) must have a reader in
`LINK_READERS`; a missing one stops startup.

Adapter ids are separate from integration ids. An integration
(`@woofx3/common/integrations/integration-settings`) is an account the api
stores a credential for; an adapter is anything the host runs, and a local
adapter needs no integration.

For Twitch:

| Setting | Meaning |
|---|---|
| `twitch_token` holds a value | connected |
| `integration.twitch.enabled` is `"true"` or `"false"` | enabled is that value |
| `integration.twitch.enabled` is missing | enabled follows connected (logged once at info) |
| `integration.twitch.enabled` is anything else | enabled follows connected (logged once per value at warn) |

The api writes both rows when Twitch is linked or unlinked, then publishes
`setting.integration.enabled.updated` and `setting.integration.token.updated`
(see [Twitch channel controls](./twitch-channel.md)).

OBS has no integration and no enabled setting: its reader always reads
`{connected: true, enabled: true}` and reads no settings, so the `obs` adapter
runs whenever the host does.

### When links are read

The settings watcher reads every link when the host starts, re-reads the
adapters an event names when either settings event arrives, and reads every
link again on the backstop interval (`WOOFX3_CONNECTORS_RECONCILE_INTERVAL_MS`)
in case an event was missed. Reads run one pass at a time; events that arrive
during a pass merge into the next one, so an older read never overrides a newer
one. A read that fails, or takes longer than
`WOOFX3_CONNECTORS_DB_PROXY_TIMEOUT_MS`, keeps the adapter on its last link
state and logs a warning.

## Adapter states

The supervisor reconciles each adapter's desired state with what is running.
Transitions for one adapter never overlap, so an adapter is never started twice
or stopped in the middle of a start.

| State | Meaning |
|---|---|
| `stopped` | Not desired, or not yet started. |
| `starting` | `start` is running. |
| `connected` | `start` resolved; the adapter is running. |
| `degraded` | A start failed or the running adapter reported a fault. It is retried at `retryAt`. |
| `parked` | It failed too often; it stays down until a settings event names it. |
| `stopping` | `stop` and the closing of its bus subscriptions are running. |

- **Start and stop.** A link state the adapter wants starts it; one it does not
  want aborts a start in progress or stops it. Giving up the start, `stop` and
  the close of its subscriptions share one `WOOFX3_CONNECTORS_STOP_DEADLINE_MS`,
  counted from the abort or the stop; past it the adapter is marked `stopped`
  anyway and an error is logged. Turning an adapter off also clears its failure
  history and backoff.
- **Retries.** Retries use capped exponential backoff with full jitter
  (`createBackoff` from the shared runtime), from
  `WOOFX3_CONNECTORS_BACKOFF_BASE_MS` up to `WOOFX3_CONNECTORS_BACKOFF_MAX_MS`.
  The backoff resets once the adapter connects. A settings event for the
  adapter skips a pending retry wait.
- **Parking.** `WOOFX3_CONNECTORS_PARK_AFTER_FAILURES` failures within
  `WOOFX3_CONNECTORS_PARK_WINDOW_MS` park the adapter. Only a settings event
  that names it (linking, relinking, enabling) unparks it; the backstop pass
  does not.
- **Faults.** A running adapter that loses its connection calls
  `reportFault(reason)`. The host stops it and retries it like a failed start.
  A fault reported by an earlier run is ignored.
- **A throwing `desired`.** The adapter is treated as not desired and an error
  is logged.

## Served subjects

An adapter lists the request/reply subjects it answers in its manifest's
`serves`. The host, not the adapter, subscribes to each of them once, for the
life of the process, so a caller always gets exactly one reply. A manifest
whose `subscribes` covers one of its own served subjects is refused at startup.

| Adapter state | Reply |
|---|---|
| `connected` | The adapter's `handle`. |
| `stopped`, `parked` | `unavailableReply` at once. |
| `starting`, `degraded`, `stopping` | Held until the adapter connects (then `handle`), settles `stopped` or `parked` (then `unavailableReply` at once), or the subject's budget runs out (then `unavailableReply` with reason `starting`). |

`unavailableReply` gets the reason and the adapter's last link state, so a reply
can tell "nothing is linked" apart from "linked but turned off". A `handle` that
throws counts against the adapter (`servedErrors`) and gets the
`unavailableReply` for `stopped`.

Each served subject declares its own `budgetMs`, set below the timeout its
callers use, so a held request is answered before the caller gives up. There is
no host-wide budget.

### Subjects that answer in every state

A served subject can set `availability: "always"` (the default is
`"whenRunning"`, the table above). The host then calls its `handle` whatever the
adapter's state, without holding the request, so a request is never lost while
the adapter is stopped, parked or restarting. A `handle` that throws still
counts as a served error and gets `unavailableReply` with reason `stopped`,
whatever the adapter's real state: the reasons describe the adapter's lifecycle,
and there is none for a failed handler.

State such a subject must keep lives in the adapter module's host state. A
registry entry loads an `AdapterModule`:

```ts
{
  hostState(): S,            // optional; runs once at host startup
  create(hostState: S): Adapter,
}
```

The host keeps the host state for the life of the process and passes it to
`create` and to every `handle` as `ctx.hostState`. It survives adapter stops
and restarts, so anything written while the adapter was down is there when it
starts again. A module without `hostState` gets `undefined`.

### Serving a subject from host code

Every request the host answers goes through one helper,
`HostRequests.serveRequest(scope, spec)` in `host/host-requests.ts`:

```ts
await requests.serveRequest<Req, Rep>(scope, {
  subject: "some.subject",
  budgetMs: 4_500,               // below the callers' timeout
  replyMode: "cloudevent",       // or "raw"
  replyType: "some.subject.result",
  parse: (raw) => /* parsed(value) or parseFailed("why") */,
  handle: async (req, { deadline, signal, arrivedAt }) => /* reply */,
  errorReply: (code, message) => /* reply for "invalid", "internal" or "expired" */,
});
```

- A message without a reply inbox is counted as `no_inbox`, logged and never
  handled, so a stray publish has no effect.
- A request that does not parse gets `errorReply("invalid", ...)`. A parser or
  handler that throws gets `errorReply("internal", ...)` and is logged.
- The deadline is arrival plus `budgetMs`, and `signal` aborts at it. Arrival is
  when the message comes off the bus, so time spent queued behind busy handlers
  counts. A request still queued at its deadline gets `errorReply("expired", ...)`
  without being handled; served subjects answer it as unavailable with reason
  `starting`.
- In `raw` mode the reply bytes go out unchanged. In `cloudevent` mode the reply
  is the `data` of a CloudEvent with a fresh `id`, the `replyType`, source
  `connectors` and the current `time`.
- Each subject keeps `received`, `replied`, `invalid`, `internal`, `expired`
  and `no_inbox` counts, shown in `/health`. Serving a subject twice is an error.

## The scoped bus

The host owns the one bus connection. Each adapter run gets a `ScopedBus` that
allows only the subjects in its manifest (`publishes`, `subscribes`,
`requests`; NATS `*` and `>` wildcards work) and refuses anything else with an
error naming the adapter and the subject. The host's own subscriptions use a
separate `host` scope.

Each subscription runs at most `WOOFX3_CONNECTORS_ADAPTER_CONCURRENCY` handlers
at once and queues up to `WOOFX3_CONNECTORS_ADAPTER_QUEUE_CAP` more; messages
beyond that are dropped, counted, and logged once per overload. A handler that
throws is logged and counted and does not end the subscription. When an adapter
stops, every subscription it made is closed and its running handlers are
awaited.

## The Twitch adapter

`connectors/src/adapters/twitch/` holds the engine's Twitch integration:
EventSub turned into bus events, and the `twitchapi` commands answered through
Helix (see [Twitch channel controls](./twitch-channel.md)). `adapter.ts` wraps
it for the host:

- **When it runs.** While Twitch is linked and enabled (`desired` is
  `connected && enabled`). Unlinking or disabling stops it, and linking or
  enabling starts it, with no restart.
- **Start.** Each start builds a fresh `TwitchApplication` from the adapter's
  scoped bus, the host's db-proxy client and the Twitch settings. It listens
  for `setting.integration.token.updated` (a relink while running swaps the
  token in place), then connects. A start that finds no token stored after all
  rejects, so the adapter goes `degraded` and is retried. When the host aborts
  a start, the connect gives up at its next step (reading the token, looking
  up the broadcaster, or waiting for EventSub to confirm) and closes whatever
  it had built.
- **Unlink.** An unlink clears the token and publishes the same
  `setting.integration.token.updated` as a relink. The running adapter ignores
  an update that leaves no token stored (debug log) and keeps its connection
  until the host reads the link as disconnected and stops it.
- **Stop.** Aborts a connect or relink still in progress, stops the ad
  heads-up scheduler, disconnects EventSub, closes the Twitch client, and
  waits for event publishes still in flight, all within the host's stop
  deadline. Nothing from a stopped run survives into the next start, so
  enable, disable and re-enable cycles leave one EventSub connection. A
  publish the bus refuses is logged with its subject and dropped. The host
  then closes the adapter's subscriptions.
- **Manifest.** Publishes every Twitch event subject
  (`@woofx3/common/cloudevents/Twitch/events`), subscribes to
  `setting.integration.token.updated`, requests `engine.twitch.token` and
  `engine.shoutout.enqueue` from the api, and serves `twitchapi` with a
  9_000 ms budget (`TWITCH_API_SERVED_BUDGET_MS`): below the 10_000 ms the
  api, the sandbox's `ctx.twitch` and woofwoofwoof's built-in commands wait,
  and above a Helix call's own 8_000 ms deadline. A served `helix` call gets
  the smaller of that deadline and the time left in the budget.
- **While it is down**, the host answers every `twitchapi` command with a
  `twitchapi.error` coded `not_linked` when no account is linked, else
  `integration_unavailable` (turned off, still connecting, or parked). The api
  reports the second as `unavailable`.
- **`/health` detail.** `broadcasterId` and `eventSub`
  `{established, expected, ready}`: how many EventSub subscriptions Twitch has
  confirmed. A subscription Twitch refused delivers no events at all, so a
  shortfall here is worth investigating even while the adapter is `connected`.

connectors pins its `@twurple/*` packages to the release
`shared/clients/typescript/twitch` resolves. TypeScript only treats the two
copies' classes as one type when name and version match, so upgrade both
lockfiles together.

## The OBS adapter

`connectors/src/adapters/obs/` holds the engine's one obs-websocket
connection (see [OBS control](./obs.md)). The local endpoint dialer and the
store it reads routes from live in `connectors/src/companion/` (see
[Local endpoints](./local-endpoints.md)).

- **When it runs.** Always. OBS being closed is not a reason to stop: the
  connection retries in the background with capped, jittered backoff.
- **Start.** Each start builds a fresh OBS service over the host's db-proxy
  client and the adapter's scoped bus, subscribes to
  `db.module.setting.updated.*` (a change to the `woofx3_obs` module's
  settings reconnects at once) and `engine.relay.config.updated` (a change
  that moves OBS to another route reconnects), and starts connecting. It
  resolves without waiting for OBS, so the adapter is `connected` while its
  loop runs, and a request while OBS is closed reaches the handler and is
  answered `OBS is not connected (retrying)` at once.
- **Stop.** Closes the OBS session and cancels any pending retry; the host
  then closes the adapter's subscriptions.
- **Manifest.** Publishes nothing, requests `engine.relay.credential` from the
  api, and serves:

| Subject | Budget | While the adapter is not running |
|---|---|---|
| `engine.obs.command` | 4_500 ms, below barkloader `ctx.obs`'s 5_000 | `{ok: false, error: "OBS is turned off in this engine"}`, or `"OBS is starting"` |
| `engine.obs.options` | 4_500 ms | `{error: ...}` with the same messages |
| `engine.obs.status` | 2_500 ms, below the api's 3_000 | `{state: "stopped", failure: null, address: null}` |
| `engine.obs.browser_source.refresh` | 1_500 ms, below sceneManager's 2_000 request timeout | answered in every state (below) |

- **Overlay refresh.** `engine.obs.browser_source.refresh` has availability
  `always`. The adapter module's host state is a refresh latch: the newest
  request and the last 16 boot ids already refreshed. A valid request is
  latched and accepted at once, whatever the adapter is doing; the running
  adapter, or the next one to start, refreshes on the current or next OBS
  session, once per boot id. See
  [Local endpoints → Overlay recovery](./local-endpoints.md#overlay-recovery).
- **`/health` detail.** `state`, `failure`, `route` and `address`, as in
  `engine.obs.status`; never the password or a bridge ticket.

### The stream session

Every event is stamped with the current stream session, which is held per
process. The host, not each adapter run, subscribes to `session.started` for
the life of the process, so an adapter that starts after a session change
still stamps the current session.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `WOOFX3_CONNECTORS_PORT` | `9102` | Loopback port of `/health`. Worktree slots use their base port + 6. |
| `WOOFX3_CONNECTORS_RECONCILE_INTERVAL_MS` | `60000` | Backstop: every link is read this often. |
| `WOOFX3_CONNECTORS_BACKOFF_BASE_MS` | `1000` | First retry ceiling. |
| `WOOFX3_CONNECTORS_BACKOFF_MAX_MS` | `300000` | Retry ceiling cap. |
| `WOOFX3_CONNECTORS_PARK_AFTER_FAILURES` | `5` | Failures that park an adapter... |
| `WOOFX3_CONNECTORS_PARK_WINDOW_MS` | `600000` | ...within this window. |
| `WOOFX3_CONNECTORS_STOP_DEADLINE_MS` | `10000` | How long one adapter's stop may take, abort and bus close included. |
| `WOOFX3_CONNECTORS_DB_PROXY_TIMEOUT_MS` | `2000` | Every db-proxy call (the startup ping, each link read) is aborted after this. |
| `WOOFX3_CONNECTORS_ADAPTER_CONCURRENCY` | `16` | Handlers one subscription runs at once. |
| `WOOFX3_CONNECTORS_ADAPTER_QUEUE_CAP` | `256` | Messages one subscription queues behind them. |
| `WOOFX3_CONNECTORS_SHUTDOWN_DEADLINE_MS` | `15000` | Whole-process shutdown before exit code 1. Must exceed the db-proxy timeout plus the larger of the stop deadline and the longest served budget, the platform gateway's included. |

The platform gateway's own settings (`WOOFX3_CONNECTORS_GATEWAY_*`) are listed
in [Platform gateway contract](./platform-gateway.md#configuration-and-health).

The Twitch adapter reads:

| Variable | Default | Meaning |
|---|---|---|
| `WOOFX3_TWITCH_CHANNEL_NAME` | none | The channel to watch; without it, the account that linked Twitch. |
| `WOOFX3_TWITCH_CLIENT_ID`, `WOOFX3_TWITCH_CLIENT_SECRET` | none | The engine's own Twitch app, which refreshes the token itself. Used only when both are set. |
| `WOOFX3_TWITCH_REDIRECT_URL` | `http://localhost` | That app's redirect URL. |
| `WOOFX3_TWITCH_MEMBERSHIP_ENRICHMENT_ENABLED` | `true` | Look up follower status and subscription tier for chatters. |
| `WOOFX3_TWITCH_MEMBERSHIP_TTL_MS` | `600000` | How long a looked-up answer is kept. |
| `WOOFX3_TWITCH_MEMBERSHIP_DEADLINE_MS` | `250` | How long a chat message waits on a lookup before it is published without it. |

The OBS adapter reads, for whatever the OBS module's settings leave empty:

| Variable | Default | Meaning |
|---|---|---|
| `WOOFX3_OBS_HOST` | `127.0.0.1` | Host running OBS. |
| `WOOFX3_OBS_PORT` | `4455` | OBS WebSocket server port, 1 to 65535. |
| `WOOFX3_OBS_RPC_TOKEN` | none | OBS WebSocket server password. |

The host also reads the bus settings (`WOOFX3_MESSAGEBUS_URL`, `_JWT`, `_NKEY`,
`_TOKEN`), `WOOFX3_DATABASE_PROXY_URL` and `WOOFX3_DB_PROXY_TOKEN`, the
service token db-proxy requires (it must pass the shared secret rule). Every
db-proxy call connectors makes carries it, the adapters' included. Invalid
values stop the process at startup with every bad key named.

## Health

`GET http://127.0.0.1:<WOOFX3_CONNECTORS_PORT>/health` answers `200` while the
bus is connected and the reconcile loop is running (its last pass is at most
two backstop intervals old), and `503` otherwise. An adapter's state never
makes it fail: a parked adapter is reported, and restarting the host would not
fix what parked it.

```json
{
  "status": "ok",
  "bus": { "connected": true },
  "loop": { "alive": true, "lastPassAt": "2026-10-21T12:00:00.000Z" },
  "adapters": [
    {
      "id": "twitch",
      "state": "parked",
      "reason": "could not connect",
      "since": null,
      "retryAt": null,
      "changedAt": "2026-10-21T11:58:00.000Z",
      "link": { "connected": true, "enabled": true },
      "counts": { "starts": 5, "failures": 5, "faults": 0, "servedErrors": 0, "stopTimeouts": 0 },
      "bus": { "refusals": 0, "subscriptions": {} },
      "detail": { "broadcasterId": null, "eventSub": null }
    }
  ],
  "counters": {
    "hostRequests": { "twitchapi": { "received": 3, "replied": 3, "invalid": 0, "internal": 0, "expired": 0, "no_inbox": 0 } },
    "hostBus": { "refusals": 0, "subscriptions": {} },
    "gateway": {
      "outcomes": { "twitch": { "chat.send": { "delivered": 12, "unavailable": 1 } } },
      "idempotency": { "replayed": 0, "coalesced": 0, "mismatched": 0, "held": 13 }
    }
  }
}
```

`detail` is whatever the adapter's optional `detail()` returns, for facts worth
seeing at a glance, and `null` when it has none or it throws (the throw is logged
once). The host replaces the value of any key whose name contains `password`,
`token`, `ticket` or `credential` (any case, at any depth) with `"[redacted]"`.
Adapters must still keep secrets out of `detail()`.

Any other path or method answers `404` with
`{"error": {"code": "not_found", "message": "..."}}`.

## Shutdown

SIGTERM, SIGINT and SIGBREAK (Windows) start one graceful shutdown through the
shared `installShutdown`: the health server closes, and the watcher stops once
any read in flight ends (at most the db-proxy timeout). Then, together, every
adapter is stopped in parallel under its stop deadline and the host's
subscriptions close; held requests are answered as their adapters stop, and
the close waits at most the larger of the stop deadline and the longest served
budget. The host refuses to start when the shutdown deadline does not cover
both steps. A second signal, or `WOOFX3_CONNECTORS_SHUTDOWN_DEADLINE_MS`
elapsing, exits with code 1.
