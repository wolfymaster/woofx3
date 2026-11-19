# Contract spike: JSON Schema 2020-12 + AsyncAPI 3

Throwaway prototype. Nothing here is wired into the engine.

- `schemas/`: one JSON Schema file per message (`$ref` for shared pieces). The only hand-written source of truth.
- `asyncapi.yaml`: the subject catalog (channels, operations, request/reply) pointing at those schemas.
- Generated, committed, diffed in CI: `ts/generated/*`, `models_gen.go`, `rust/src/models_gen.rs`.
- Run-time validators over the same files: `ts/validators.ts` (Ajv, or the precompiled `ts/generated/validators.*.cjs`),
  `validate.go` (santhosh-tekuri/jsonschema v6, `go:embed`), `rust/src/lib.rs` (`jsonschema` crate, `include_dir!`).

```bash
bun install            # in this directory
./gen.sh               # regenerate everything
./gen.sh --check       # exit 1 if a generated file differs from the schemas
bun test ts && go test ./... && (cd rust && cargo test)
```

Unknown-field policy: schemas are written strict (`additionalProperties: false`). Producers validate with the schema
as written. Consumers validate replies with `allowExtraFields`, which drops `additionalProperties: false` at load time
(`ts/schemas.ts`, `Lenient` in Go and Rust). Requests are never read leniently.

`ts/fixtures.test.ts`, `fixtures_test.go` and `rust/tests/fixtures.rs` run the existing shared fixtures in
`shared/common/contracts/testdata/platform-gateway` and pin the four cases JSON Schema cannot express.
