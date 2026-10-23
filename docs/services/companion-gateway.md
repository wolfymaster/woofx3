# Companion gateway

The companion gateway is the part of the connectors host that reaches
endpoints on the streamer's own network: OBS today, and later anything else a
module declares in its manifest's `local[]` (see
[Local endpoints](./local-endpoints.md)). It runs for the whole life of the
host, whether or not any adapter is running, and is the engine's one runtime
path to those endpoints.

It is device-agnostic. It knows:

- which host adapter **claims** each endpoint;
- how to reach each endpoint: directly, or through the companion's relay
  bridge;
- who may ask.

It knows no device protocol. Device logic lives in local adapters inside the
host (the `obs` adapter is the first), which ask the gateway for a route and
dial it themselves. Module code reaches only its own endpoints that no adapter
claims, by asking the gateway to write frames on a session the gateway holds
(see [Module requests](#module-requests)). In code and logs it is always "companion gateway", never
just "gateway", which already names the [platform gateway](./platform-gateway.md).

The code is in `connectors/src/companion/`:

| File | What it holds |
| --- | --- |
| `types.ts` | The contract: `LocalEndpointRef`, `EndpointResolution`, `CompanionHandle`, `CompanionGateway` |
| `claims.ts` | `ClaimRegistry`: which adapter owns which endpoint |
| `endpoints.ts` | `declaredEndpoint`: a module's `local[]` entry from its stored manifest |
| `route-policy.ts` | `RoutePolicy` and `adapterPolicy`: what a direct route may be |
| `module-route-policy.ts` | `modulePolicy`: which endpoints module code may reach, and how |
| `local-address.ts` | `checkLocalAddress`: whether a module endpoint's address is on the streamer's network |
| `endpoint-sessions.ts` | `EndpointSessions`: the websocket sessions held for module requests |
| `module-requests.ts` | `ModuleRequests`: answers `engine.companion.module.request` |
| `dialer.ts` | `EndpointDialer`: one resolution, direct or through the bridge |
| `bridge-opens.ts` | `BridgeOpens`: the cap on bridge opens in flight |
| `route-watch.ts` | `RouteWatch`: tells listeners when a route may have moved |
| `companion-gateway.ts` | `EngineCompanionGateway`, which puts them together |
| `endpoint-store.ts` | The db-proxy reads: manifest, settings, secrets, `relay.config` |

## Claims

An adapter lists the endpoints it owns in its manifest:

```ts
localEndpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }],
```

The host builds one `ClaimRegistry` from every registered adapter's manifest
at startup, before any adapter runs, so a claim is known while its adapter is
stopped. An endpoint claimed twice, or a ref whose ids the relay would not
accept as bridge path segments (`isModuleId`, `isEndpointId` in
`@woofx3/common/cloudevents/Relay/relay`), stops startup.

Each adapter gets the gateway as `ctx.companion`, a handle scoped to its own
claims, the way its `ctx.bus` is scoped to its manifest's subjects. Asking it
about an endpoint the adapter does not claim throws `UnclaimedEndpointError`,
naming the adapter and the endpoint: that is a bug in the adapter, not a
runtime condition. The gateway picks the route policy from the claim; no
caller passes one. A claimed endpoint resolves only for its own adapter,
under the adapter policy, so module code can never reach it around the
adapter's own checks (for OBS, `ctx.obs`'s allowlist and the `obs.control`
permission).

## Resolving a route

```ts
const resolution = await ctx.companion.resolve(
  { moduleId: "woofx3_obs", endpointId: "obs" },
  { signal, fallback }
);
```

`resolve` runs on every connect attempt and reads everything afresh: the
module's manifest, settings and secrets, the relay configuration and the
bridge credential. A retry therefore picks up a change whose announcement was
missed, and every bridge route carries a fresh single-use ticket.

It never rejects for an endpoint failure. The answer is a union:

- `{ ok: true, route, url, address, password? }`. `url` goes straight to the
  dialing library; through the companion it carries the ticket and is never
  logged or stored. `address` is `host:port`, or the bridge's host through the
  companion. `password` is the endpoint's own, carried end to end.
- `{ ok: false, reason, message, address? }`, with `address` set once the
  attempt reached the bridge.

| Reason | Meaning |
| --- | --- |
| `not_declared` | The module declares no such `local[]` endpoint, and the caller gave no fallback keys. |
| `adapter_owned` | A host adapter claims the endpoint. Only module requests get this. |
| `protocol_unsupported` | The endpoint is not a websocket. |
| `not_routed` | No route the policy allows, such as no address set. |
| `address_refused` | A direct address outside what the policy allows. |
| `store_unreadable` | db-proxy could not be read and the policy has no fallback for it. |
| `busy` | The bridge-open cap is reached, or the relay answered 429. |
| `relay` | No credential, the ticket exchange was refused or unanswered, or no ticket came back. |

Aborting `signal` rejects with its reason and abandons any bridge work in
flight. So does the gateway stopping.

### The adapter policy

For an endpoint an adapter claims. The adapter speaks the device's protocol
and is trusted with the address:

- The settings to read are the ones the `local[]` entry names. A module
  installed before `local[]` existed uses the fallback's keys (for OBS:
  `host`, `port`, `password`).
- Each empty setting, and a port that is not 1 to 65535, takes the adapter's
  own configuration from `fallback` (for OBS: `WOOFX3_OBS_HOST`,
  `WOOFX3_OBS_PORT`, `WOOFX3_OBS_RPC_TOKEN`).
- When db-proxy cannot be read, the configuration is used: a local endpoint is
  best-effort and must not stop on a db outage.
- Any address is allowed, on every hosting. An IPv6 address is bracketed in
  the URL.
- The password comes from the module's secret setting (`passwordSetting`).

### Routes

How an engine is run (`WOOFX3_HOSTING`) decides whether the bridge is used at
all:

| Hosting | `relay.config` lists the endpoint | Credential from the api | Route |
| --- | --- | --- | --- |
| `local` | ignored | not asked | direct |
| `self`, `managed`, unset | no | not asked | direct, if the policy allows it |
| same | yes | `null`, or a grant that leaves it out | direct, if the policy allows it |
| same | yes | a grant listing it | companion |
| same | yes | none to be had | `relay` |

On a `local` engine the bridge would loop through the cloud back to the same
machine, so an endpoint listed in `relay.config` is dialed directly and the
listing is logged once at warn per endpoint. Under the adapter policy, a
`relay.config` that cannot be read is logged at warn and the endpoint is
dialed directly when the policy produced a direct route; only the bridge needs
it. With no direct route either, and always under the module policy, the
answer is `store_unreadable`.

A refusal about the endpoint itself (`not_declared`, `adapter_owned`,
`protocol_unsupported`, `store_unreadable`) is the answer whatever
`relay.config` says: the bridge is tried only when the policy found no direct
route (`not_routed`, `address_refused`).

The companion route is the two-step ticket exchange described in
[Local endpoints → The ticket exchange](./local-endpoints.md#the-ticket-exchange):

- A 401 gets one more try with a fresh credential, for a cached credential the
  relay stopped accepting. A second 401 is `relay`.
- A 429 (the relay's limit of 16 outstanding tickets per companion) is `busy`.
- Any other refusal, no answer within the ticket timeout, or an answer without
  a ticket is `relay`.

The bridge credential comes from the api over `engine.relay.credential`, on
the host's bus scope.

### Bridge opens

Bridge opens in flight across the whole gateway are capped at
`WOOFX3_COMPANION_MAX_BRIDGE_OPENS` (8). One counts from before the ticket
exchange until its ticket expires (`expiresInMs` from the relay, 30 seconds),
because the relay counts a ticket until it is presented or expires and the
gateway cannot see it presented. Past the cap the answer is `busy`, without
asking for a credential. The cap must stay at or below the relay's 16, so the
gateway answers `busy` before the relay starts refusing; startup refuses a
larger value. A failed exchange releases its open at once, and stopping the
gateway releases them all.

## Route changes

`ctx.companion.onRouteChange(ref, listener)` calls `listener(why)` when the
endpoint's route may have moved, so the adapter reconnects and resolves
afresh. The gateway subscribes on the host's scope for the life of the host:

- `engine.relay.config.updated`: it re-reads `relay.config` and tells each
  endpoint it moves off the route its latest attempt took (onto a bridge, off
  one, or to another bridge). A configuration that cannot be read tells every
  endpoint. A `local` engine never takes the bridge, so nothing moves there.
- `db.module.setting.updated.*`: a write to any setting of the module that
  declares the endpoint.

One listener throwing is logged and never stops the others.

The `obs` adapter subscribes to nothing itself and requests no relay credential:
it resolves through `ctx.companion.resolve`, reconnects from `onRouteChange`, and
reads a bridge route's failure as `relay` (a refused password stays an
authentication failure).

## Module requests

Module code reaches its own declared `local[]` endpoints through one narrow
capability: it names the endpoint and a message, and the gateway checks it
may reach it, chooses the address, holds the socket and writes the frame. The
wire contract, `engine.companion.module.request`, is described in
[Companion gateway module requests](./companion-module-requests.md). The
gateway answers it on the host's scope with a raw JSON reply.

Only websocket endpoints are supported. The module's id in a request is the
one barkloader stamps from the invocation. It is trusted the way the platform
gateway trusts `requestedBy`: the subject is under the reserved `engine.`
prefix, so neither workflows nor uploaded modules can publish it, and every
request is logged with the module, endpoint and op.

### The module policy

Every request is checked, in order, with the stored manifest read afresh:

1. No host adapter claims the endpoint, or `adapter_owned`. Module code can
   never open a raw session to OBS around `ctx.obs` and its permission.
2. The installed manifest declares it in `local[]`, or `not_declared`.
3. It is a websocket endpoint, or `protocol_unsupported`.
4. db-proxy answers, or `store_unreadable`. There is no fallback to
   connectors' own configuration on this path.

A session is then opened on first use, through the same route table as the
adapters. Through the companion's bridge it needs `relay.config` and the
dashboard's grant to list the endpoint, on any hosting but `local`. A direct
dial depends on how the engine is run:

| `WOOFX3_HOSTING` | Direct dial for module requests |
| --- | --- |
| `local` | allowed |
| `self` | allowed only with `WOOFX3_MODULE_LOCAL_DIRECT=true`, otherwise `not_routed` |
| `managed`, unset | never: `not_routed`, "turn on the companion for this endpoint" |

The address comes only from the module's stored host and port settings, and
an empty one is `not_routed`. The password setting is never read: signing in
is the module's own protocol business. The host must be on the streamer's
network, or the answer is `address_refused`:

- Allowed: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
  169.254.0.0/16, `::1`, fe80::/10, fc00::/7, `localhost` (dialed as
  127.0.0.1), and `.local` names.
- Every form a socket library would read as an IPv4 address is parsed first:
  a decimal integer (`2130706433`), octal and hex parts (`0x7f.0.0.1`), and
  IPv4-mapped IPv6 (`::ffff:10.0.0.5`, checked as IPv4). An IPv6 zone id is
  dropped.
- A `.local` name is resolved once. Every address it resolves to must be
  allowed, and the first one is dialed as an IP literal, so the name cannot
  resolve somewhere else between the check and the dial. A name that does not
  resolve, or does not answer within 3 seconds, is refused.
- Cloud metadata (169.254.169.254, fd00:ec2::254) is refused on every hosting
  but `local`. The unspecified address, broadcast, multicast, other host
  names and public addresses are always refused.

Barkloader closes the other ways module code could aim a dial: it cannot
write a `local[]` host, port or password setting, a `hostSetting` default must
be empty or loopback, and an install or upgrade resets a new or renamed host or
port setting.

### Sessions

The gateway holds one websocket per endpoint, opened on the first request,
with no subprotocol. A module function runs for seconds at most, so it never
holds a socket itself.

- **Session epoch.** Every open gets a new `sessionEpoch`, returned in every
  reply. A session is closed when nobody has used it for 2 minutes, when its
  route may have moved (a relay configuration change or a write to one of the
  module's settings), when the device closes it, and on shutdown; the next
  request opens a new one silently. A device that wants one sign-in per
  connection (VTube Studio, Streamlabs Desktop, Streamer.bot) needs the module
  to sign in again whenever the epoch changes.
- **Opening.** An open has its own 10 second limit, independent of any
  request: resolving the route, with the bridge's credential and ticket
  exchange, and the upgrade. A request whose budget ends first is answered
  `unavailable` ("still connecting") and the open carries on, so the next
  request finds it. A bridge open takes a fresh ticket and counts toward the
  [bridge-open cap](#bridge-opens) like an adapter's. A failed open is not
  kept: the next request tries again.
- **`send`** writes one text frame and answers `ok`.
- **`request`** registers a waiter, then writes one text frame. The first
  inbound JSON object whose top-level `match.field` equals `match.value`
  (strictly: the string `"1"` never matches the number 1) answers it, with the
  frame's raw text. Frames that match nothing are counted and dropped. A
  second pending request with the same match on one session is refused with
  `busy`, so concurrent invocations never take each other's replies. No match
  before the budget runs out is `timeout`.
- **Budget.** A request is served until the earlier of 4.5 seconds and its own
  `budgetMs` from arrival, below barkloader `ctx.local`'s 5 second request
  timeout. Nothing is written once it has passed.

| Limit | Value | Past it |
| --- | --- | --- |
| Sessions open or opening | 32 | `busy`. Bridge sessions are further limited by the bridge-open cap and the relay's 16 tickets. |
| Requests pending on one session | 16 | `busy` |
| Frame size, either way | 65,536 bytes | an outbound one is `invalid`; an inbound one is dropped and counted |
| Idle time | 2 minutes | the session is closed |
| One open | 10 seconds | `unavailable` |
| One `.local` name lookup | 3 seconds | `address_refused` |

How an endpoint failure reads in a module reply: the gateway's reasons pass
through as codes of the same name, and `relay` (no credential, a refused or
unanswered ticket exchange) is `unavailable`, like a socket that would not
open or closed with the request pending. A request the host could not handle
is `unavailable`, and one that waited past its budget for a free handler is
`timeout`.

## Health

`/health` has a `companion` section (see
[Connectors host → Health](./connectors.md#health)):

```json
"companion": {
  "hosting": null,
  "endpoints": [
    {
      "moduleId": "woofx3_obs",
      "endpointId": "obs",
      "owner": "obs",
      "route": "companion",
      "address": "c-1234.woofx3.tv",
      "lastFailure": { "reason": "relay", "message": "the companion relay refused the bridge (503)", "at": "2026-10-22T12:00:00.000Z" }
    }
  ],
  "bridgeOpens": { "inUse": 0, "limit": 8, "refused": 0 },
  "modules": {
    "sessions": {
      "sessions": [
        {
          "moduleId": "vtube_studio",
          "endpointId": "vts",
          "route": "direct",
          "address": "192.168.1.20:8001",
          "sessionEpoch": "6f1c2d3e-...",
          "openedAt": "2026-10-22T12:00:00.000Z",
          "pending": 0
        }
      ],
      "opening": 0,
      "limit": 32,
      "opens": 3,
      "openFailures": { "not_routed": 1 },
      "closes": { "idle": 2, "route_change": 0, "remote": 0, "stopped": 0 },
      "frames": { "oversized": 0, "binary": 0, "unmatched": 14 }
    },
    "requests": { "send": { "ok": 40 }, "request": { "ok": 12, "timeout": 1 } }
  }
}
```

`modules` shows the sessions held for module requests, opens and why they
failed, why sessions closed, inbound frames that answered nothing, and the
requests answered by op and outcome. Every claimed endpoint is listed from startup. `route` and `address` are where
the latest resolution went, null before the first; `lastFailure` is kept until
a resolution succeeds. The section never carries a ticket, credential or
password, and is redacted like adapter detail all the same.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WOOFX3_HOSTING` | unset | `local`, `self` or `managed`; see [Deploying the engine](./deployment.md#readiness-and-version). Any other value stops connectors at startup. |
| `WOOFX3_COMPANION_MAX_BRIDGE_OPENS` | `8` | Bridge opens in flight at once, 1 to 16. |
| `WOOFX3_COMPANION_TICKET_TIMEOUT_MS` | `5000` | One ticket exchange with the relay. |
| `WOOFX3_MODULE_LOCAL_DIRECT` | `false` | `true` lets module requests on a `self` engine dial their endpoint directly. Any value but `true` or `false` stops connectors at startup. |

The bridge credential request waits 5000 ms. An OBS attempt through the
companion makes that request and the ticket exchange inside its open
deadline, so startup refuses a `WOOFX3_OBS_OPEN_TIMEOUT_MS` that does not
exceed their sum.
