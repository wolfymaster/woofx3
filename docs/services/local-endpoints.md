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
OBS ◀─ws 127.0.0.1:4455─ companion ══(outbound wss)══ relay ◀══wss /bridge/…══ endpoint dialer ◀─ sceneManager
```

Everything here needs the `modules.localEndpoints` capability
([Engine capabilities](./engine-capabilities.md)). An engine the dashboard
never sent a relay configuration behaves exactly as without it: every endpoint
is dialed directly.

## The endpoint dialer

sceneManager is the only engine service that holds a connection to a local
endpoint, OBS's (`woofx3_obs/obs`), so the dialer lives in
`sceneManager/src/endpoints/dialer.ts`. It runs on every connect attempt, and
reads everything afresh each time, so a retry picks up a change whose
announcement was missed.

1. It finds the endpoint's settings from the module's stored manifest
   (`modules.manifest`, the `local[]` entry with that `id`). A module installed
   before `local[]` existed uses the caller's fallback keys; for OBS those are
   `host`, `port` and `password`.
2. It builds the direct address from those settings, each falling back to
   sceneManager's own configuration (`WOOFX3_OBS_HOST`, `WOOFX3_OBS_PORT`,
   `WOOFX3_OBS_RPC_TOKEN`) when empty or unreadable.
3. It picks the route:

| Relay configuration (`relay.config`) | Credential from the api | Route |
|---|---|---|
| None | not asked | Direct: `ws://<host>:<port>` |
| Does not list the endpoint | not asked | Direct |
| Lists the endpoint | `null` (the dashboard no longer routes anything) | Direct |
| Lists the endpoint | A grant whose endpoints leave it out | Direct |
| Lists the endpoint | A grant that lists it | Bridge: ticket exchange, then `wss://<bridge host>/bridge/<moduleId>/<endpointId>?ticket=<t>` |
| Lists the endpoint | None to be had (the api or dashboard did not answer) | Fails as `relay` |

A relay that refuses the ticket exchange (any non-2xx: 401, 404, 429, 502,
503), does not answer within 5 seconds, or answers without a ticket also fails
as `relay`. A 401 first gets one more try with a fresh credential
(`force`), for a cached credential the relay stopped accepting. Once the
ticket is in hand, any failure to open OBS through the bridge other than OBS
refusing the password is also `relay`: the relay refusing the upgrade (502,
503), the companion refusing the endpoint (4403), or the companion not
reaching OBS. The attempt then waits out sceneManager's usual backoff, and
`getObsStatus` reports `failure: "relay"` with `route: "companion"` and the
bridge's host, so the dashboard can tell "your companion is offline" from "OBS
is closed".

The relay closes a bridge with 4401 a minute after the engine credential it
was opened with expires. That is an ordinary disconnect: OBS's connection
reconnects through its usual backoff, and the new attempt gets a fresh
credential (the api renews it a minute before it expires) and a fresh ticket.

The endpoint's own password (OBS's) is read from the module's settings on
both routes. Its protocol authentication runs end to end, between
sceneManager and OBS: the relay and the companion carry the challenge
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
sceneManager re-reads the configuration and reconnects to OBS only when the
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
stored. When the dialer needs one, sceneManager asks the api on NATS
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

Only the api talks to the dashboard. sceneManager never holds the dashboard's
address or credentials, as for the Twitch token (`engine.twitch.token`).

## The ticket exchange

obs-websocket-js opens its own WebSocket from a URL and sets the subprotocol
itself, so it cannot send an `Authorization` header. The dialer therefore
opens the bridge in two steps:

1. `POST https://<bridge host>/bridge/<moduleId>/<endpointId>` with
   `Authorization: Bearer <credential>` returns
   `{ "ticket": "<43 base64url characters>", "expiresInMs": 30000 }`.
2. The connection opens `wss://<bridge host>/bridge/<moduleId>/<endpointId>?ticket=<ticket>`.

A ticket is single-use (spent on first presentation, even when that upgrade is
refused), bound to the host, module and endpoint, and lives 30 seconds, so a
ticket in a log is harmless where a five-minute credential would not be. The
dialer fetches a fresh one on every connect attempt and never reuses one.
`getObsStatus` reports the bridge's host as the address, never the path or
the ticket.

The relay passes WebSocket subprotocols end to end: the companion offers OBS
whatever sceneManager offered, and the relay answers the upgrade with OBS's
choice. Under Bun, sceneManager imports obs-websocket-js's msgpack build, so it
offers `obswebsocket.msgpack` and the bridge carries binary messages.

## Why the companion decides the address

A bridge request names only `(moduleId, endpointId)`. The engine never tells
the companion an address. The companion dials only an address it discovered
itself or the streamer confirmed in its own window, and only for an enabled
endpoint of a module installed on its instance. Module settings can be written
by any instance member, a compromised engine or a malicious module's defaults,
so if the companion dialed what the settings say, `192.168.1.1:80` would give a
cloud engine a pipe to the streamer's router. See
[Engine integrity → Reach into the streamer's network](./engine-integrity.md#reach-into-the-streamer-s-network).
