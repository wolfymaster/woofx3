# Connectors host

`connectors` is the Bun service that holds the engine's connections to
third-party platforms and local apps. Each connection is an **adapter**. The
**host** is the always-on part around them: it reads whether each adapter is
linked and enabled, runs the adapter only while it should run, and answers the
request subjects adapters serve even while they are down.

The host currently ships with no adapter registered and is not listed in
`build/config/services.json`, so a packaged engine does not start it. It can be
run by hand (`cd connectors && bun run start`) and answers `/health`.

```
           setting.integration.*.updated
api ──────────────────────────────────────▶ settings watcher ──▶ supervisor ──▶ adapter start/stop
                                                  │                    │
                                       db-proxy ◀─┘ (link readers)     ▼
caller ── request (e.g. twitchapi) ──▶ served subjects ──▶ adapter handler, or an "unavailable" reply
```

Code lives in `connectors/src/host/`; `server.ts` only wires it to the shared
runtime (see [Runtime](./runtime.md)).

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
| `WOOFX3_CONNECTORS_SHUTDOWN_DEADLINE_MS` | `15000` | Whole-process shutdown before exit code 1. Must exceed the db-proxy timeout plus the larger of the stop deadline and the longest served budget. |

The host also reads the bus settings (`WOOFX3_MESSAGEBUS_URL`, `_JWT`, `_NKEY`,
`_TOKEN`) and `WOOFX3_DATABASE_PROXY_URL`. Invalid values stop the process at
startup with every bad key named.

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
      "detail": null
    }
  ],
  "counters": {
    "hostRequests": { "twitchapi": { "received": 3, "replied": 3, "invalid": 0, "internal": 0, "expired": 0, "no_inbox": 0 } },
    "hostBus": { "refusals": 0, "subscriptions": {} }
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
