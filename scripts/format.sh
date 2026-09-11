#!/usr/bin/env bash
#
# Formats every hand-written source file in the repository. With --check it
# changes nothing and exits non-zero if any file would be reformatted.
#
# Generated and vendored code is never formatted or checked. A formatter
# rewriting a generator's output is reverted on the next regeneration, so the
# only thing it produces is churn. How each language keeps it out:
#
#   Rust       Generated protobuf code is pulled in with `include!`, which
#              rustfmt does not follow, so it is excluded by construction.
#   Go         Files carrying the standard `// Code generated ... DO NOT EDIT.`
#              marker are skipped.
#   TS / JSON  `files.includes` in biome.json.
#
# The biome version is pinned because its output is only stable within a
# release: a check run on a different version would report a clean tree dirty.

set -euo pipefail

readonly BIOME_VERSION="2.4.10"

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

for tool in cargo gofmt biome; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "format: $tool is not on PATH" >&2
    exit 2
  fi
done

installed="$(biome --version | awk '{print $NF}')"
if [ "$installed" != "$BIOME_VERSION" ]; then
  echo "format: biome $BIOME_VERSION is required, found $installed" >&2
  exit 2
fi

failed=()

# One run per workspace root. Running every Cargo.toml would format each
# workspace once per member.
mapfile -t cargo_roots < <(
  git ls-files '*Cargo.toml' |
    xargs -n1 cargo locate-project --workspace --message-format plain --manifest-path |
    sort -u
)
for manifest in "${cargo_roots[@]}"; do
  if $check; then
    if ! cargo fmt --all --check --message-format short --manifest-path "$manifest"; then
      failed+=("rust")
    fi
  else
    cargo fmt --all --manifest-path "$manifest"
  fi
done

mapfile -d '' go_files < <(
  git ls-files -z '*.go' | xargs -0 grep -LZ '^// Code generated .* DO NOT EDIT\.$'
)
if $check; then
  unformatted="$(gofmt -l "${go_files[@]}")"
  if [ -n "$unformatted" ]; then
    echo "$unformatted"
    failed+=("go")
  fi
else
  gofmt -w "${go_files[@]}"
fi

if $check; then
  if ! biome format .; then
    failed+=("biome")
  fi
else
  biome format --write .
fi

if [ "${#failed[@]}" -gt 0 ]; then
  echo "format: unformatted files found (${failed[*]}); run scripts/format.sh" >&2
  exit 1
fi
