#!/usr/bin/env bash
#
# Regenerates every file derived from in/ (the marketplace spec and the contract schemas).
#
#   gen.sh           rewrite the generated files
#   gen.sh --check   write nothing into the tree; exit 1 if a generated file differs
#
# Pinned tools: oapi-codegen and ogen via `tool` lines in go.mod; openapi-typescript, ajv and yaml via bun.lock;
# cargo-typify 0.10.1 installed under .tools/ by this script.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

check=false
case "${1:-}" in
  "") ;;
  --check) check=true ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

readonly TYPIFY_VERSION=0.10.1
[ -x .tools/bin/cargo-typify ] || cargo install --locked cargo-typify --version "$TYPIFY_VERSION" --root .tools >&2
export PATH="$PWD/.tools/bin:$PATH"

tools/build-inputs.sh   # in/ -> work/ (slice, 3.0 variants, message document)

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
mkdir -p "$out/gen/ts" "$out/rust/src"

for doc in slice.31 nats.31; do
  # Go: oapi-codegen (models + strict server) and ogen (types, validators, server, own JSON codec).
  mkdir -p "$out/gen/oapi/$doc"
  go tool oapi-codegen -config cfg/oapi.yaml -o "$out/gen/oapi/$doc/gen.go" "work/$doc.yaml"
  src="work/$doc.yaml"; [ "$doc" = nats.31 ] && src="work/nats.31.ogen.yaml"
  go tool ogen --target "$out/gen/ogen/$doc" --package gen --clean "$src" 2>/dev/null
  # TypeScript: types with runtime enums.
  bunx openapi-typescript "work/$doc.yaml" --root-types --enum --default-non-nullable false -o "$out/gen/ts/$doc.ts" >/dev/null
done
bun tools/gen-ajv-standalone.ts work/nats.31.json "$out/gen/ts"
gofmt -l "$out/gen" | grep . && { echo "gen: generated Go is not gofmt-clean" >&2; exit 1; } || true

# Rust: typify reads JSON Schema definitions, so the document's components are lifted out first.
jq -f tools/typify-prep.jq work/nats.31.json | sed 's|#/components/schemas/|#/definitions/|g' > "$out/nats.31.defs.json"
cargo typify "$out/nats.31.defs.json" -B --output "$out/rust/src/models_gen.rs" >/dev/null 2>&1

stale=0
while IFS= read -r f; do
  rel="${f#"$out"/}"
  if $check; then
    diff -u "$rel" "$f" >&2 || { echo "gen: $rel is out of date" >&2; stale=1; }
  else
    mkdir -p "$(dirname "$rel")"; cp "$f" "$rel"
  fi
done < <(find "$out/gen" "$out/rust" -type f | LC_ALL=C sort)
if $check; then
  # A file generated earlier that nothing produces any more is stale too.
  for d in gen/oapi/slice.31 gen/oapi/nats.31 gen/ogen/slice.31 gen/ogen/nats.31; do
    diff -rq "$d" "$out/$d" >&2 || stale=1
  done
fi
[ "$stale" -eq 0 ] || { echo "gen: run spike/generators/gen.sh and commit the result" >&2; exit 1; }
