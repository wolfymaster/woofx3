# Contracts

A contract is any shape two components agree on: an HTTP route, an event, an
RPC method, a manifest, a message, an environment variable. Every contract in
the platform follows the same rules, so a change to one is seen by everything
that depends on it and cannot be missed or left to rot.

The rules apply to every contract that crosses a service or a language
boundary, inside the engine as well as at its edges. A message used inside one
service only has to be a valid CloudEvents envelope.

## The rules

1. **One source, never copied.** Each contract has one source of truth, in the
   repository of the component that owns it: route definitions that emit an
   OpenAPI 3.1 document, or that document written directly. A second
   hand-written copy of a shape, an enum, a limit or a signature scheme is a
   defect, whatever the comment above it says.
2. **Everything else is generated from it.** Types, parsers, validators,
   clients and the specification itself come from the source, and are written
   into the consuming package's own tree, not copied there by hand. Generated
   files carry a header naming the command that wrote them and are never
   edited. No shape is written by hand in any language: types, unions, enum
   lists and validators are generated, and the only hand-written code is the
   mapping between a domain object and its generated type, which stops
   compiling when the contract changes.
3. **CI regenerates and compares.** One command regenerates every output of a
   repository, and the same command with `--check` (or a test that does the
   same) fails when any output differs from what is committed. A change to a
   source cannot merge until its outputs follow.
4. **Input is checked at run time against the generated schema.** A producer
   validates what it receives, and a request's schema is closed
   (`additionalProperties: false`), so an unknown field is refused. A consumer
   validates what it is answered with, so a response that does not fit is a
   failure naming the route, not a wrong figure. A reply's schema is open,
   because the producer deploys first and adds fields before its consumers
   know them; it never tolerates a missing or mistyped one. Both sides use the
   same schema that types the call, never a second hand-written one.
5. **A copy of another repository's source is pinned and compared.** A
   consumer that must hold a copy of a contract owned elsewhere records the
   commit and SHA-256 it was taken from, and CI compares the copy with the
   owner's default branch. A difference fails the consumer's build, so a change
   to the contract reaches every consumer instead of waiting to be noticed.
6. **Every contract is documented where its owner's documentation lives.** The
   page says where the source is, what is generated from it, how CI checks it
   and where the run-time check is. It describes how the contract works today.

## The mechanisms

| Kind of contract | Source | Generated | CI check | Run-time check |
| --- | --- | --- | --- | --- |
| HTTP routes (request and response) | route definitions in the owner (Zod with `@hono/zod-openapi`), rendered as an OpenAPI 3.1 document checked in as `openapi/<name>.json` | the document, and TypeScript types for each consumer (`openapi-typescript`), written beside the consumer | a test regenerates the document and the types and fails on a difference | the owner validates requests from the route definitions; a consumer validates answers with Ajv against the document it was typed from |
| Messages on a bus, and webhooks | an OpenAPI 3.1 document; each message is a schema in `components`, referenced from a stand-in operation that carries the subject as an extension | TypeScript types (`openapi-typescript` with `--enum`), Go types, unions and validators (`ogen`), Rust types (`cargo-typify`) | one command regenerates every language and `--check` fails on a difference | TypeScript: Ajv, precompiled for Convex; Go: the validators `ogen` generates; Rust: the `jsonschema` crate |

Three rules about HTTP documents keep the generated types honest:

- A nullable use of a named schema is written as a union with null, never with
  `.nullable()`, which renders as an `allOf` no null satisfies. A test fails on
  the pattern in route schemas, and a consumer's run-time check fails on a
  document that has it.
- A nullable enum lists `null` among its values, or the document refuses the
  very answer it allows. Types cannot show this; the run-time check of a real
  answer against the document does, so a producer's contract test validates
  each real answer against its own published document, as a consumer would.
- A field with a default is optional in the request that omits it, so the
  types are generated with `defaultNonNullable: false`.

Every contract is written in one subset of the document language so one validator
per language enforces all of it: no `if`/`then`/`else`, no `uniqueItems` on arrays of
objects and no `propertyNames`. A rule such as "a refusal carries no results" is a union of
variants discriminated by a constant, not a conditional. A producer omits an optional
field it has no value for instead of sending `null` or an empty value, and the schema does
not treat either as absent. Each limit is written once in the schema, and a caller that
needs the number reads it from the document.

A route must be registered in its repository's document builder as well as in
the application, or its consumers cannot name it. `bun run openapi` in
`woofx3-maintenance` regenerates every document and every consumer's types.

## Where the contracts are

| Contract | Owner | Source | Documented in |
| --- | --- | --- | --- |
| Platform gateway | `woofx3` | `shared/common/contracts/platform-gateway.json`, a JSON contract with its own generator that predates these rules | [Platform gateway contract](/services/platform-gateway) |
| Companion gateway | `woofx3` | `shared/common/contracts/companion-gateway.json`, the same generator | [Companion gateway](/services/companion-gateway) |
| Maintenance API | `woofx3-maintenance` | route definitions, `openapi/maintenance.json` | the repository's `CLAUDE.md` |
| Operators' billing API | `woofx3-maintenance` | route definitions, `openapi/billing.json` | the repository's `CLAUDE.md` |
| Ops API | `woofx3-ui` | `convex/lib/ops/contract.ts`, `openapi/ops.json` | the UI's `docs/patterns/ops-api.md` |
| Marketplace API | `woofx3-marketplace-api` | `openapi/marketplace.yaml`, embedded and checked against every request | the repository's `CLAUDE.md` |

A repository that consumes another's contract vendors its document (`openapi/ops.json`,
`openapi/marketplace.yaml`) with a manifest naming the commit and SHA-256 it came from, generates its types from
the copy, and checks every answer against it at run time with the one shared checker.
