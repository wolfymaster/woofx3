#!/usr/bin/env bash
#
# Regenerates every file derived from schemas/. With --check it writes nothing
# into the tree and exits non-zero if any generated file differs from what the
# schemas produce.
#
#   gen.sh           rewrite the generated files
#   gen.sh --check   diff fresh output against the committed files
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

check=false
case "${1:-}" in
  "") ;;
  --check) check=true ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

readonly GENERATED=(
  ts/generated/contracts.ts
  ts/generated/validators.strict.cjs
  ts/generated/validators.lenient.cjs
  models_gen.go
  rust/src/models_gen.rs
)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/out/ts/generated" "$work/out/rust/src"

# One bundle for tools that cannot follow $ref between files (typify).
bun tools/lint-asyncapi.mjs
bun tools/bundle.ts "$work/bundle.schema.json"
bun tools/gen-ts.mjs "$work/out/ts/generated/contracts.ts"
bun tools/gen-ajv-standalone.ts "$work/out/ts/generated"
# Every schema, in sorted order so the output does not depend on the file system.
go tool go-jsonschema -p contracts -t --tags json -o "$work/out/models_gen.go" $(find schemas -name '*.json' | LC_ALL=C sort)
gofmt -l "$work/out/models_gen.go" | grep . && { echo "gen: models_gen.go is not gofmt-clean" >&2; exit 1; } || true
(cd rust-gen && cargo run --quiet --locked -- "$work/bundle.schema.json" "$work/out/rust/src/models_gen.rs")
rustfmt --edition 2024 "$work/out/rust/src/models_gen.rs"

stale=0
for f in "${GENERATED[@]}"; do
  if $check; then
    diff -u "$f" "$work/out/$f" >&2 || { echo "gen: $f is out of date with schemas/" >&2; stale=1; }
  else
    cp "$work/out/$f" "$f"
  fi
done
if [ "$stale" -ne 0 ]; then
  echo "gen: run spike/contracts/gen.sh and commit the result" >&2
  exit 1
fi
