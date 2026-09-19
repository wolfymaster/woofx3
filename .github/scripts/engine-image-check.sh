#!/usr/bin/env bash
#
# Runs the production image against an empty database and checks what a
# deployed engine has to do: migrate itself, keep everything but its edge off
# the network, report readiness, and serve both apps on one port.
#
# Used by .github/workflows/engine-image.yml, and runnable by hand on any
# machine with docker, a Postgres it may wipe, and enough disk for the image:
#
#   IMAGE=woofx3:local \
#   DATABASE_URL=postgres://woofx3:woofx3@127.0.0.1:5432/engine_check \
#   .github/scripts/engine-image-check.sh
#
# Every check prints "ok" or "FAIL" with its name, and the first failure ends
# the run with the container's logs.
set -euo pipefail

IMAGE="${IMAGE:?IMAGE is required (the engine image to check)}"
# Where Postgres is reachable from this machine. The container gets the same
# URL with the host rewritten to host.docker.internal.
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required (an empty database the check may write to)}"
PORT="${PORT:-8080}"
EXPECTED_VERSION="${EXPECTED_VERSION:-ci}"
REGISTRATION_TOKEN="${REGISTRATION_TOKEN:-check-registration-token}"
CONTAINER_NAME="${CONTAINER_NAME:-woofx3-image-check}"
# The engine migrates, starts eight services and installs its bundled modules.
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-300}"
# SSE has to outlive a minute: that is what proves nothing on the path
# buffers or reaps an idle stream.
SSE_HOLD_SECONDS="${SSE_HOLD_SECONDS:-70}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="http://127.0.0.1:${PORT}"

failed=0

pass() { printf '  ok    %s\n' "$1"; }

fail() {
  printf '  FAIL  %s\n' "$1" >&2
  if [ -n "${2:-}" ]; then
    printf '        %s\n' "$2" >&2
  fi
  failed=1
}

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "engine-image-check: $1 is required but not installed" >&2
    exit 2
  }
}

cleanup() {
  if [ "$failed" -ne 0 ]; then
    echo "--- container logs (last 200 lines) ---" >&2
    docker logs --tail 200 "$CONTAINER_NAME" >&2 2>&1 || true
  fi
  docker rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

require docker
require curl
require jq
require psql
require bun

# --- start the engine ---------------------------------------------------
# The database host is rewritten because the engine reaches Postgres from
# inside the container, where 127.0.0.1 is the container itself.
CONTAINER_DATABASE_URL="${DATABASE_URL//127.0.0.1/host.docker.internal}"
CONTAINER_DATABASE_URL="${CONTAINER_DATABASE_URL//localhost/host.docker.internal}"

echo "Starting $IMAGE"
docker rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run --detach --name "$CONTAINER_NAME" \
  --add-host host.docker.internal:host-gateway \
  --publish "127.0.0.1:${PORT}:${PORT}" \
  --env "PORT=${PORT}" \
  --env "WOOFX3_DATABASE_URL=${CONTAINER_DATABASE_URL}" \
  --env "WOOFX3_SECRETS_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
  --env "WOOFX3_BARKLOADER_KEY=check-barkloader-key" \
  --env "WOOFX3_SCENE_MANAGER_TOKEN_SECRET=check-scene-manager-secret" \
  --env "WOOFX3_REGISTRATION_TOKEN=${REGISTRATION_TOKEN}" \
  --env "WOOFX3_SCENE_MANAGER_URL=${BASE_URL}" \
  --env "WOOFX3_TWITCH_CLIENT_ID=check-twitch-client-id" \
  --env "WOOFX3_TWITCH_CLIENT_SECRET=check-twitch-client-secret" \
  "$IMAGE" >/dev/null

# --- readiness ----------------------------------------------------------
echo "Waiting for GET /ready (up to ${READY_TIMEOUT_SECONDS}s)"
ready_body=""
deadline=$(( SECONDS + READY_TIMEOUT_SECONDS ))
while [ "$SECONDS" -lt "$deadline" ]; do
  if ! docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q true; then
    fail "the container stays up" "it exited; see the logs below"
    exit 1
  fi
  code="$(curl --silent --output /tmp/ready.json --write-out '%{http_code}' "${BASE_URL}/ready" || true)"
  if [ "$code" = "200" ]; then
    ready_body="$(cat /tmp/ready.json)"
    break
  fi
  sleep 2
done

if [ -z "$ready_body" ]; then
  fail "GET /ready answers 200 within ${READY_TIMEOUT_SECONDS}s" "last body: $(cat /tmp/ready.json 2>/dev/null || echo none)"
  exit 1
fi
pass "GET /ready answers 200 through the edge"

echo "$ready_body" | jq .

check_ready_field() {
  local filter="$1" expected="$2" name="$3" actual
  actual="$(echo "$ready_body" | jq -r "$filter")"
  if [ "$actual" = "$expected" ]; then
    pass "$name"
  else
    fail "$name" "expected $expected, got $actual"
  fi
}

check_ready_field '.ready' 'true' '/ready reports ready'
check_ready_field '.migrations.pending' '0' '/ready reports no pending migrations'
check_ready_field '.services.dbProxy' 'true' '/ready reports db-proxy up'
check_ready_field '.services.barkloader' 'true' '/ready reports barkloader up'
check_ready_field '.version' "$EXPECTED_VERSION" '/ready reports the version it was built with'

applied="$(echo "$ready_body" | jq -r '.migrations.applied')"
latest="$(echo "$ready_body" | jq -r '.migrations.latest')"
if [ "$applied" = "$latest" ] && [ "$applied" != "null" ]; then
  pass "/ready reports the newest migration applied ($applied)"
else
  fail "/ready reports the newest migration applied" "applied=$applied latest=$latest"
fi

# --- migrations actually ran on the database ----------------------------
# /ready is the engine's own account of itself; this reads the database.
migration_count="$(psql "$DATABASE_URL" --tuples-only --no-align --command 'SELECT count(*) FROM public.migrations' 2>/dev/null || echo "")"
if [ -n "$migration_count" ] && [ "$migration_count" -gt 0 ] 2>/dev/null; then
  pass "the database records $migration_count applied migrations"
else
  fail "the database records applied migrations" "no readable public.migrations table"
fi

table_count="$(psql "$DATABASE_URL" --tuples-only --no-align --command \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('applications', 'clients', 'scenes', 'resources')" 2>/dev/null || echo 0)"
if [ "$table_count" = "4" ]; then
  pass "the migrations created the engine's tables"
else
  fail "the migrations created the engine's tables" "found $table_count of 4 expected tables"
fi

# --- only the edge listens beyond loopback ------------------------------
# Read inside the container, from /proc: the runtime image has neither ss nor
# netstat. Listening sockets are state 0A; the local address is hex, so
# loopback is 0100007F (v4) or ...00000001 (v6 ::1).
# The port is printed as hex and converted here: awk on a runner is mawk,
# which has no strtonum.
public_listeners="$(
  docker exec "$CONTAINER_NAME" cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '
    $4 == "0A" {
      split($2, endpoint, ":")
      address = endpoint[1]
      if (address == "0100007F") { next }                         # 127.0.0.1
      if (address == "00000000000000000000000001000000") { next } # ::1
      print endpoint[2]
    }
  ' | while read -r hex_port; do printf '%d\n' "0x$hex_port"; done | sort --unique | tr '\n' ' ' | sed 's/ $//'
)"

if [ "$public_listeners" = "$PORT" ]; then
  pass "only the edge listens beyond loopback (port $PORT)"
else
  fail "only the edge listens beyond loopback" "expected just $PORT, found: ${public_listeners:-none}"
fi

# --- idle memory --------------------------------------------------------
# Reported, not asserted: it feeds the per-engine cost estimate.
idle_rss="$(docker stats --no-stream --format '{{.MemUsage}}' "$CONTAINER_NAME" 2>/dev/null || echo unknown)"
echo "  note  idle memory: $idle_rss"

# --- the edge, capnweb, registration, overlays, SSE and uploads ---------
echo "Checking the edge and the engine API"
if BASE_URL="$BASE_URL" \
   REGISTRATION_TOKEN="$REGISTRATION_TOKEN" \
   EXPECTED_VERSION="$EXPECTED_VERSION" \
   SSE_HOLD_SECONDS="$SSE_HOLD_SECONDS" \
   bun "$SCRIPT_DIR/engine-edge-check.ts"; then
  pass "the edge, registration, overlay, SSE and upload checks"
else
  fail "the edge, registration, overlay, SSE and upload checks" "see the output above"
fi

if [ "$failed" -ne 0 ]; then
  echo "engine-image-check: FAILED" >&2
  exit 1
fi
echo "engine-image-check: every check passed"
