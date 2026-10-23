# Companion gateway module requests

The companion gateway is the part of the connectors host that reaches devices
on the streamer's own network. Module code reaches them through one narrow
capability: it asks the gateway to write a frame to one of its own declared
`local[]` endpoints, and optionally to wait for the device's answer. The
module never supplies an address or its own module id; the host chooses the
address, holds the socket and scopes the request.

This page describes the wire contract between the two sides: barkloader,
which sends a request on behalf of the module code it runs, and connectors,
which answers it. How connectors serves a request (the checks, the address
rules and the sessions it holds) is described in
[Companion gateway → Module requests](./companion-gateway.md#module-requests).
Barkloader sends it from the `ctx.local` host extension
(`barkloader/lib_sandbox/src/extensions/local.rs`; see
[Module format → Talking to a local endpoint](../barkloader/modules.md#talking-to-a-local-endpoint-ctx-local)).

## One contract, generated

The contract is one file, `shared/common/contracts/companion-gateway.json`.
The request crosses from Rust (barkloader) to TypeScript (connectors), so code
for both is generated from it by the same generator as the
[platform gateway contract](/services/platform-gateway):

| Language | Generated file | Imported as |
| --- | --- | --- |
| TypeScript | `shared/common/typescript/cloudevents/Companion/module-request.gen.ts` | `@woofx3/common/cloudevents/Companion/module-request` |
| Rust | `barkloader/lib_sandbox/src/contracts/companion_gateway.gen.rs` | `lib_sandbox::contracts::companion_gateway` |

The Rust file is pulled into its module with `include!`, like the generated
protobuf code, so the repository's format check skips it. The generator
writes it in rustfmt's layout already, and `scripts/gen-contracts.sh` fails if
rustfmt would change it.

The file declares, and the generator refuses anything else:

- `subjects`: each subject with the message it carries as its request and as
  its reply. Every message is carried exactly once.
- `formats`: named string patterns, limited to one ASCII character class and
  a length range (`^[a-z0-9_-]{1,40}$`), so Rust checks them without a
  regular-expression engine.
- `enums`: named lists of string values.
- `objects`: nested objects a field can hold. They do not nest further.
- `messages`: unions picked by a discriminant field, each variant with its own
  fields.

Every field is bounded: a string by `maxLength` (characters), `maxBytes`
(UTF-8) or a `format`; an integer by `min` and `max`; a `stringOrInteger` by
all three. A format, enum or object nothing uses is refused, as is an unknown
key anywhere.

After editing the contract:

```bash
scripts/gen-contracts.sh           # rewrite the generated files
scripts/gen-contracts.sh --check   # fail if any generated file is stale
scripts/check.sh contracts         # the same check, as check.sh runs it
```

## The subject

| Subject | Request | Reply |
| --- | --- | --- |
| `engine.companion.module.request` | `ModuleEndpointRequest` | `ModuleEndpointReply` |

The request and the reply are both bare JSON. The reply has no CloudEvent
envelope, which is how barkloader already reads raw replies from other host
subjects. The subject sits under the reserved `engine.` prefix, so workflows
and uploaded modules cannot publish it.

## Requests

A request is picked by its `op`:

```json
{ "op": "send", "moduleId": "vtube_studio", "endpointId": "vts", "message": "...", "budgetMs": 4500 }
```

```json
{
  "op": "request",
  "moduleId": "vtube_studio",
  "endpointId": "vts",
  "message": "{\"requestID\":\"r1\", ...}",
  "budgetMs": 4500,
  "match": { "field": "requestID", "value": "r1" }
}
```

- `send` writes one text frame to the endpoint.
- `request` writes one frame and answers with the first JSON object the device
  sends back whose top-level `match.field` equals `match.value`.

| Field | Rule |
| --- | --- |
| `moduleId` | `^[A-Za-z0-9._-]{1,100}$`. Barkloader stamps it from the invocation; it is never taken from the module's arguments. |
| `endpointId` | `^[a-z0-9_-]{1,40}$`, a `local[]` id. |
| `message` | A non-empty string of at most 65,536 bytes of UTF-8. |
| `budgetMs` | An integer from 100 to 4,500: what is left of the caller's own deadline. It travels with every op so connectors never writes after barkloader has given up. |
| `match.field` | `^[A-Za-z0-9_]{1,40}$`. Only on `request`. |
| `match.value` | A non-empty string of at most 200 characters, or an integer within JavaScript's safe range. |

One difference between the languages: `JSON.parse` reads `1000.0` as the
integer 1000, so the TypeScript parser accepts an integral float where
barkloader's Rust refuses it. barkloader writes plain integers, and both
sides have a test pinning their behaviour.

The id patterns are the ones the relay configuration accepts
(`shared/common/typescript/cloudevents/Relay/relay.ts`), so any endpoint a
request names can be routed through the companion bridge. The relay also
refuses the module ids `.` and `..`, which no installed module has.

Unknown keys are refused at every level, including a `match` on a `send`.

## Replies

A reply is picked by its `status`:

```json
{ "status": "ok", "reply": "{\"requestID\":\"r1\", ...}", "sessionEpoch": "3f2a..." }
```

```json
{ "status": "failed", "code": "adapter_owned", "message": "...", "sessionEpoch": "3f2a..." }
```

- `ok` carries `reply`, the matched frame's raw text, on a `request`, and
  nothing on a `send`. It always carries `sessionEpoch`.
- `failed` carries a `code` and a human-readable `message`, and
  `sessionEpoch` when a session was open.

`sessionEpoch` changes every time the gateway opens a new session to the
endpoint, for example after an idle close or a route change. A device that
authenticates once per connection needs the module to authenticate again
when it changes.

| Code | Meaning |
| --- | --- |
| `not_declared` | The module declares no such `local[]` endpoint. |
| `adapter_owned` | A host adapter claims the endpoint (OBS, for example); module code cannot reach it. |
| `protocol_unsupported` | The endpoint is not a websocket. |
| `not_routed` | No route the engine's hosting allows reaches it. |
| `address_refused` | The stored address is outside what module requests may dial. |
| `store_unreadable` | The engine's settings could not be read. |
| `unavailable` | The session could not be opened in time. |
| `timeout` | No matching frame arrived before the budget ran out. |
| `busy` | A limit was reached, or the same match is already pending on the session. |
| `invalid` | The request broke the contract. |

## Validation

Both languages accept and refuse the same messages, pinned by the shared
fixtures in `shared/common/contracts/testdata/companion-gateway/`:

- TypeScript: `parseModuleEndpointRequest` and `parseModuleEndpointReply`
  return `{ ok: true, value }` or `{ ok: false, error: { field, problem } }`,
  with `field` a dotted path such as `match.field`. JSON `null` counts as
  absent; an empty optional string is left out.
- Rust: `ModuleEndpointRequest::decode` and `ModuleEndpointReply::decode`
  decode with serde, refusing wrong types and unknown keys, then call
  `validate()`, which returns a `ValidationError` naming the field.

String lengths count characters (Unicode code points) except `message` and
`reply`, which count UTF-8 bytes because they go onto a socket as they are.
