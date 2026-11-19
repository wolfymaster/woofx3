# Generator spike

Throwaway. Which generators turn one OpenAPI 3.1 document into types, validators and servers in TS, Go and Rust.

- `in/`: copies of the inputs (marketplace spec, first spike's JSON Schemas, platform-gateway fixtures).
- `tools/`: `build-inputs.sh` makes `work/` (a marketplace slice at 3.1 and 3.0.3, the message set as an OpenAPI doc).
- `gen.sh` / `gen.sh --check`: regenerate / diff `gen/` and `rust/src/models_gen.rs`.
- `fixtures/`, `ts/`, `rust/tests/`, `serverprobe/`: fixture and server probes. `fixtures/RESULTS.txt` is the last fixture run.
- `zod/`: the Zod to OpenAPI 3.0.3 / 3.1 comparison and the Ajv `nullable` probes (`bun zod/contract.ts`, `bun zod/ajv-probe.ts`).

```bash
bun install && ./gen.sh && go test ./... && bun test ts && (cd rust && cargo test)
```
