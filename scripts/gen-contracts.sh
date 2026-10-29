#!/usr/bin/env bash
#
# Regenerates the code for every contract in shared/common/contracts. With
# --check it changes nothing and exits non-zero if any generated file is out
# of date with its contract.
#
#   gen-contracts.sh           rewrite the generated files
#   gen-contracts.sh --check   compare fresh output with the files on disk
#
# This script, not go:generate, drives the generator: the generator is its
# own Go module, and `go run` cannot build a package outside the module it is
# invoked from, so a //go:generate line in a consuming package could not run it.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

check=false
case "${1:-}" in
  "") ;;
  --check) check=true ;;
  *)
    echo "usage: $0 [--check]" >&2
    exit 2
    ;;
esac

readonly GENERATOR=shared/common/contracts/gen

# One line per contract: its name, the contract file, then its outputs in the
# order the generator takes them.
readonly CONTRACTS=(
  "platform-gateway shared/common/contracts/platform-gateway.json shared/common/golang/platformgateway/catalog_gen.go shared/clients/typescript/api/platform-gateway.gen.ts"
  "companion-gateway shared/common/contracts/companion-gateway.json shared/common/typescript/cloudevents/Companion/module-request.gen.ts barkloader/lib_sandbox/src/contracts/companion_gateway.gen.rs"
)

out_dir="$(mktemp -d)"
trap 'rm -rf "$out_dir"' EXIT

(cd "$GENERATOR" && go build -o "$out_dir/gen" .)

stale=0
misformatted=0
for entry in "${CONTRACTS[@]}"; do
  read -r name contract outputs <<<"$entry"
  read -r -a outputs <<<"$outputs"
  targets=()
  for output in "${outputs[@]}"; do
    if $check; then
      targets+=("$out_dir/$name.$(basename "$output")")
    else
      targets+=("$output")
    fi
  done
  "$out_dir/gen" "$name" "$contract" "${targets[@]}"
  # The generator lays Rust out as rustfmt does, and format.sh skips
  # generated Rust (it is pulled in with include!), so this is what keeps the
  # output rustfmt-clean.
  for target in "${targets[@]}"; do
    if [[ "$target" == *.rs ]] && ! rustfmt --edition 2024 --check "$target"; then
      echo "gen-contracts: the generator wrote $target in a layout rustfmt would change; fix its Rust emitter" >&2
      misformatted=1
    fi
  done
  if $check; then
    for i in "${!outputs[@]}"; do
      if ! diff -u "${outputs[$i]}" "${targets[$i]}"; then
        echo "gen-contracts: ${outputs[$i]} is out of date with $contract" >&2
        stale=1
      fi
    done
  fi
done

if [ "$misformatted" -ne 0 ]; then
  exit 1
fi
if [ "$stale" -ne 0 ]; then
  echo "gen-contracts: run scripts/gen-contracts.sh and commit the result" >&2
  exit 1
fi
