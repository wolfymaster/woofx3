#!/usr/bin/env bash
#
# Starts an unpacked release archive the way the woofx3 desktop app starts its
# bundled engine and checks that it reports ready. The app hands the
# orchestrator only its data directory, ports and allowed origins, so every
# other setting a service requires has to come from the packaged .woofx3.json
# or from the secrets the orchestrator generates.
#
# The Windows archive ships no Caddy, so the check runs without the edge too.
#
# Used by .github/workflows/release.yml, and runnable by hand on Linux:
#
#   .github/scripts/release-local-start-check.sh path/to/linux-amd64
#
# Prints "ok" when the engine is ready, otherwise "FAIL" with the
# orchestrator's output and the tail of every service log.
set -euo pipefail

RELEASE_DIR="${1:?usage: release-local-start-check.sh <unpacked release directory>}"
# A first start migrates a new database and installs the bundled modules.
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-180}"
# The api port the desktop app passes (DEFAULT_API_PORT in the app).
API_PORT="${API_PORT:-5050}"
# The origins the desktop app's webview and the engine's own pages use.
ALLOWED_ORIGINS="http://localhost:*,http://127.0.0.1:*,tauri://localhost,http://tauri.localhost"

WORK_DIR="$(mktemp -d)"
ORCHESTRATOR_PID=""
cleanup() {
  if [[ -n "$ORCHESTRATOR_PID" ]] && kill -0 "$ORCHESTRATOR_PID" 2>/dev/null; then
    kill -TERM "$ORCHESTRATOR_PID" 2>/dev/null || true
    wait "$ORCHESTRATOR_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

cp -a "$RELEASE_DIR" "$WORK_DIR/release"
rm -f "$WORK_DIR/release/caddy"
DATA_DIR="$WORK_DIR/data"
mkdir -p "$DATA_DIR" "$WORK_DIR/secrets"

(
  cd "$WORK_DIR/release"
  exec env -i \
    HOME="$WORK_DIR" \
    PATH=/usr/bin:/bin \
    WOOFX3_HOSTING=local \
    WOOFX3_DATA_DIR="$DATA_DIR" \
    WOOFX3_REGISTRATION_TOKEN_FILE="$WORK_DIR/secrets/registration-token" \
    WOOFX3_API_PORT="$API_PORT" \
    WOOFX3_ALLOWED_HOSTS="localhost,127.0.0.1,[::1]" \
    WOOFX3_ALLOWED_ORIGINS="$ALLOWED_ORIGINS" \
    WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS="$ALLOWED_ORIGINS,null" \
    WOOFX3_SUPERVISOR_STATUS=stdout-jsonl \
    ./orchestrator
) >"$WORK_DIR/status.jsonl" 2>"$WORK_DIR/orchestrator.stderr" &
ORCHESTRATOR_PID=$!

fail() {
  echo "FAIL: $1"
  echo "--- orchestrator status"
  cat "$WORK_DIR/status.jsonl"
  echo "--- orchestrator stderr"
  tail -n 100 "$WORK_DIR/orchestrator.stderr"
  for log in "$DATA_DIR"/logs/*.log; do
    [[ -e "$log" ]] || continue
    echo "--- $(basename "$log")"
    tail -n 30 "$log"
  done
  exit 1
}

deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
while ((SECONDS < deadline)); do
  if grep -q '"event":"ready"' "$WORK_DIR/status.jsonl"; then
    echo "ok: the release starts as a local engine with no injected settings"
    exit 0
  fi
  if ! kill -0 "$ORCHESTRATOR_PID" 2>/dev/null; then
    fail "the orchestrator exited before the engine was ready"
  fi
  sleep 2
done
fail "the engine was not ready within ${READY_TIMEOUT_SECONDS}s"
