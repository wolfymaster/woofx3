# Candidate Issues (unreviewed)

This is an unreviewed candidate backlog generated from a codebase scan on 2026-08-09.
Nothing here is a filed GitHub issue yet — review, trim, and edit before turning any
item into a real issue (e.g. via `gh issue create --title ... --body ...`).

## API mock/persistence gaps

### ~~Assets API is mock, in-memory, and non-persistent~~ — RESOLVED

- **Resolution:** `api/src/routes/assets.ts` and the `mockAssets` fixture in `context.ts` were deleted outright (no db-proxy-backed assets endpoint existed to persist to; there was nothing to migrate). Confirmed unreferenced elsewhere and covered by `bun test` passing post-deletion.

### ~~Accounts/Teams API backed by hardcoded in-memory arrays~~ — PARTIALLY RESOLVED

- **Resolution:** `api/src/routes/teams.ts` and the `currentUser`/`teams` fixtures were deleted outright. `api/src/routes/accounts.ts` was trimmed to keep only `getStreamStatus` (already db-backed via `db.getSetting`); the mock `getAccounts`/`getAccount`/`updateAccount` handlers and the `accounts` fixture were removed rather than wired to db-proxy — there was no real accounts domain in db-proxy to back them.

### ~~User preferences stored in-memory only~~ — RESOLVED

- **Resolution:** `api/src/routes/preferences.ts` and the `userPreferences` fixture were deleted outright.

### ~~Dashboard "recent runs" data may be fixture data, not real executions~~ — RESOLVED

- **Resolution:** The `workflowRuns` fixture in `context.ts` had zero remaining readers (dashboard.ts/dashboard-stats.ts already source from real db calls) and was deleted as dead weight.

### `getStreamStatus` ignores `accountId` (single-broadcaster limitation)

- **Files:** `api/src/routes/accounts.ts:20-47`
- **Category:** enhancement
- **Size:** medium
- **Description:** A comment explicitly defers per-application platform-link resolution until multi-application support exists. Worth tracking as a scoped follow-up rather than leaving as a silent limitation.

## db-proxy (Go)

### `ListWorkflowExecutions` silently ignores all filter/sort params

- **Files:** `db/app/services/workflow_service.go:424`, `db/proto/v1/workflow.proto:227-238`
- **Category:** bug
- **Size:** medium
- **Description:** The proto defines `workflow_id`, `application_id`, `status`, `started_by`, `from`, `to`, `sort_by`, `sort_desc`, `page`, `page_size`, but the handler just calls `GetRecentWorkflowExecutions(limit)` and ignores every filter. Any caller filtering by status or workflow silently gets unfiltered results.

### `WorkflowExecution.Steps` is never populated

- **Files:** `db/app/services/workflow_service.go:549`, `db/proto/v1/workflow.proto:91,95`
- **Category:** bug / enhancement
- **Size:** medium-large (needs engine-side step tracking too)
- **Description:** The `ExecutionStep` proto message exists but nothing writes per-step execution detail, so execution-detail UIs can't show step-by-step progress/results.

### Casbin authorization missing on workflow routes

- **Files:** `db/app/routes/workflow.go:21` (commented-out `casbinMiddleware.Wrap(...)`)
- **Category:** bug (security) / tech-debt
- **Size:** small-medium
- **Description:** Workflow routes are only gated by "higher-level proxy auth", not per-resource policy — a real gap once any client other than the trusted api-gateway can reach db-proxy directly.

### Casbin authorization missing on scene routes

- **Files:** `db/app/routes/scene.go:16,25`
- **Category:** bug (security) / tech-debt
- **Size:** small-medium
- **Description:** Same casbin gap as the workflow routes, scoped to scene endpoints.

### Casbin authorization missing on alert routes

- **Files:** `db/app/routes/alert.go:24`
- **Category:** bug (security) / tech-debt
- **Size:** small-medium
- **Description:** Same casbin gap as the workflow routes, scoped to alert endpoints.

### Casbin authorization missing on overlay_token routes

- **Files:** `db/app/routes/overlay_token.go:16,26`
- **Category:** bug (security) / tech-debt
- **Size:** small-medium
- **Description:** Same casbin gap as the workflow routes, scoped to overlay-token endpoints.

### Remove or finish dead `AutoMigrate` call

- **Files:** `db/database/db.go:58`
- **Category:** tech-debt
- **Size:** small
- **Description:** A commented-out `db.AutoMigrate(&User{}, ...)` call with a `// TODO: Enable` note. Either finish wiring these models into migrations or remove the dead code/comment.

## barkloader (Rust)

### Remove unused `ModuleCommand::process()`/`ModuleWorkflow::process()` stubs

- **Files:** `barkloader/app/src/services/module_service/module_manifest.rs:1013-1021,1309-1317`
- **Category:** tech-debt
- **Size:** small
- **Description:** Both methods are marked `#[allow(dead_code)]` and just log "stub: ... (use register() instead)". Either remove the dead methods or document why they're kept.

### Audit `#[allow(dead_code)]` usage across module_service

- **Files:** `barkloader/app/src/services/module_service/{canonical_id.rs:145,209; module_manifest.rs:434,445,455,467,709,1014; module_delete.rs:72; db_proxy.rs:1009,1440}`, `lib_repository/src/repository.rs:23,30`
- **Category:** tech-debt
- **Size:** medium
- **Description:** Worth an audit pass to remove truly-dead code vs. add `#[cfg(test)]` or find proper usage.

## twitch / streamlabs (legacy)

### Rewrite or delete `twitch/src/api.ts` (mostly dead commented code)

- **Files:** `twitch/src/api.ts` (~459 lines, roughly 30-435 are inert commented EventSub handler code)
- **Category:** tech-debt
- **Size:** medium
- **Description:** This file doesn't reflect the current architecture (NATS bus / db-proxy) and needs a real rewrite or deletion. Also contains stray `// TODO: Is there a better name?` comments at lines 49, 58, 116, 166, 216.

### Missing gift-subscription EventSub handler

- **Files:** `twitch/src/api.ts:94`
- **Category:** enhancement
- **Size:** medium
- **Description:** `// TODO: Add gift subscription event` sits inside dead/commented code, so gift subs aren't handled at all even though regular subs are. Only relevant if Twitch integration is revived (depends on the item above).

### Persist streamlabs paint-game state instead of in-memory object

- **Files:** `streamlabs/server.ts:60,239-248`
- **Category:** bug
- **Size:** small
- **Description:** `inMemoryStorageKV` resets pen-color/game state on every restart, despite the rest of the service persisting to InstantDB (`db.transact`) — an inconsistent persistence story.

### Remove legacy SockJS OBS path / add connection timeout

- **Files:** `streamlabs/server.ts:44-49`
- **Category:** tech-debt / bug
- **Size:** medium
- **Description:** A `// TODO: Prolly want a timeout on the socket connection...` note sits alongside a fully commented-out legacy SockJS/SLOBS client path next to a new direct `OBSWebSocket` connection. Two half-migrated OBS connection paths currently coexist; the legacy path should be removed or the migration finished.

## docs / roadmap

### Update stale overlay asset-prefix doc post-sceneManager migration

- **Files:** `docs/woofwoofwoof/streamware/asset-prefix.md:18`
- **Category:** documentation
- **Size:** small
- **Description:** Doc states `{overlayPublicUrl}/overlay/assets/user/...` is reserved but "not yet implemented." Confirm whether sceneManager's new asset-serving path (introduced in `e46d877`) covers this, or update/remove the doc.

### SPEC.md future consideration: multi-engine federation

- **Files:** `SPEC.md:658-667`
- **Category:** enhancement
- **Size:** large
- **Description:** Listed under "Future Considerations" with no tracking issue. Placeholder for scoping work later.

### SPEC.md future consideration: workflow versioning/rollback

- **Files:** `SPEC.md:658-667`
- **Category:** enhancement
- **Size:** large
- **Description:** Listed under "Future Considerations" with no tracking issue. Placeholder for scoping work later.

### SPEC.md future consideration: Prometheus/Grafana metrics

- **Files:** `SPEC.md:658-667`
- **Category:** enhancement
- **Size:** large
- **Description:** Listed under "Future Considerations" with no tracking issue. Placeholder for scoping work later.

### SPEC.md future consideration: plugin marketplace

- **Files:** `SPEC.md:658-667`
- **Category:** enhancement
- **Size:** large
- **Description:** Listed under "Future Considerations" with no tracking issue. Placeholder for scoping work later.

### SPEC.md future consideration: audit logging

- **Files:** `SPEC.md:658-667`
- **Category:** enhancement
- **Size:** large
- **Description:** Listed under "Future Considerations" with no tracking issue. Placeholder for scoping work later.

### SPEC.md future consideration: workflow replay

- **Files:** `SPEC.md:658-667`
- **Category:** enhancement
- **Size:** large
- **Description:** Listed under "Future Considerations" with no tracking issue. Placeholder for scoping work later.

### SPEC.md future consideration: distributed modules

- **Files:** `SPEC.md:658-667`
- **Category:** enhancement
- **Size:** large
- **Description:** Listed under "Future Considerations" with no tracking issue. Placeholder for scoping work later.
