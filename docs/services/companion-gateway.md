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
dial it themselves. In code and logs it is always "companion gateway", never
just "gateway", which already names the [platform gateway](./platform-gateway.md).

The code is in `connectors/src/companion/`:

| File | What it holds |
| --- | --- |
| `types.ts` | The contract: `LocalEndpointRef`, `EndpointResolution`, `CompanionHandle`, `CompanionGateway` |
| `claims.ts` | `ClaimRegistry`: which adapter owns which endpoint |
| `endpoints.ts` | `declaredEndpoint`: a module's `local[]` entry from its stored manifest |
| `route-policy.ts` | `RoutePolicy` and `adapterPolicy`: what a direct route may be |
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
listing is logged once at warn per endpoint. A `relay.config` that cannot be
read is logged at warn and the endpoint is dialed directly when the policy
produced a direct route; only the bridge needs it. With no direct route either,
the answer is `store_unreadable`.

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
  "bridgeOpens": { "inUse": 0, "limit": 8, "refused": 0 }
}
```

Every claimed endpoint is listed from startup. `route` and `address` are where
the latest resolution went, null before the first; `lastFailure` is kept until
a resolution succeeds. The section never carries a ticket, credential or
password, and is redacted like adapter detail all the same.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WOOFX3_HOSTING` | unset | `local`, `self` or `managed`; see [Deploying the engine](./deployment.md#readiness-and-version). Any other value stops connectors at startup. |
| `WOOFX3_COMPANION_MAX_BRIDGE_OPENS` | `8` | Bridge opens in flight at once, 1 to 16. |
| `WOOFX3_COMPANION_TICKET_TIMEOUT_MS` | `5000` | One ticket exchange with the relay. |

The bridge credential request waits 5000 ms. An OBS attempt through the
companion makes that request and the ticket exchange inside its open
deadline, so startup refuses a `WOOFX3_OBS_OPEN_TIMEOUT_MS` that does not
exceed their sum.
