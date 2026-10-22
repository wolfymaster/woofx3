#!/usr/bin/env bash
#
# Container entrypoint: hand over to the orchestrator, which migrates the
# database (the run-once `migrate` step in services.json) and then starts
# every service. A failed migration exits the orchestrator, and with it the
# container, non-zero.
#
# The image runs as UID 65532. It starts as root only where the host forces
# it (Railway, with RAILWAY_RUN_UID=0) because the host mounts the data volume
# owned by root; the data directory is then handed to 65532 and privileges are
# dropped before anything else runs, so no service ever runs as root.
set -euo pipefail

readonly APP_UID=65532
readonly DATA_DIR=/app/data

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R "$APP_UID:$APP_UID" "$DATA_DIR"
  # HOME must match what the unprivileged image user gets; /root is unreadable
  # once privileges are dropped.
  export HOME=/nonexistent
  exec setpriv --reuid="$APP_UID" --regid="$APP_UID" --clear-groups "$0" "$@"
fi

exec /app/orchestrator
