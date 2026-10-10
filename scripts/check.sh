#!/usr/bin/env bash
#
# Runs the CI checks for the packages a change touches, one package at a time,
# and prints one line per package. A failure also prints the tail of its log.
#
#   check.sh                 packages changed against master (committed, staged,
#                            unstaged and untracked)
#   check.sh <path>...       packages owning these paths
#   check.sh --all           every package CI checks
#   check.sh --quick ...     build and type-check only; skip tests and clippy
#
# Each package runs the same commands as its CI job (.github/workflows/
# {go,rust,api,service,format}-checks.yml), so a pass here should mean a pass
# there. Packages run one after another rather than in parallel: a cold Rust
# build alone can use most of the machine's memory.
#
# Shared code fans out to every package of its language that could import it,
# rather than to its exact dependents. That over-checks slightly, but a missed
# dependent is a green check that CI turns red.
#
# Logs go to logs/check/<package>.log. Exit status is non-zero if any package
# failed.

set -uo pipefail

cd "$(git rev-parse --show-toplevel)"

# Must match the matrices in go-checks.yml and rust-checks.yml.
readonly GO_MODULES=(
  db workflow services/nats build/orchestrator
  shared/clients/golang/barkloader shared/clients/golang/db shared/clients/golang/nats
  shared/clients/golang/servicediscovery shared/common/golang/cloudevents
  shared/common/golang/logging shared/common/golang/runtime
)
readonly RUST_ROOTS=(barkloader shared/common/rust/logging shared/common/rust/runtime)
readonly TS_SERVICES=(api twitch woofwoofwoof sceneManager)
# Installed before any TS check: services resolve these by relative path.
readonly TS_SHARED_DIRS=(
  shared/common/typescript
  shared/clients/typescript/api shared/clients/typescript/db shared/clients/typescript/nats
  shared/clients/typescript/twitch shared/clients/typescript/module-sdk
)

quick=false
all=false
paths=()
for arg in "$@"; do
  case "$arg" in
    --quick) quick=true ;;
    --all) all=true ;;
    -h | --help)
      sed -n '4,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "check: unknown option $arg" >&2
      exit 2
      ;;
    *) paths+=("$arg") ;;
  esac
done

declare -A selected=()
select_target() {
  selected["$1"]=1
}

select_all() {
  local module root service
  for module in "${GO_MODULES[@]}"; do select_target "go:$module"; done
  for root in "${RUST_ROOTS[@]}"; do select_target "rust:$root"; done
  select_target "ts:shared/common/typescript"
  for service in "${TS_SERVICES[@]}"; do select_target "ts:$service"; done
}

# Maps one repository path to the check targets that cover it.
select_for_path() {
  local path="$1" module root service
  case "$path" in
    shared/common/golang/* | shared/clients/golang/*)
      for module in "${GO_MODULES[@]}"; do select_target "go:$module"; done
      return
      ;;
    shared/common/rust/logging/*) select_target "rust:shared/common/rust/logging" ;;
    shared/common/rust/runtime/*) select_target "rust:shared/common/rust/runtime" ;;
  esac
  case "$path" in
    shared/common/rust/* | shared/clients/rust/*)
      select_target "rust:barkloader"
      return
      ;;
    shared/common/typescript/* | shared/clients/typescript/*)
      if [[ "$path" == shared/common/typescript/* ]]; then
        select_target "ts:shared/common/typescript"
      fi
      for service in "${TS_SERVICES[@]}"; do select_target "ts:$service"; done
      return
      ;;
  esac
  for module in "${GO_MODULES[@]}"; do
    if [[ "$path" == "$module"/* ]]; then
      select_target "go:$module"
      return
    fi
  done
  for root in "${RUST_ROOTS[@]}"; do
    if [[ "$path" == "$root"/* ]]; then
      select_target "rust:$root"
      return
    fi
  done
  for service in "${TS_SERVICES[@]}"; do
    if [[ "$path" == "$service"/* ]]; then
      select_target "ts:$service"
      return
    fi
  done
}

changed_paths() {
  local base
  base="$(git merge-base HEAD master 2>/dev/null || echo HEAD)"
  {
    git diff --name-only "$base"
    git ls-files --others --exclude-standard
  } | sort -u
}

if $all; then
  select_all
else
  if [ ${#paths[@]} -eq 0 ]; then
    mapfile -t paths < <(changed_paths)
    if [ ${#paths[@]} -eq 0 ]; then
      echo "check: nothing changed against master; pass paths or --all"
      exit 0
    fi
  fi
  for path in "${paths[@]}"; do
    path="${path%/}"
    # A bare package directory (e.g. `check.sh barkloader`) selects its package.
    select_for_path "$path/"
  done
fi

readonly LOG_DIR="logs/check"
mkdir -p "$LOG_DIR"
failures=0

ts_deps_ready=false
ensure_ts_deps() {
  if $ts_deps_ready; then
    return 0
  fi
  local dir
  for dir in "${TS_SHARED_DIRS[@]}" "${TS_SERVICES[@]}"; do
    if [ ! -d "$dir/node_modules" ] || [ "$dir/bun.lockb" -nt "$dir/node_modules" ] ||
      [ "$dir/bun.lock" -nt "$dir/node_modules" ]; then
      (cd "$dir" && bun install --frozen-lockfile) || return 1
    fi
  done
  (cd shared/clients/typescript/module-sdk && bun run build) || return 1
  ts_deps_ready=true
}

# Runs the steps for one target, all output to its log.
run_steps() {
  local kind="$1" dir="$2"
  case "$kind" in
    go)
      (cd "$dir" && go build ./...) || return 1
      $quick || (cd "$dir" && go test ./...) || return 1
      ;;
    rust)
      (cd "$dir" && cargo build --workspace --locked --all-targets) || return 1
      if ! $quick; then
        (cd "$dir" && cargo clippy --workspace --locked --all-targets -- -D warnings) || return 1
        (cd "$dir" && cargo test --workspace --locked) || return 1
      fi
      ;;
    ts)
      ensure_ts_deps || return 1
      (cd "$dir" && bun run typecheck) || return 1
      if ! $quick; then
        if [ "$dir" = "shared/common/typescript" ]; then
          (cd "$dir" && bun test runtime/ logging/) || return 1
        else
          (cd "$dir" && bun test) || return 1
        fi
      fi
      ;;
  esac
}

run_target() {
  local target="$1" kind="${1%%:*}" dir="${1#*:}"
  local log="$LOG_DIR/${dir//\//_}.log"
  local started=$SECONDS
  if run_steps "$kind" "$dir" >"$log" 2>&1; then
    printf 'PASS  %-40s %4ss\n' "$target" "$((SECONDS - started))"
  else
    printf 'FAIL  %-40s %4ss  log: %s\n' "$target" "$((SECONDS - started))" "$log"
    tail -n 40 "$log" | sed 's/^/      /'
    failures=$((failures + 1))
  fi
}

# Go first, then TS, then Rust: cheapest feedback first.
for kind in go ts rust; do
  for target in $(printf '%s\n' "${!selected[@]}" | grep "^$kind:" | sort); do
    run_target "$target"
  done
done

# Formatting is checked repository-wide, as in format-checks.yml. It is fast,
# and a partial check would miss files a formatter rewrites elsewhere.
started=$SECONDS
if ./scripts/format.sh --check >"$LOG_DIR/format.log" 2>&1; then
  printf 'PASS  %-40s %4ss\n' "format" "$((SECONDS - started))"
else
  printf 'FAIL  %-40s %4ss  log: %s  (fix: make format)\n' "format" "$((SECONDS - started))" "$LOG_DIR/format.log"
  tail -n 20 "$LOG_DIR/format.log" | sed 's/^/      /'
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
