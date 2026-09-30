#!/usr/bin/env bash
#
# Checks that the previous release still runs where a new one has been: the
# new image migrates an empty database and writes a fresh data volume, is
# stopped as a deploy stops it, and the previous release's image is then
# started on the same database and volume.
#
# That is what a rollback does. When an upgrade fails, the maintenance API
# redeploys the previous image, and no down migration runs: the previous
# release has to work on the schema and the data the new one left behind (see
# "Rollback compatibility" in docs/operations/releases.md).
#
# Used by .github/workflows/upgrade-compat.yml, and runnable by hand on any
# machine with docker, a Postgres it may write to, and room for both images:
#
#   NEW_IMAGE=woofx3:local \
#   OLD_IMAGE=ghcr.io/wolfymaster/woofx3:v0.3.0 OLD_VERSION=v0.3.0 \
#   DATABASE_URL=postgres://woofx3:woofx3@127.0.0.1:5432/upgrade_compat \
#   .github/scripts/upgrade-compat-check.sh
#
# Every check prints "ok" or "FAIL" with its name. A failure that leaves
# nothing further to check ends the run at once, with the engine's logs.
set -euo pipefail

NEW_IMAGE="${NEW_IMAGE:?NEW_IMAGE is required (the image whose migrations are being checked)}"
OLD_IMAGE="${OLD_IMAGE:?OLD_IMAGE is required (the image of the previous release)}"
# The version the previous release reports; it is the tag it was built as.
OLD_VERSION="${OLD_VERSION:?OLD_VERSION is required (the version OLD_IMAGE must report)}"
# Where Postgres is reachable from this machine. The containers get the same
# URL with the host rewritten to host.docker.internal.
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required (an empty database the check may write to)}"
# A checkout of the previous release's tag. When set, that release's own edge
# checks are run against it: the checks on this branch may cover features the
# previous release does not have.
OLD_CHECKOUT="${OLD_CHECKOUT:-}"
PORT="${PORT:-8080}"
REGISTRATION_TOKEN="${REGISTRATION_TOKEN:-check-registration-token}"
CONTAINER_NAME="${CONTAINER_NAME:-woofx3-upgrade-compat}"
VOLUME_NAME="${VOLUME_NAME:-woofx3-upgrade-compat-data}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-300}"
# What a host gives a stopping engine before it kills it. Must match
# RAILWAY_DEPLOYMENT_DRAINING_SECONDS as the maintenance API sets it, and stay
# above stopGracePeriod in build/orchestrator/main.go.
STOP_TIMEOUT_SECONDS="${STOP_TIMEOUT_SECONDS:-30}"

BASE_URL="http://127.0.0.1:${PORT}"
READY_FILE="$(mktemp)"

failed=0
ready_body=""

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
    echo "upgrade-compat-check: $1 is required but not installed" >&2
    exit 2
  }
}

# Every service writes its own file under /app/logs. They are copied out
# rather than read with `docker exec` so a stopped container can be read too.
service_logs() {
  local directory
  directory="$(mktemp -d)"
  if docker cp "${CONTAINER_NAME}:/app/logs/." "$directory" >/dev/null 2>&1; then
    echo "$directory"
  fi
}

cleanup() {
  if [ "$failed" -ne 0 ]; then
    local directory log
    directory="$(service_logs)"
    if [ -n "$directory" ]; then
      echo "--- per-service logs (last 40 lines each) ---" >&2
      for log in "$directory"/*.log; do
        echo "=== $(basename "$log")" >&2
        tail -n 40 "$log" >&2 || true
      done
    fi
    echo "--- container output, without db-proxy request logging ---" >&2
    docker logs --tail 400 "$CONTAINER_NAME" 2>&1 | grep -v '"service":"db"' | tail -n 120 >&2 || true
  fi
  docker rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker volume rm --force "$VOLUME_NAME" >/dev/null 2>&1 || true
  rm -f "$READY_FILE"
}
trap cleanup EXIT

# The database host is rewritten because an engine reaches Postgres from
# inside its container, where 127.0.0.1 is the container itself.
CONTAINER_DATABASE_URL="${DATABASE_URL//127.0.0.1/host.docker.internal}"
CONTAINER_DATABASE_URL="${CONTAINER_DATABASE_URL//localhost/host.docker.internal}"

# Both releases get the same configuration, database and data volume, as the
# two deployments of one engine do.
start_engine() {
  local image="$1"
  docker rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker run --detach --name "$CONTAINER_NAME" \
    --add-host host.docker.internal:host-gateway \
    --publish "127.0.0.1:${PORT}:${PORT}" \
    --volume "${VOLUME_NAME}:/app/data" \
    --env "PORT=${PORT}" \
    --env "WOOFX3_DATABASE_URL=${CONTAINER_DATABASE_URL}" \
    --env "WOOFX3_SECRETS_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
    --env "WOOFX3_BARKLOADER_KEY=check-barkloader-key" \
    --env "WOOFX3_SCENE_MANAGER_TOKEN_SECRET=check-scene-manager-secret" \
    --env "WOOFX3_REGISTRATION_TOKEN=${REGISTRATION_TOKEN}" \
    --env "WOOFX3_SCENE_MANAGER_URL=${BASE_URL}" \
    --env "WOOFX3_TWITCH_CLIENT_ID=check-twitch-client-id" \
    --env "WOOFX3_TWITCH_CLIENT_SECRET=check-twitch-client-secret" \
    "$image" >/dev/null
}

# Sets ready_body to what GET /ready answered, or ends the run: an engine that
# never becomes ready leaves nothing else to check.
wait_ready() {
  local name="$1" deadline code last_body
  ready_body=""
  deadline=$(( SECONDS + READY_TIMEOUT_SECONDS ))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q true; then
      fail "$name stays up" "its container exited; see the logs below"
      exit 1
    fi
    code="$(curl --silent --output "$READY_FILE" --write-out '%{http_code}' "${BASE_URL}/ready" || true)"
    if [ "$code" = "200" ]; then
      ready_body="$(cat "$READY_FILE")"
      pass "$name answers GET /ready with 200"
      return
    fi
    sleep 2
  done
  last_body="$(cat "$READY_FILE" 2>/dev/null || echo none)"
  fail "$name answers GET /ready with 200 within ${READY_TIMEOUT_SECONDS}s" "last body: $last_body"
  exit 1
}

check_ready_field() {
  local filter="$1" expected="$2" name="$3" actual
  actual="$(echo "$ready_body" | jq -r "$filter")"
  if [ "$actual" = "$expected" ]; then
    pass "$name"
  else
    fail "$name" "expected $expected, got $actual"
  fi
}

require docker
require curl
require jq
require psql
if [ -n "$OLD_CHECKOUT" ]; then
  require bun
fi

docker volume rm --force "$VOLUME_NAME" >/dev/null 2>&1 || true
docker volume create "$VOLUME_NAME" >/dev/null

# --- the new release migrates the database and writes the volume ----------
echo "Starting the new release, $NEW_IMAGE"
start_engine "$NEW_IMAGE"
wait_ready "the new release"
check_ready_field '.migrations.pending' '0' 'the new release reports no pending migrations'
new_latest="$(echo "$ready_body" | jq -r '.migrations.latest')"

# --- it stops as a deploy stops it ----------------------------------------
# A host stops the old deployment before it starts the new one, and kills
# whatever outlives the draining window. A service the orchestrator had to
# kill, or a container the host had to, may have lost writes on its way down.
echo "Stopping the new release (SIGTERM, ${STOP_TIMEOUT_SECONDS}s to exit)"
stop_started="$SECONDS"
docker stop --time "$STOP_TIMEOUT_SECONDS" "$CONTAINER_NAME" >/dev/null
stop_seconds=$(( SECONDS - stop_started ))
exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$CONTAINER_NAME")"
if [ "$exit_code" = "137" ]; then
  fail "the new release exits within ${STOP_TIMEOUT_SECONDS}s of SIGTERM" "it was killed after ${stop_seconds}s"
else
  pass "the new release exits within ${STOP_TIMEOUT_SECONDS}s of SIGTERM (${stop_seconds}s, exit code ${exit_code})"
fi

stopped_logs="$(service_logs)"
killed_services="$(grep --recursive --no-filename 'did not exit within the grace period' "$stopped_logs" 2>/dev/null || true)"
if [ -z "$stopped_logs" ]; then
  fail "every service exits on its own" "the container's logs could not be read"
elif [ -n "$killed_services" ]; then
  fail "every service exits on its own" "the orchestrator killed: $(echo "$killed_services" | head -n 8)"
else
  pass "every service exits on its own, without being killed"
fi

# --- the previous release starts on what the new one left ------------------
echo "Starting the previous release, $OLD_IMAGE, on the same database and volume"
start_engine "$OLD_IMAGE"
wait_ready "the previous release"
echo "$ready_body" | jq .
check_ready_field '.ready' 'true' 'the previous release reports ready'
check_ready_field '.version' "$OLD_VERSION" "the previous release reports $OLD_VERSION"
check_ready_field '.migrations.pending' '0' 'the previous release reports no pending migrations'
check_ready_field '.services.dbProxy' 'true' 'the previous release reports db-proxy up'
check_ready_field '.services.barkloader' 'true' 'the previous release reports barkloader up'

# Says how far apart the two schemas are: equal means this run proved nothing
# about migrations, only about the data the new release wrote.
old_latest="$(echo "$ready_body" | jq -r '.migrations.latest')"
applied_count="$(psql "$DATABASE_URL" --tuples-only --no-align --command 'SELECT count(*) FROM public.migrations' 2>/dev/null || echo unknown)"
echo "  note  the database has $applied_count migrations applied, up to $new_latest; the previous release knows them up to $old_latest"

# --- and works there -------------------------------------------------------
if [ -n "$OLD_CHECKOUT" ]; then
  echo "Running the previous release's edge checks against it"
  # The SSE hold proves nothing about a schema, so it is cut short.
  if BASE_URL="$BASE_URL" \
     REGISTRATION_TOKEN="$REGISTRATION_TOKEN" \
     EXPECTED_VERSION="$OLD_VERSION" \
     SSE_HOLD_SECONDS=5 \
     bun "$OLD_CHECKOUT/.github/scripts/engine-edge-check.ts"; then
    pass "the previous release passes its own edge checks"
  else
    fail "the previous release passes its own edge checks" "see the output above"
  fi
else
  echo "  note  OLD_CHECKOUT is not set, so the previous release's edge checks were not run"
fi

if [ "$failed" -ne 0 ]; then
  echo "upgrade-compat-check: FAILED" >&2
  exit 1
fi
echo "upgrade-compat-check: every check passed"
