#!/usr/bin/env bash
#
# Creates, lists and removes paired worktrees of woofx3 and woofx3-ui.
#
#   worktree.sh new <branch> [--base <ref>] [--engine-only | --ui-only]
#   worktree.sh ls
#   worktree.sh rm <branch> [--force]
#   worktree.sh config [--slot <n>]
#
# A task gets one directory holding a worktree of each repository side by side:
#
#   $WOOFX3_WORKTREES/<branch>/woofx3
#   $WOOFX3_WORKTREES/<branch>/woofx3-ui
#
# The pairing is not cosmetic. woofx3-ui addresses the engine's shared
# TypeScript clients by the static relative path ../woofx3, so a UI worktree
# only type-checks when an engine checkout sits next to it, and a change to the
# shared API types can only be checked against the UI when that checkout is
# the same branch. With --ui-only, ../woofx3 is a symlink to the main engine
# clone instead.
#
# Every task also gets a slot number, and with it a block of ports and its own
# .woofx3.json, so engines started from different worktrees do not collide.
# Slot 0 is the main clone and keeps the default ports; `config` writes its
# .woofx3.json.
#
# Ports for slot N (N > 0) are 20000 + 100*N plus:
#   +0 api   +1 db proxy   +2 barkloader   +3 NATS   +4 NATS WebSocket
#   +5 sceneManager   +10 UI dev server
#
# Branches are never deleted: `rm` removes the worktrees and keeps the work.

set -euo pipefail

readonly CODE_ROOT="${WOOFX3_CODE_ROOT:-$HOME/code}"
readonly ENGINE_REPO="$CODE_ROOT/woofx3"
readonly UI_REPO="$CODE_ROOT/woofx3-ui"
readonly WORKTREES="${WOOFX3_WORKTREES:-$CODE_ROOT/wt}"

# Engine packages with their own node_modules. Each resolves its siblings by
# relative path, so all of them must be installed before any one type-checks.
# Must match the install lists in .github/workflows/{api,service}-checks.yml.
readonly ENGINE_BUN_DIRS=(
  shared/common/typescript
  shared/clients/typescript/api
  shared/clients/typescript/db
  shared/clients/typescript/nats
  shared/clients/typescript/twitch
  shared/clients/typescript/module-sdk
  api
  twitch
  woofwoofwoof
  sceneManager
)

usage() {
  sed -n '4,8p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

fail() {
  echo "worktree: $*" >&2
  exit 1
}

task_dir() {
  echo "$WORKTREES/${1//\//-}"
}

ports_for_slot() {
  local slot="$1"
  if [ "$slot" -eq 0 ]; then
    API_PORT=5050 DB_PORT=5555 BARKLOADER_PORT=9653 NATS_PORT=4222 NATS_WS_PORT=4225 SCENE_PORT=9101 UI_PORT=5173
    return
  fi
  local base=$((20000 + 100 * slot))
  API_PORT=$base
  DB_PORT=$((base + 1))
  BARKLOADER_PORT=$((base + 2))
  NATS_PORT=$((base + 3))
  NATS_WS_PORT=$((base + 4))
  SCENE_PORT=$((base + 5))
  UI_PORT=$((base + 10))
}

random_hex() {
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# Writes .woofx3.json for an engine checkout. Never overwrites one: it may hold
# credentials someone added by hand.
write_engine_config() {
  local engine_dir="$1" slot="$2"
  local config="$engine_dir/.woofx3.json"
  if [ -e "$config" ]; then
    echo "  kept existing $config"
    return
  fi
  ports_for_slot "$slot"
  cat >"$config" <<EOF
{
  "apiPort": "$API_PORT",
  "barkloaderPort": "$BARKLOADER_PORT",
  "barkloaderWsUrl": "ws://127.0.0.1:$BARKLOADER_PORT/ws",
  "barkloaderUrl": "http://127.0.0.1:$BARKLOADER_PORT",
  "barkloaderKey": "$(random_hex)",
  "storagePath": "./data/module-storage.db",
  "databaseProxyUrl": "http://127.0.0.1:$DB_PORT",
  "databaseProxyPort": "$DB_PORT",
  "databaseUrl": "sqlite://./data/woofx3.db",
  "secretsKey": "$(head -c 32 /dev/urandom | base64)",
  "logLevel": "info",
  "rootPath": ".",
  "messagebusHost": "127.0.0.1",
  "messagebusServerListeningPort": $NATS_PORT,
  "messagebusWebSocketPort": $NATS_WS_PORT,
  "messagebusUrl": "ws://127.0.0.1:$NATS_WS_PORT",
  "messagebusJwt": "",
  "messagebusNKey": "",
  "sceneManagerHost": "127.0.0.1",
  "woofx3SceneManagerPort": "$SCENE_PORT",
  "sceneManagerUrl": "http://127.0.0.1:$SCENE_PORT",
  "sceneManagerTokenSecret": "$(random_hex)",
  "twitchChannelName": "",
  "twitchClientId": "",
  "twitchClientSecret": ""
}
EOF
  echo "  wrote $config"
}

write_ports_file() {
  local dir="$1" slot="$2"
  ports_for_slot "$slot"
  cat >"$dir/ports.env" <<EOF
# Ports for slot $slot. Source this file to use them in a shell.
WOOFX3_SLOT=$slot
WOOFX3_API_PORT=$API_PORT
WOOFX3_DATABASE_PROXY_PORT=$DB_PORT
WOOFX3_BARKLOADER_PORT=$BARKLOADER_PORT
WOOFX3_MESSAGEBUS_PORT=$NATS_PORT
WOOFX3_MESSAGEBUS_WEBSOCKET_PORT=$NATS_WS_PORT
WOOFX3_SCENE_MANAGER_PORT=$SCENE_PORT
WOOFX3_UI_PORT=$UI_PORT
EOF
}

install_engine_deps() {
  local engine_dir="$1"
  local dir
  for dir in "${ENGINE_BUN_DIRS[@]}"; do
    (cd "$engine_dir/$dir" && bun install --frozen-lockfile --silent) || fail "bun install failed in $engine_dir/$dir"
  done
  # sceneManager imports @woofx3/module-sdk by its built output.
  (cd "$engine_dir/shared/clients/typescript/module-sdk" && bun run --silent build >/dev/null) ||
    fail "module-sdk build failed in $engine_dir"
  echo "  installed engine packages"
}

# The db proxy refuses to start against a database without its tables.
migrate_engine_db() {
  local engine_dir="$1"
  mkdir -p "$engine_dir/db/data"
  local log="$engine_dir/logs/migrate.log"
  mkdir -p "$engine_dir/logs"
  # Migrating a fresh SQLite database intermittently fails partway with "disk
  # I/O error (5898)" (SQLITE_IOERR_DELETE_NOENT). Running it again on the same
  # file resumes from the last recorded migration and gets through within a
  # couple of attempts. The cause is in the engine, not this script.
  local attempt
  for attempt in 1 2 3 4 5; do
    if (cd "$engine_dir/db" && go run ./database/migrate -cmd up) >"$log" 2>&1; then
      echo "  migrated $engine_dir/db/data/woofx3.db"
      if [ "$attempt" -gt 1 ]; then
        echo "  (needed $attempt attempts: fresh SQLite migration is flaky)"
      fi
      return
    fi
  done
  fail "migrations failed 5 times in $engine_dir; see $log"
}

install_ui_deps() {
  local ui_dir="$1"
  # postinstall runs scripts/ensure-engine-path.mjs, which verifies ../woofx3.
  (cd "$ui_dir" && bun install --frozen-lockfile --silent) || fail "bun install failed in $ui_dir"
  echo "  installed UI packages"
}

# Lowest slot no task holds. Called with the lock held.
next_free_slot() {
  local slot=1
  while grep -qx "$slot" "$WORKTREES"/*/.slot 2>/dev/null; do
    slot=$((slot + 1))
  done
  echo "$slot"
}

# Checks out <branch> into <path>: the existing local branch, else a local
# branch tracking origin/<branch>, else a new branch from <base>.
add_worktree() {
  local repo="$1" path="$2" branch="$3" base="$4"
  if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$repo" worktree add --quiet "$path" "$branch"
  elif git -C "$repo" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    git -C "$repo" worktree add --quiet --track -b "$branch" "$path" "origin/$branch"
  else
    git -C "$repo" worktree add --quiet -b "$branch" "$path" "$base"
  fi
  echo "  $(basename "$repo"): $path ($branch)"
}

cmd_new() {
  local branch="" base="master" with_engine=true with_ui=true
  while [ $# -gt 0 ]; do
    case "$1" in
      --base)
        base="${2:?--base needs a ref}"
        shift 2
        ;;
      --engine-only)
        with_ui=false
        shift
        ;;
      --ui-only)
        with_engine=false
        shift
        ;;
      -*) usage ;;
      *)
        [ -z "$branch" ] || usage
        branch="$1"
        shift
        ;;
    esac
  done
  [ -n "$branch" ] || usage
  $with_engine || $with_ui || usage

  local dir
  dir="$(task_dir "$branch")"
  [ ! -e "$dir" ] || fail "$dir already exists"
  mkdir -p "$WORKTREES"

  local slot
  slot="$(
    exec 9>"$WORKTREES/.lock"
    flock 9
    slot="$(next_free_slot)"
    mkdir "$dir"
    echo "$slot" >"$dir/.slot"
    echo "$slot"
  )"

  echo "task $branch (slot $slot) in $dir"
  if $with_engine; then
    add_worktree "$ENGINE_REPO" "$dir/woofx3" "$branch" "$base"
    write_engine_config "$dir/woofx3" "$slot"
    install_engine_deps "$dir/woofx3"
    migrate_engine_db "$dir/woofx3"
  else
    ln -s "$ENGINE_REPO" "$dir/woofx3"
    echo "  woofx3: symlink to $ENGINE_REPO"
    [ -d "$ENGINE_REPO/shared/clients/typescript/api/node_modules" ] || install_engine_deps "$ENGINE_REPO"
  fi
  if $with_ui; then
    add_worktree "$UI_REPO" "$dir/woofx3-ui" "$branch" "$base"
    install_ui_deps "$dir/woofx3-ui"
  fi
  write_ports_file "$dir" "$slot"

  echo
  sed -n '3,$p' "$dir/ports.env"
  echo
  if $with_engine; then
    echo "engine check:  (cd $dir/woofx3 && scripts/check.sh)"
  fi
  if $with_ui; then
    echo "UI check:      (cd $dir/woofx3-ui && scripts/check.sh)"
    echo "UI dev server: (cd $dir/woofx3-ui && bun run dev -- --port $UI_PORT --strictPort)"
  fi
}

cmd_ls() {
  local dir name slot repo state
  shopt -s nullglob
  for dir in "$WORKTREES"/*/; do
    dir="${dir%/}"
    name="$(basename "$dir")"
    slot="$(cat "$dir/.slot" 2>/dev/null || echo "?")"
    printf '%-40s slot %-3s' "$name" "$slot"
    for repo in woofx3 woofx3-ui; do
      if [ -L "$dir/$repo" ]; then
        state="main clone"
      elif [ -d "$dir/$repo" ]; then
        state="$(git -C "$dir/$repo" branch --show-current)"
        if [ -n "$(git -C "$dir/$repo" status --porcelain)" ]; then
          state="$state, dirty"
        fi
      else
        state="-"
      fi
      printf '  %s: %s' "$repo" "$state"
    done
    echo
  done
}

cmd_rm() {
  local branch="" force=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --force)
        force="--force"
        shift
        ;;
      -*) usage ;;
      *)
        branch="$1"
        shift
        ;;
    esac
  done
  [ -n "$branch" ] || usage
  local dir
  dir="$(task_dir "$branch")"
  [ -d "$dir" ] || fail "no task at $dir"

  local repo
  for repo in woofx3 woofx3-ui; do
    if [ -L "$dir/$repo" ]; then
      rm "$dir/$repo"
    elif [ -d "$dir/$repo" ]; then
      # Refuses a worktree with uncommitted changes unless --force.
      git -C "$CODE_ROOT/$repo" worktree remove $force "$dir/$repo" ||
        fail "$dir/$repo has uncommitted changes; commit them or pass --force"
    fi
  done
  rm -f "$dir/.slot" "$dir/ports.env"
  rmdir "$dir" || fail "$dir is not empty; left in place"
  echo "removed $dir (branch $branch kept)"
}

cmd_config() {
  local slot=0
  if [ "${1:-}" = "--slot" ]; then
    slot="${2:?--slot needs a number}"
  fi
  write_engine_config "$(git rev-parse --show-toplevel)" "$slot"
}

case "${1:-}" in
  new)
    shift
    cmd_new "$@"
    ;;
  ls)
    shift
    cmd_ls "$@"
    ;;
  rm)
    shift
    cmd_rm "$@"
    ;;
  config)
    shift
    cmd_config "$@"
    ;;
  *) usage ;;
esac
