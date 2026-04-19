# E2E Smoke: applicationId Onboarding

This runbook verifies the UI-driven applicationId onboarding flow end-to-end.
Run it after the `feat/app-id-onboarding` branch is merged (or from the feature
worktree if workspace resolution has been fixed).

The flow under test:

1. Fresh state — db has no `applications` rows. api starts and logs
   `"No default application yet; waiting for UI onboarding"`.
2. First `registerClient("my-app", {userId: "ui-user-1"})` creates the default
   application, creates a users row with `woofx3_ui_user_id = "ui-user-1"`,
   creates a clients row, returns `{clientId, clientSecret, applicationId}`.
3. Second `registerClient("second-client", {userId: "ui-user-2"})` REUSES the
   same default application (still one applications row), creates a new user
   and client, returns the SAME `applicationId` as step 2.
4. `authenticate(clientId, clientSecret)` succeeds with the client issued in
   step 3.

## Prerequisites

- `devbox shell` active (Bun, Go, Rust, sqlite3/psql).
- A clean Postgres database dedicated to this smoke run. Do NOT run this
  against a developer's primary woofx3 database — step 1 requires that the
  `applications` table be empty.
- Services built from a clean checkout of master (post-merge) or a worktree
  with resolved workspaces.

## Environment

Export a throwaway DSN before starting:

```bash
export WOOFX3_DATABASE_URL="postgres://postgres:postgres@localhost:5432/woofx3_smoke?sslmode=disable"
export WOOFX3_BADGER_PATH="/tmp/woofx3-smoke-badger"
export WOOFX3_DATABASE_PROXY_PORT="8090"
export WOOFX3_DATABASE_PROXY_URL="http://localhost:8090"
export WOOFX3_API_PORT="8080"
export WOOFX3_ROOT_PATH="/tmp/woofx3-smoke"
mkdir -p "$WOOFX3_ROOT_PATH/logs" "$WOOFX3_BADGER_PATH"
```

## 1. Reset schema

```bash
# Drop-and-recreate the smoke database.
psql "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable" \
  -c "DROP DATABASE IF EXISTS woofx3_smoke;" \
  -c "CREATE DATABASE woofx3_smoke;"
rm -rf "$WOOFX3_BADGER_PATH" && mkdir -p "$WOOFX3_BADGER_PATH"

# Run all migrations including 0014 (is_default) and 0015 (woofx3_ui_user_id).
make migrate-up DB_URL="$WOOFX3_DATABASE_URL"

# Sanity check — applications must be EMPTY.
psql "$WOOFX3_DATABASE_URL" -c "SELECT count(*) FROM applications;"
# Expected: count = 0
```

## 2. Boot services

Open three terminals (or three tmux panes). All three must share the env vars
above.

### Terminal A — messagebus (NATS)

```bash
cd services/nats && GO_ENV=development go run .
```

### Terminal B — db-proxy

```bash
cd db && go run .
# Expect: HTTP listener on :8090, NATS connected.
```

### Terminal C — api

```bash
cd api && bun run dev 2>&1 | tee /tmp/woofx3-smoke-api.log
```

**Step-1 assertion:** `/tmp/woofx3-smoke-api.log` must contain the line

```
No default application yet; waiting for UI onboarding
```

and must NOT contain `Warmed applicationId cache from existing default`.

Grep to confirm:

```bash
grep -q "No default application yet; waiting for UI onboarding" /tmp/woofx3-smoke-api.log \
  && echo "OK: api logged empty-state message" \
  || echo "FAIL: api did not log empty-state message"
```

## 3. Scripted client — two registrations and an authenticate

Save the following as `scripts/smoke-appid-onboarding.ts` inside the repo root
and run with `bun run scripts/smoke-appid-onboarding.ts`:

```typescript
import { newHttpBatchRpcSession } from "capnweb";
import type { ApiGatewayContract } from "@woofx3/api/rpc";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8080/api";

function openGateway(): ApiGatewayContract {
  return newHttpBatchRpcSession<ApiGatewayContract>(ENGINE_URL);
}

async function main() {
  // Step 2 — first registration.
  const gw1 = openGateway();
  const first = await gw1.registerClient("my-app", { userId: "ui-user-1" });
  console.log("step2 registerClient result:", first);
  if (!first.clientId || !first.clientSecret || !first.applicationId) {
    throw new Error("step2: missing fields in registerClient response");
  }

  // Step 3 — second registration with a different UI user.
  const gw2 = openGateway();
  const second = await gw2.registerClient("second-client", { userId: "ui-user-2" });
  console.log("step3 registerClient result:", second);
  if (second.applicationId !== first.applicationId) {
    throw new Error(
      `step3: applicationId changed between calls (first=${first.applicationId}, second=${second.applicationId})`
    );
  }

  // Step 4 — authenticate with the second client.
  const gw3 = openGateway();
  const session = gw3.authenticate(second.clientId, second.clientSecret);
  // Trigger a pipelined call to force the batch to round-trip.
  const ping = await session.ping();
  console.log("step4 authenticate + ping:", ping);
  if (ping.status !== "ok") {
    throw new Error(`step4: expected ping status=ok, got ${ping.status}`);
  }

  console.log("SMOKE OK");
}

main().catch((err) => {
  console.error("SMOKE FAIL:", err);
  process.exit(1);
});
```

Expected stdout:

```
step2 registerClient result: { clientId: '...', clientSecret: '...', applicationId: '<uuid-A>' }
step3 registerClient result: { clientId: '...', clientSecret: '...', applicationId: '<uuid-A>' }
step4 authenticate + ping: { status: 'ok' }
SMOKE OK
```

## 4. DB assertions

```bash
psql "$WOOFX3_DATABASE_URL" <<'SQL'
-- Exactly one application, and it is the default.
SELECT count(*) AS app_count,
       count(*) FILTER (WHERE is_default) AS default_count
FROM applications;
-- Expect: app_count = 1, default_count = 1

-- Two users with the onboarded UI user ids.
SELECT woofx3_ui_user_id
FROM users
WHERE woofx3_ui_user_id IN ('ui-user-1', 'ui-user-2')
ORDER BY woofx3_ui_user_id;
-- Expect: two rows, 'ui-user-1' then 'ui-user-2'.

-- Two clients pointing at the same application.
SELECT count(*)              AS client_count,
       count(DISTINCT application_id) AS app_ref_count
FROM clients
WHERE description IN ('my-app', 'second-client');
-- Expect: client_count = 2, app_ref_count = 1
SQL
```

All three queries must match their expected values. If any differ, the smoke
FAILS — do not merge.

## 5. Cleanup

```bash
# Kill the three service processes (Ctrl-C each terminal).
psql "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable" \
  -c "DROP DATABASE IF EXISTS woofx3_smoke;"
rm -rf "$WOOFX3_BADGER_PATH" "$WOOFX3_ROOT_PATH"
```

## Known constraints

- Workspace resolution inside the `feat/app-id-onboarding` worktree may leave
  `@woofx3/api` missing from `api/node_modules/@woofx3/`. Run this smoke from
  the main checkout post-merge, not from the worktree, unless workspaces have
  been re-installed cleanly.
- The api service gracefully continues if NATS is unavailable (offline mode).
  The smoke still exercises the registerClient / authenticate path without
  NATS, but production deployments should always run the messagebus.
- `registerClient` requires `options.userId` — passing an empty string or
  omitting the object will throw `registerClient: options.userId is required`
  at the gateway, which is the intended behavior post-onboarding refactor.
