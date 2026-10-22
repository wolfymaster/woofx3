# Platform gateway contract

The platform gateway is the engine's one way to produce an effect on a
streaming platform: post a chat line, announce, pin. A caller names an
**action** and a **target** (one platform, several, every platform, or wherever
the triggering event came from) and gets back what happened on each platform.
Callers never branch on the platform; adding a platform or an action changes
the contract and the adapters, not the callers.

This page describes the wire contract every side shares: the subjects, the
action catalog, the request and reply shapes, how each is validated, and how
per-platform outcomes become a reply's `ok`.

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

## Shared fixtures

`shared/common/contracts/testdata/platform-gateway/` holds request and reply
cases, each marked valid or with the field it must be refused at. The Go tests
(`shared/common/golang/platformgateway/catalog_test.go`) and the TypeScript
tests (`api/tests/platform-gateway-contract.test.ts`) run the same cases, so
both languages accept and refuse the same input and report the same field
path, such as `payload.message` or `target.ids[1]`. A rule added to the
contract gets a case there.
