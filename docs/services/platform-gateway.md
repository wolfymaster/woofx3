# Platform gateway contract

The platform gateway is the engine's one way to produce an effect on a
streaming platform: post a chat line, announce, pin. A caller names an
**action** and a **target** (one platform, several, every platform, or wherever
the triggering event came from) and gets back what happened on each platform.
Callers never branch on the platform; adding a platform or an action changes
the contract and the adapters, not the callers.

This page describes the wire contract every side shares: the subjects, the
action catalog, the request and reply shapes, how each is validated, how
per-platform outcomes become a reply's `ok`, and how connectors serves it.

## One contract, generated

The contract is one file, `shared/common/contracts/platform-gateway.json`.
Code for each language is generated from it, never written by hand:

| Language | Generated file | Imported as |
| --- | --- | --- |
| Go | `shared/common/golang/platformgateway/catalog_gen.go` | `github.com/wolfymaster/woofx3/common/platformgateway` |
| TypeScript | `shared/clients/typescript/api/platform-gateway.gen.ts` | `@woofx3/api/platform-gateway` |

`@woofx3/api/platform-gateway` is `platform-gateway.ts`, which re-exports the
generated file and adds the outcome policy (`outcomeCountsAsDelivered`,
`replyOk`). TypeScript is generated rather than inferred from the JSON
because the payloads are a discriminated union: checking a request's `action`
narrows its `payload` to that action's type (`EgressPayloads[A]`), which a
type read from JSON at run time cannot do.

The generator is a Go program in its own module, `shared/common/contracts/gen`,
with one emitter per language. It refuses unknown keys and contradictory
entries (a duplicate platform, action, field or enum value, an unbounded
field, overlapping variants), so a mistake in the contract stops generation.

After editing the contract:

```bash
scripts/gen-contracts.sh           # rewrite the generated files
scripts/gen-contracts.sh --check   # fail if any generated file is stale
scripts/check.sh contracts         # the same check, as check.sh runs it
```

The generator's own test compares fresh output with the committed files, so CI
fails on a contract, template or emitter change that was not regenerated.

## Adding an action

1. Add the entry to `platform-gateway.json`: the id, its payload fields (or
   `oneOf` variants) with a maximum length on every string and a range on
   every integer.
2. Run `scripts/gen-contracts.sh`. The Go constants, payload types and
   validators, and the TypeScript types and parsers, all appear.
3. Add request cases to the shared fixtures, valid and invalid, so both
   languages pin the new rules.
4. Give each adapter that can perform the action an egress handler for it. An
   adapter without one reports `unsupported` for that platform.

Outcome shapes (which fields each status carries) are not in the JSON; they
live in `outcomeShapes` in `shared/common/contracts/gen/contract.go`. A new
outcome status needs a shape there, and so generator code.

## Subjects

All three are request/reply.

| Subject | Purpose |
| --- | --- |
| `platform.gateway.send` | Perform one action on the target's platforms. |
| `platform.gateway.capabilities` | Which platforms are linked and running, and which actions each supports. |
| `platform.gateway.field_options` | The platforms that can perform one action, as options for a select field. |

## Actions

Each action declares its payload as a set of fields, or as `oneOf` variants
with disjoint field names; the fields a payload carries pick its variant.
Every string has a maximum length and every integer a range. Lengths count
Unicode code points, the same in both languages.

| Action | Payload |
| --- | --- |
| `chat.send` | `message` (required, up to 500), `replyToMessageId` (up to 200) |
| `chat.announce` | `message` (required, up to 500) |
| `chat.pin` | `{ messageId }` to pin an existing line, or `{ message, durationSeconds? }` to post and pin one; `durationSeconds` is 30 to 1200 |

A payload is refused when it is not an object, carries a field its action does
not declare, mixes fields of two variants, matches no variant, or has a value
of the wrong type or out of bounds. An empty optional string counts as absent.

## Requests

```ts
{
  action: "chat.send",
  target: { kind: "origin", origin: { platform: "twitch", messageId: "..." } },
  payload: { message: "hello chat" },
  options: { twitch: { color: "blue" } },     // optional, per platform
  idempotencyKey: "exec-1:task-1",
  requestedBy: { kind: "workflow", ref: "workflow-1" },
  workflowChain: "workflow-a,workflow-b"       // optional
}
```

- **target** is one of `{ kind: "all" }`, `{ kind: "platforms", ids }` with at
  least one platform and none twice, or `{ kind: "origin", origin }` naming the
  platform event being answered. A kind refuses the fields it does not use.
- **options** holds extras for one platform's adapter, keyed by platform id. The
  contract checks only that each key is a known platform; the adapter validates
  the value.
- **idempotencyKey** identifies the caller's intent, so a retried request is not
  performed twice. It is 1 to 200 characters.
- **requestedBy** names the engine component sending the request: `workflow`,
  `dispatcher` or `api`, plus a reference of 1 to 200 characters. It is logged,
  not authenticated.
- **workflowChain** is the sending run's `workflowChain`, in the same
  comma-joined form workflow events carry, so the platform's echo of a posted
  line can carry it back to the workflow loop guard. It is at most 1607
  characters: eight workflow ids of 200 characters and the commas between them.
  Eight matches the workflow loop guard's limit.

The TypeScript parser (`parseGatewayRequest`) refuses unknown keys at every
level, so a misspelt field fails instead of being dropped. The Go validator
(`GatewayRequest.Validate`) checks the same rules, but only on the fields
`encoding/json` decoded: Go matches keys case-insensitively and drops unknown
ones, so it does not refuse a misspelt or differently-cased key. The shared
fixtures leave those cases out. In both languages JSON null counts as absent.
Neither checks that the target's platforms support the action; only the
gateway knows which adapters are running.

## Replies

```ts
{
  ok: true,
  results: { twitch: { status: "delivered", messageId: "..." } }
}
```

`results` has one outcome per platform the target resolved to. Each outcome's
`status` decides its other fields:

| Status | Fields | Meaning |
| --- | --- | --- |
| `delivered` | `messageId?` | The platform posted it. |
| `dropped` | `reason` | The platform accepted the call but held the line (for example AutoMod). |
| `unsupported` | | The platform cannot perform this action. |
| `unavailable` | `reason`: `not_linked`, `disabled`, `stopped`, `starting` or `parked` | The platform could not take the request. |
| `unconfirmed` | `message` | The call was sent but no answer came in time; the platform may have acted, so it must not be resent. |
| `failed` | `code`: `invalid`, `rate_limited`, `forbidden` or `upstream`; `message`; `messageId?` | The platform refused or errored. `messageId` is set when part of the action happened, such as a line posted but not pinned. |

A request refused as a whole (for example an invalid payload) gets
`{ ok: false, results: {}, error: { code, message } }`.

Reply parsers ignore unknown keys and fields that belong to another status, so
a reply can grow fields before every reader knows them. They refuse unknown
platforms and statuses, outcomes missing the fields their status needs, and a
reply without `ok`. JSON null counts as absent for `error` and the optional
fields. In Go a reply without `ok` is refused when it is decoded
(`json.Unmarshal` returns the `ValidationError`), since the decoded struct
cannot tell a missing `ok` from `false`.

### When a reply is ok

`replyOk(target, results)`:

- **platforms** and **origin**: every platform the target names delivered.
- **all**: at least one platform delivered. A platform that cannot do the
  action does not fail the others; a target that resolved to no platform is
  not ok.

Only `delivered` counts (`outcomeCountsAsDelivered`). An `unconfirmed` line
may have posted, but counting it would report success nobody can confirm.

## The gateway in connectors

The [connectors host](./connectors.md) serves `platform.gateway.send` itself,
for the whole life of the process, whatever its adapters are doing. The
request is the bare request JSON above; the reply is the `data` of a
CloudEvent of type `platform.gateway.send.result` with source `connectors`.
A message published without a reply inbox is counted and ignored, so a stray
publish never posts anything.

### Resolving the target

| Target | Platforms it goes to |
| --- | --- |
| `all` | Every platform whose account is linked and enabled. One whose adapter cannot perform the action is reported `unsupported`; unlinked and disabled ones are left out. With none left the reply is `{ ok: false, results: {} }`. |
| `platforms` | Exactly the named ones. Naming a platform whose adapter cannot perform the action (or is not loaded) refuses the whole request as `invalid`: the caller chose it. |
| `origin` | The origin's platform. One that cannot perform the action is reported `unsupported`, since the event chose it. For `chat.send`, the origin's `messageId` becomes the payload's `replyToMessageId` unless the payload names one. `channelId` is not used: an adapter speaks for one channel. |

### Each platform's outcome

The action goes to every platform at once, and the reply waits for all of
them, so a slow platform never delays a fast one beyond its own answer. For
each platform:

1. Options for it (`options[platform]`) are checked by its adapter. Bad
   options, or options for an adapter that takes none, fail only that
   platform, with `failed`/`invalid`.
2. An unlinked platform is `unavailable`/`not_linked`, a disabled one
   `unavailable`/`disabled`.
3. A stopped or parked adapter is `unavailable` with that reason at once. One
   that is starting, retrying or stopping is waited for until the deadline;
   if it connects in time it gets the request, otherwise it is
   `unavailable`/`starting`.
4. The adapter's handler answers with an outcome. A handler that throws, or
   returns something outside the contract, is `failed`/`upstream`.
5. At the deadline a handler still running is cut off. If it had already
   sent the request to the platform it is `unconfirmed` (the platform may
   have acted, so it must not be resent); if not, it is `failed`/`upstream`,
   "did not reach the platform before the deadline".

The gateway never retries a platform. The reply's `ok` follows `replyOk`.

### Deadlines

| Who | Waits |
| --- | --- |
| A platform adapter's own call (Twitch Helix) | 8 s |
| The gateway, for every platform of one request | 9 s (`WOOFX3_CONNECTORS_GATEWAY_ADAPTER_DEADLINE_MS`) |
| Callers of `platform.gateway.send` | 12 s |

The deadline runs from when the request arrives, so time spent queued behind
busy requests counts. Each layer waits longer than the one below it, so a
caller always gets per-platform results rather than a timeout. The gateway
deadline must stay below 12 s; a higher value stops connectors at startup.

### Idempotency

The gateway keeps the replies it sent, keyed by `requestedBy.kind` plus
`idempotencyKey`, together with a hash of the whole request:

- The same key and the same request within the TTL gets the stored reply
  again, without reaching any platform. This holds for a reply that was not
  ok, too, as long as some platform delivered, dropped or left it unconfirmed.
  A reply in which nothing reached a platform (every platform unavailable,
  unsupported or failed) is not stored, so retrying the key after a transient
  outage makes a real attempt.
- The same key with a different request is refused as `invalid`.
- A repeat that arrives while the first is still running waits for it and
  gets its reply.
- A request refused as a whole (an invalid request or target) is not stored,
  so its key stays free.

Replies are held in memory, at most
`WOOFX3_CONNECTORS_GATEWAY_IDEMPOTENCY_CAPACITY` of them (the least recently
used goes first) for `WOOFX3_CONNECTORS_GATEWAY_IDEMPOTENCY_TTL_MS`. A restart
of connectors forgets every key.

### Whole-request refusals

| Code | When |
| --- | --- |
| `invalid` | The request does not parse, its target names a platform that cannot perform the action, or its idempotency key was used for a different request. |
| `rate_limited` | The request waited behind busy requests until its deadline passed; nothing was attempted. |
| `upstream` | The gateway itself failed; the error is logged. |

### Adding egress to an adapter

A platform adapter (one whose id is a platform id) declares its handlers in
its manifest's `egress`, at most one per action:

```ts
egress: {
  "chat.send": {
    parseOptions: (raw) => /* parsed(options) or parseFailed("why") */,
    handle: async (payload, options, ctx) => {
      ctx.markSent();               // just before the call leaves for the platform
      return { status: "delivered", messageId };
    },
  },
}
```

`ctx` carries the abort `signal` and `deadline`, `requestedBy`, and the
request's `workflowChain` for the adapter to attach to the platform's echo of
the line. An adapter that is not a platform declaring egress, an unknown
action, or an action registered twice stops connectors at startup.

### Configuration and health

| Variable | Default | Meaning |
| --- | --- | --- |
| `WOOFX3_CONNECTORS_GATEWAY_ADAPTER_DEADLINE_MS` | `9000` | Reply budget of one request, and so of each platform it reaches. Must be below 12000. |
| `WOOFX3_CONNECTORS_GATEWAY_IDEMPOTENCY_CAPACITY` | `1024` | Replies kept for replay. |
| `WOOFX3_CONNECTORS_GATEWAY_IDEMPOTENCY_TTL_MS` | `600000` | How long a reply is replayed. |

`/health` lists, under `counters.gateway`, the outcomes the gateway produced
per platform, action and status (replays are not counted again), and how many
requests were replayed, coalesced or refused for a reused key. Every request
is logged at info with its action, target kind, idempotency key, requester
and each platform's status. `requestedBy` is logged, not authenticated.

## Shared fixtures

`shared/common/contracts/testdata/platform-gateway/` holds request and reply
cases, each marked valid or with the field it must be refused at. The Go tests
(`shared/common/golang/platformgateway/catalog_test.go`) and the TypeScript
tests (`api/tests/platform-gateway-contract.test.ts`) run the same cases, so
both languages accept and refuse the same input and report the same field
path, such as `payload.message` or `target.ids[1]`. A rule added to the
contract gets a case there.
