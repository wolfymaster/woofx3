# woofx3 local mode: groundwork plan (no visible change)

Date: 2026-10-17. Builds on `reports/Woofx3 Tauri desktop architecture.md`.

## Goal and ground rules

Everything in this plan ships to today's users (hosted web app, managed Railway engines, bring-your-own engines, process-compose dev) with **no visible change**. Each PR moves the codebase toward the desktop / self-hosted local mode:

- one UI, with engine access behind an `EngineGateway`;
- the engine as the only marketplace client, installing by listing id;
- an engine that can run on a desktop under a supervisor, safely on loopback.

Rules every PR follows:

1. **Unset flag = today's behaviour.** New env vars and options default to what happens now.
2. **Convex only uses a new engine path when the engine advertises a capability** (`shared/clients/typescript/api/capabilities.ts`, mirrored by `convex/lib/engineCapabilities.ts`). The old path stays as the fallback until cleanup. Riskier switches also sit behind a Convex percent flag (`convex/lib/featureFlags.ts`), rolled out to managed engines first.
3. **Refactors move code, not behaviour.** Field names, loading/error semantics and error messages stay identical.
4. **Engine before control plane.** An engine PR is released (managed engines upgraded) before the Convex PR that uses it.

Not in this plan, because they are visible or need product decisions: local-mode UI routing without `AuthGuard`, the desktop shell itself, Twitch device-code auth, the direct-capnweb gateway, edition upgrade-in-place, and the cloud command queue.

---

## Track A: UI `EngineGateway` refactor (woofx3-ui)

**Outcome:** components and pages call domain hooks only. A single `ConvexEngineGateway` implements them with today's Convex and transport calls. A second (direct-to-engine) implementation can be added later without touching components.

Facts that shape it: Biome 2.3.2 is the linter (no ESLint). Tests are `bun test`, pure functions only. TanStack Query is not installed. `convex/react` is imported by 148 client files. The transport is a module singleton used by 9 files.

### A0. Foundation (~400 lines, no call sites change)
- `client/src/engine/`:
  - `types.ts`: domain types (prefer re-exporting `@woofx3/api`).
  - `gateway.ts`: the `EngineGateway` interface, one namespace per domain.
  - `context.tsx`: `EngineGatewayProvider` and `useEngineGateway()`. The provider sits inside `BroadcastShell` and owns `instanceId` and `optimisticInstanceId`, so engine hooks take no instance id.
  - `convex/`: the adapter, the only place allowed to touch engine `api.*` modules.
  - `hooks/`: the public domain hooks.
- Two read shapes, deliberately matching today:
  - `Live<T>`: `undefined` while loading, throws on error (what `useQuery` does).
  - `Fetched<T>`: `{data, isLoading, error, refetch}`, generalised from `hooks/use-resources.ts` and its request-sequence guard.
- Gateway hooks are chosen once at boot, so Rules of Hooks hold. They memoise on the function name (see `use-optimistic-instance-query.ts` for the re-render trap).
- Ratchet:
  - **(a)** `client/src/engine/boundary.test.ts` greps `components|pages|hooks|lib` for engine `api.<module>.` references. It fails for files not on a checked-in allowlist, and also fails when an allowlisted file is already clean, so the list can only shrink. Biome cannot ban property access, which is why this is a test.
  - **(b)** a Biome `noRestrictedImports` override bans `@/lib/transport` outside `client/src/engine/**` and `use-sync-engine-transport.ts`, with the 9 current files allowlisted.
- **No TanStack Query now.** It would change loading and error semantics everywhere. The `Live` / `Fetched` contract keeps that decision open for later.

### A1–A11. One domain per PR

Each PR moves `api.*` calls into the adapter. Mappers add fields and never drop them (`_id` and `_creationTime` are used for keys and sorting).

| PR | Namespace | Client files | Size | Notes |
|---|---|---|---|---|
| A1 | `status` (capabilities, engine info, health, OBS, live state, sync) | 9 | S | Mostly existing hooks. Must keep the optimistic id and error swallowing in `use-live-state`. |
| A2 | `resources` | 4 | S | `use-resources` moves almost as is. |
| A3 | `eventLog` | 3 + transport hooks | M | First namespace to absorb transport calls. |
| A4 | `alertQueue` | 5 | S | |
| A5 | `alertLibrary` | 4 | S | |
| A6 | `commands` | 8 | M | `use-item-commands.ts` (591 lines). |
| A7 | `moduleResources` | 10 | M/L | Touch only the data lines of `module-detail-panel.tsx` (1,678 lines). Its cloud calls stay on Convex. |
| A8 | `modules` (runtime) | 8 | M | Includes transport `listEngineModules`. |
| A9 | `scenes` | 12 | L | Late and on its own, because the editor has active work. |
| A10 | `requests` (transientEvents correlation) | 10 | M/L | Wrap it as `useCorrelated(kind)` returning `{start, event, failure}`, same behaviour. Not a Promise yet. |
| A11a–c | `workflows` (reads / actions / runs + health) | 18 + 7 lib | XL | First switch the pure libs from `Doc<"workflows">` to a structural `WorkflowRecord` type (type-only change). |
| A12 | `macros.run`, `streamOps`, `config` | ~14 | S each | Macro CRUD stays on Convex (cloud-owned, optimistic updates). |

`moduleRepository` and the marketplace install hooks are left out here. Track B changes what sits behind them.

**Testing:**
- `bun run check` and `check:convex`. Mappers are typed `(doc: Doc<"x">) => X`, so field drift is a compile error.
- A bun test for each mapper.
- Optional hook tests with `mock.module("convex/react")` for A1, A10 and A11.
- A manual smoke checklist per PR against a dev engine.

---

## Track B: marketplace moves into the engine (marketplace-api, woofx3, woofx3-ui)

**Outcome:**
- The engine is the only thing that talks to marketplace-api for catalog reads, inspection and installs, by listing id, with mandatory size and SHA-256 checks.
- Convex mints short-lived buyer tokens instead of using `API_TOKEN` for content.
- Checkout and the account entitlement list stay in Convex and the browser for now.

**Baseline warning:** the catalog and commerce code (`convex/marketplaceCatalog.ts`, `lib/marketplaceApi.ts`, `lib/marketplaceEntitlement.ts`, `lib/marketplaceInstalls.ts`) exists only on unmerged `origin/phase-b/marketplace-ui`. `master` uses only `/modules*`. Land or rebase phase-b first, or base B5/B7 on whichever is current.

Already true today:
- Marketplace installs go through the engine's `installModuleFromUrl` with a presigned R2 URL (`convex/marketplace.ts:496`).
- `deliverZipToInstance` is for **private uploads**, not the marketplace (see B10).

| PR | Repo | Change | Depends on |
|---|---|---|---|
| B1 | marketplace-api | `backfill-integrity` subcommand that re-runs `/complete` for ready rows missing `sha256`. Run it in prod and confirm zero remain. Add a test that download always returns `sha256` and `sizeBytes`. | none |
| B2 | marketplace-api | Accept **buyer tokens** (`internal/httpapi/buyertoken.go`). See below. | none |
| B3 | woofx3 | Engine marketplace client and RPC methods, **unused**. See below. | B2 contract |
| B4 | woofx3-ui | `convex/lib/marketplaceBuyerToken.ts`: Ed25519 signing via WebCrypto (`MARKETPLACE_BUYER_SIGNING_KEY` / `_KEY_ID`, 5 min expiry, `tier` from `marketplaceAccessFor`), and `buyerTokenFor(ctx, instanceId)`. Unused. | B2 deployed with the public key |
| B5 | woofx3-ui | Route installs through the engine. See below. | B1–B4 deployed |
| B6 | woofx3 | Record provenance: `marketplace_listing_id` and `marketplace_edition` columns (migration + `db/proto/v1/module.proto`, regenerated Go/TS/Rust), returned by `getModule` and `listEngineModules`. | B3 (parallel to B5) |
| B7 | woofx3 + ui | Catalog reads through the engine. See below. | B3, phase-b |
| B8 | woofx3 | Restrict `installModuleFromUrl` to the marketplace and R2 host allowlist (`WOOFX3_MARKETPLACE_DOWNLOAD_HOSTS`). | B5 fully rolled out |
| B9 | all | Cleanup. See below. | capability reported by all reachable engines |
| B10 | woofx3 + ui | (Separate) Private uploads: the engine pulls a short-lived Convex storage URL instead of `deliverZipToInstance` pushing to it. | independent |

**B2 detail:**
- Verifies an Ed25519 JWS: `aud=marketplace`, `exp` of 5 minutes or less, known `kid` from `CONTROL_PLANE_PUBLIC_KEYS`, `sub=account:{id}`, optional `tier:"dev"`.
- Allowed only on `acquire`, `quote`, `entitlement`, `bundle`, `/modules/{id}/download` and `GET /entitlements`.
- `buyerRef` comes from the token and the query parameter is ignored. `API_TOKEN` keeps working. Checkout and grants remain `API_TOKEN`-only.
- Tests: bad signature, expired token, wrong audience, cross-buyer access, the dev claim.

**B3 detail:**
- `marketplaceUrl` setting (`WOOFX3_MARKETPLACE_URL`, defaults to the public URL; empty disables it).
- `api/src/marketplace-client.ts` and `api/src/routes/marketplace.ts` provide:
  - `installMarketplaceListing(listingId, {approvedPermissions, approvedLocalEndpoints, buyerToken?})`:
    1. `/catalog/{id}`
    2. `acquire` (402 means `payment_required`)
    3. `/download`
    4. fetch only from allowlisted hosts
    5. verify size and SHA-256
    6. consent check (same `needs_approval` shape)
    7. install under the **unchanged key `${listingId}:${version}:${sha7}`**
    8. `module.install*` webhooks
  - `inspectMarketplaceListing` (manifest, permissions, local endpoints, file list).
  - `installMarketplaceBundle`.
- Register in `RPC_METHODS` (`api/src/api-session.ts`) and `shared/clients/typescript/api/api.ts`.
- Capability `modules.marketplaceInstall`.
- Tests against a fake marketplace: hash mismatch, size mismatch, foreign host, 402, needs-approval, already installed, and a key-format pin.

**B5 detail:**
- `installFromMarketplace`, `installBundle`, `moduleFiles.resolveFileSource` and `setupPlatformsActions.listForSetup` take the engine path when both the capability and flag `marketplace.engineInstall` allow it. They mint a token per call.
- `payment_required` maps to the existing error text. Progress still goes through `transientEvents`.
- Drop the `/installs` ping (the route doesn't exist on marketplace-api `master`); `acquire` now records installs.

**B7 detail:**
- Engine methods `marketplaceSearch`, `marketplaceCounts`, `marketplaceGetListing`, `marketplaceGetAuthor` and `marketplaceQuote` return the marketplace JSON unchanged, behind capability `marketplace.catalog`.
- Convex actions keep their names and shapes and only change their source.
- A golden test checks that the old and new sources parse identically.

**B9 detail:**
- Convex removes the fallbacks, `MARKETPLACE_DEV_TOKEN`, `fetchMarketplaceArchive` and the entitlement pre-checks. `MARKETPLACE_API_TOKEN` stays for checkout and the entitlement list.
- The engine drops `installModuleFromUrl` from the contract, and SHA-256 and size become mandatory.

**Behaviour notes:**
- Once `acquire` is called, free installs start counting on the engine path only. That is intended, and only counted there to avoid double counting.
- Keep the install key format pinned by test.
- Edition upgrade-in-place under the shared manifest key is deferred because it is visible.

---

## Track C: engine prep for local mode (woofx3, a little woofx3-ui)

Verified against the code. Every flag defaults to today's behaviour.

### C1. Localhost hardening (behind flags)
- **C1a. Host and Origin guard** in api and sceneManager:
  - `WOOFX3_ALLOWED_HOSTS` and `WOOFX3_ALLOWED_ORIGINS`.
  - Unset means allow everything (today).
  - When set: 421 on an unknown Host (stops DNS rebinding), 403 on an unknown Origin (including WebSocket upgrades), and CORS echoes the matched origin instead of `*`.
  - It must stay off by default, because the hosted dashboard connects directly to engines from several origins. S.
- **C1b. Registration modes:**
  - `WOOFX3_REGISTRATION_MODE=open|token|first`; when unset, the mode is derived from whether a token exists.
  - `WOOFX3_REGISTRATION_TOKEN_FILE` generates a token, writes it with 0600 permissions, and the engine reads it from there. A Tauri parent can read the file.
  - Managed engines already get a token from maintenance (`woofx3-maintenance/src/engines/engine-env.ts:23`) and Convex sends it, so no Convex change is needed. BYO stays open.
  - S.
- **C1c. NATS bind and auth:**
  - `WOOFX3_MESSAGEBUS_TOKEN` (server `opts.Authorization`; Go, TS and Rust clients send it when set).
  - An opt-in flag to disable the unused TCP listener on 4222.
  - Opt-in `Websocket.SameOrigin`, after checking that the Bun and tungstenite clients don't send `Origin`.
  - Keep the default bind as it is; the local packager sets `127.0.0.1`.
  - M (three languages).
- **C1d. Barkloader webhook auth:** first make barkloader send the `barkloaderKey` bearer token, then enforce it when the key is set. S.

### C2. Twitch token strategies (pure refactor)
- Pull out `TokenStrategy` (`dashboard` | `engineRefresh`) and `selectStrategy()` from `api/src/twitch-token-source.ts` and `shared/clients/typescript/twitch/index.ts`.
- Add a test that loopback callback URLs are accepted. A desktop shell can then register as a dashboard client and answer `twitch.token.requested` from the keychain, with no engine change.
- No third strategy yet; device-code public-client refresh is unverified. S.

### C3. Helix calls move from Convex into the engine
The engine's twitch service already implements most commands over the `twitchapi` NATS subject, but no API route forwards to it.

Pattern for each sub-PR:
1. Engine: a typed `ApiSession` method that forwards to `twitchapi` (10s timeout, `{error, code}` result), plus a capability, released first.
2. Convex: uses the engine when the capability is present, **falls back to direct Helix if the engine is unreachable**, and logs the fallback.

State (shoutout queue, pins cache) stays in Convex.

| PR | Capability | Convex module | Engine work | Size |
|---|---|---|---|---|
| C3a | `twitch.streamInfo` | `streamInfo.ts` | existing commands | M |
| C3b | `twitch.ads` | `adBreaks.ts` | existing | S |
| C3c | `twitch.moderation` | `moderation.ts` | add ban, unban, blocked terms, chat settings | M |
| C3d | `twitch.chat` | `twitchBroadcast.ts`, `shoutouts.ts` | messages, announcements, shoutouts, chatters | M |
| C3e | `twitch.pins`, `twitch.clips` | `pins.ts`, `twitchClips.ts` | pins (beta), clips | S–M |

`streamRecap.ts` batch clip work stays in Convex.

### C4. Config and data paths
- **C4a.** TS and Rust honour `WOOFX3_ROOT` (Go already does) and a new `WOOFX3_CONFIG` file path. NATS checks them before its exe-dir search. S.
- **C4b.** `WOOFX3_DATA_DIR`: relative database, storage, log and module paths resolve under it. This matters on Windows, where the orchestrator currently logs into the exe directory (Program Files). M.
- **C4c** (later): on first run with a data dir, copy an existing `./data` into it. S.

### C5. Orchestrator supervision (`build/orchestrator/main.go`)
- **C5a** (opt-in):
  - Machine-readable status as JSON lines on stdout or a file, with `ready` sent when api `/ready` returns 200.
  - Child output goes to per-service log files in that mode.
  - `--exit-on-stdin-eof` for parent-death handling.
  - Replace the `isWindows` guess with `runtime.GOOS`.
  - M.
- **C5b** (Windows, build-tagged):
  - Job Object with `KILL_ON_JOB_CLOSE` and `CREATE_NEW_PROCESS_GROUP`.
  - Stop with `CTRL_BREAK_EVENT`, then wait, then kill.
  - Services handle ctrl-break / SIGBREAK.
  - M.

### C6. Small capability and info additions
- **C6a.** Optional `hosting?: "managed"|"self"|"local"` on `EngineInfo` from `WOOFX3_HOSTING`, plus an `engine.localMode` capability advertised only when it is `local`. XS.
- **C6b.** A `health_endpoint` for the api in `build/config/services.json` (`/ready`), so dependency gating means something. Keep the 30s timeout non-fatal. XS. Do it after C5a.

Dropped: an engine-side "local edition" entitlement. The engine enforces no entitlements (`convex/lib/entitlements.ts` says so explicitly), so the free-tier default for local mode belongs in Convex later.

---

## Recommended order

The three tracks are independent and can run in parallel worktrees.

| Wave | Track A (UI) | Track B (marketplace) | Track C (engine) |
|---|---|---|---|
| 1 | A0 foundation, A1 status, A2 resources | B1 integrity backfill, B2 buyer tokens; settle phase-b | C2, C4a, C6a, `runtime.GOOS` fix |
| 2 | A3–A6 | B3 engine methods, B4 token issuer | C1a, C1b, C1d (barkloader sends the token before enforcement) |
| 3 | A7, A8, A10 | B5 install via engine (flagged rollout), B6 provenance | C4b, C5a, C6b |
| 4 | A9 scenes, A11 workflows | B7 catalog reads | C1c NATS auth, C5b Windows |
| 5 | A12, then remove the ratchet allowlist | B8 URL restriction, B9 cleanup, B10 private uploads | C3a → C3e (engine release first, then the gated Convex switch each time) |

After these waves, the visible work can start against a codebase that's ready for it:
- a `DirectEngineGateway`;
- local-mode routing;
- the Tauri shell from `companion/`;
- Twitch device-code auth.

## Cross-cutting risks

- **Old engines in the field.** Every Convex switch is capability-gated, and fallbacks stay until cleanup PRs.
- **Engine outage turning into a feature failure** (C3, B5). Keep fallbacks during rollout and watch failure rates for each path.
- **Merge conflicts** with active scenes, workflows and marketplace (phase-b) work. Sequence those PRs late and keep them small.
- **The install key format and the Convex `_id` / `_creationTime` fields** are load-bearing. Pin them with tests.
- **NATS auth spans Go, TS and Rust.** Verify under process-compose, the container image and the release zips before enabling it anywhere.
