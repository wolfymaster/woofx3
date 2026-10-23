# Local endpoints and the companion bridge

A module that controls something on the streamer's own network (OBS today;
lights and VTube Studio later) declares it in its manifest's `local[]` (see
[Module format → Local endpoints](../barkloader/modules.md#local-endpoints-local)).
The module states facts only: what it reaches and which of its settings hold
the address. The engine decides how to reach it.

A local engine on the streamer's PC dials the address straight away. A cloud
engine cannot reach `127.0.0.1` on the streamer's PC, so the woofx3 companion,
a tray app on that PC, dials out to a relay, and the engine reaches the
endpoint through it: the **bridge**.

```
OBS ◀─ws 127.0.0.1:4455─ companion ══(outbound wss)══ relay ◀══wss /bridge/…══ companion gateway ◀─ connectors (obs adapter)
```

Everything here needs the `modules.localEndpoints` capability
([Engine capabilities](./engine-capabilities.md)). An engine the dashboard
never sent a relay configuration behaves exactly as without it: every endpoint
is dialed directly.

## The companion gateway

The connectors host's [companion gateway](./companion-gateway.md) is the only
part of the engine that finds a route to a local endpoint, and its `obs`
adapter the only part that holds a connection to one, OBS's
(`woofx3_obs/obs`). On every connect attempt the gateway reads the module's
stored manifest, settings and secrets and the relay configuration afresh,
builds the direct address (each empty setting falling back to connectors' own
`WOOFX3_OBS_*` configuration), and picks the route; see
[Companion gateway → Routes](./companion-gateway.md#routes) for the table.

Once the ticket is in hand, any failure to open OBS through the bridge other
than OBS refusing the password is also `relay`: the relay refusing the upgrade
(502, 503), the companion refusing the endpoint (4403), or the companion not
reaching OBS. The attempt then waits out the OBS connection's usual backoff,
and `getObsStatus` reports `failure: "relay"` with `route: "companion"` and
the bridge's host, so the dashboard can tell "your companion is offline" from
"OBS is closed". A relay answering 429, or the gateway's own cap on bridge
opens, reads the same way to the streamer and is retried on the same backoff.

The relay closes a bridge with 4401 a minute after the engine credential it
was opened with expires. That is an ordinary disconnect: OBS's connection
reconnects through its usual backoff, and the new attempt gets a fresh
credential (the api renews it a minute before it expires) and a fresh ticket.

The endpoint's own password (OBS's) is read from the module's settings on
both routes. Its protocol authentication runs end to end, between
connectors and OBS: the relay and the companion carry the challenge
response, never the password.

## The relay configuration (`relay.config`)

The dashboard (Convex) decides which endpoints go through the companion and
tells the engine with `setRelayConfig`:

```json
{
  "bridgeOrigin": "https://c-abcdefghijkl.woofx3.tv",
  "endpoints": [{ "moduleId": "woofx3_obs", "endpointId": "obs" }]
}
```

The api checks it (an `https:` origin with no path, query or credentials; at
most 50 endpoints; manifest ids and endpoint ids of the right shape), stores it
in engine setting `relay.config` with the engine client id of the dashboard
that sent it, and publishes `engine.relay.config.updated`. `setRelayConfig(null)`
deletes the setting and publishes the same subject. On that subject
the obs adapter re-reads the configuration and reconnects to OBS only when the
change moves OBS to another route: onto or off the bridge, or to another
bridge host.

The api writes `relay.config` from two places, `setRelayConfig` and a
dashboard answer that replaces or clears it, so all writes run behind one lock.
A `setRelayConfig` call also invalidates any renewal already under way: its
answer, which was for the old configuration, is neither written nor cached,
and the renewal starts over.

The configuration survives a restart, so the engine knows from its own
database to use the bridge. Engine `settings` writes publish no event of their
own, which is why the api publishes one.

## The bridge credential

The credential that opens the bridge lasts five minutes and is never pushed or
stored. When the companion gateway needs one, it asks the api on NATS
`engine.relay.credential` (request `{ "force"?: boolean }`, reply
`{ "relay": <grant> | null }` or `{ "error": "…" }`, 5 second timeout). The api
caches the grant until a minute before it expires, and otherwise asks the
dashboard with the `relay.credential.requested` request (the same URL, Bearer
token and envelope as every callback, answered in the response body):

```json
{
  "relay": {
    "bridgeOrigin": "https://c-abcdefghijkl.woofx3.tv",
    "endpoints": [{ "moduleId": "woofx3_obs", "endpointId": "obs" }],
    "credential": "wfxr1.<kid>.<claims>.<signature>",
    "expiresAt": 1700000300000
  }
}
```

The answer is authoritative. `{ "relay": null }` clears `relay.config` and
announces it; an answer naming another bridge or other endpoints replaces the
stored configuration. So an engine that was down when the dashboard sent
`setRelayConfig(null)` stops dialing the bridge the next time it asks for a
credential. A `setRelayConfig` call drops the cached credential, which may be
for another bridge.

The dashboard asked is the one whose engine client id was stored with the
configuration. If that client is no longer registered (the dashboard
registered again), the api asks a registered dashboard instead and stores its
client id.

Only the api talks to the dashboard. connectors never holds the dashboard's
address or credentials, as for the Twitch token (`engine.twitch.token`).

## The ticket exchange

obs-websocket-js opens its own WebSocket from a URL and sets the subprotocol
itself, so it cannot send an `Authorization` header. The bridge is therefore
opened in two steps:

1. `POST https://<bridge host>/bridge/<moduleId>/<endpointId>` with
   `Authorization: Bearer <credential>` returns
   `{ "ticket": "<43 base64url characters>", "expiresInMs": 30000 }`.
2. The connection opens `wss://<bridge host>/bridge/<moduleId>/<endpointId>?ticket=<ticket>`.

A ticket is single-use (spent on first presentation, even when that upgrade is
refused), bound to the host, module and endpoint, and lives 30 seconds, so a
ticket in a log is harmless where a five-minute credential would not be. The
companion gateway fetches a fresh one on every connect attempt and never
reuses one.
`getObsStatus` reports the bridge's host as the address, never the path or
the ticket.

The relay passes WebSocket subprotocols end to end: the companion offers OBS
whatever the obs adapter offered, and the relay answers the upgrade with OBS's
choice. Under Bun, connectors imports obs-websocket-js's msgpack build, so it
offers `obswebsocket.msgpack` and the bridge carries binary messages.

## Overlay recovery

After sceneManager restarts, the browser sources in OBS that show its overlays
hold connections to a process that is gone. They are recovered by
pressing "refresh cache of current page" on those browser sources, found by
their URL (the overlay port and a `/scene/` path), once per start. A refresh
cuts off whatever an overlay is playing, so it is tied to the start and never
to a reconnect.

The refresh is a request on the bus, not a call made when OBS connects:

```
sceneManager ──engine.obs.browser_source.refresh {overlayPort, bootId}──▶ connectors host (obs adapter)
             ◀──{status: "accepted", bootId} | {status: "invalid", error}──┘
```

- After its HTTP server listens, sceneManager sends the request with the port
  it listens on and a `bootId` that names this start. It repeats the request
  until a reply accepts it, so it is not lost when connectors starts later
  or restarts. Only shutdown ends the retrying. A missing
  responder, a timeout or an invalid reply each wait and retry, with a doubling,
  jittered delay capped at a maximum.
- The connectors host answers the subject for as long as it runs, whatever
  the obs adapter is doing, and keeps the request in the adapter's host state,
  which outlives the adapter's runs. A request that arrives while the adapter is
  stopped or restarting is accepted and waits for its next run.
- The adapter refreshes at once when an OBS session is open and otherwise on
  the next session. Each `bootId` refreshes at most once: a repeated request
  for one waiting, being refreshed or already consumed is accepted and changes
  nothing (the last 16 consumed ids are remembered), and a reconnect or an
  adapter restart with no new request refreshes nothing. A request that arrives
  during a refresh runs once more after it.
- Without a message bus sceneManager cannot ask, and logs that once at warn.

| Setting | Default | Meaning |
|---|---|---|
| `WOOFX3_SCENE_MANAGER_OBS_REFRESH_REQUEST_TIMEOUT_MS` | `2000` | How long one request waits for a reply. |
| `WOOFX3_SCENE_MANAGER_OBS_REFRESH_RETRY_BASE_MS` | `1000` | The first retry's delay ceiling; it doubles. |
| `WOOFX3_SCENE_MANAGER_OBS_REFRESH_RETRY_MAX_MS` | `30000` | The ceiling the delay stops growing at. |

The client-side reconnect loop in the overlay page remains the fallback for
everything this cannot cover: OBS not running, OBS started after the overlays,
or a scene open in a plain browser tab.

## Why the companion decides the address

A bridge request names only `(moduleId, endpointId)`. The engine never tells
the companion an address. The companion dials only an address it discovered
itself or the streamer confirmed in its own window, and only for an enabled
endpoint of a module installed on its instance. Module settings can be written
by any instance member, a compromised engine or a malicious module's defaults,
so if the companion dialed what the settings say, `192.168.1.1:80` would give a
cloud engine a pipe to the streamer's router. See
[Engine integrity → Reach into the streamer's network](./engine-integrity.md#reach-into-the-streamer-s-network).
