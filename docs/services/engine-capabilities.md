# Engine capabilities

The UI talks to engines of many builds: a creator's engine is updated when they pull a new image, not when the UI ships. Before the UI shows a feature that needs engine support, it has to know whether the connected engine has it.

Releases are semver tags (`v0.x.y`), and `getEngineInfo().version` reports the running one, but a version alone is a poor gate: a build from source or a branch reports `dev`, and a UI that compares versions has to know which release shipped every feature it uses. Probing a method and parsing `'x' is not a function.` from the RPC error only works for whole methods, not for new options on an existing one, and it costs a failed call. Hard-coded feature flags in the UI go stale the moment an engine is updated.

Instead the engine lists what it supports.

## The method

```ts
getEngineCapabilities(): Promise<{ schema: 1; capabilities: string[] }>
```

- `capabilities` is a sorted, unique list of capability ids.
- `schema` versions the response shape, not the engine. It changes only if the response stops being a flat list of ids.
- An id's presence means the engine supports that feature. There is no negative form: a missing id means unsupported.

The public `GET /health` body carries the same list as `capabilities.enabled` (see [deployment.md](deployment.md)), for checking an engine's features from outside without a registered client. The UI gates on `getEngineCapabilities`, not on `/health`.

The ids are defined in one place, `ENGINE_CAPABILITIES` in `shared/clients/typescript/api/capabilities.ts` (exported from `@woofx3/api`). The engine route returns exactly those values, less the ids in `UNADVERTISED_ENGINE_CAPABILITIES`, so the list cannot drift from the build that serves it. An id is declared but not advertised when clients need to name it while this build does not support it: a shared contract that lands before the engine implements it, or an older protocol the engine no longer serves.

A few ids describe how the engine is run rather than what its build can do. They are listed in `HOSTING_ENGINE_CAPABILITIES` with the hostings that advertise each, and an engine advertises one only when its deployment declares one of those hostings with `WOOFX3_HOSTING` (`managed`, `self` or `local`; the same value `getEngineInfo().hosting` reports). With `WOOFX3_HOSTING` unset the engine advertises none of them, and `getEngineInfo()` has no `hosting` field. Any other value stops the api at startup.

## Rules

1. **A PR that adds a UI-visible engine feature adds its capability id in the same PR.** That covers a new RPC method, a new option or behavior on an existing method that the UI must know about before using, and a new engine-native workflow action or trigger the UI offers in a picker. Add the entry to `ENGINE_CAPABILITIES` with a comment naming the feature and its methods, and add a row to the table below with Since `unreleased`.
2. **Ids are `<area>.<feature>`**, lower camelCase within each part (`clients.pairing`). Once shipped, an id never changes meaning and is never reused. A behavior change clients must tell apart gets a new id.
3. **Ids are not removed while any supported UI still gates on them.** Removing an id tells the UI the feature is gone.
4. **The UI ignores ids it does not know.** A newer engine may list features an older UI has never heard of.
5. **Capabilities describe the engine, not platforms.** An id names a generic engine feature: an RPC on the engine API, an option on one, an engine-native workflow action or trigger, or a host extension module code calls (`ctx.obs`), which a platform module needs the engine to provide before it can install. Platform features (Twitch actions, stream info, ads, OBS scene lists read through a module) live in platform modules and are discovered through the module and action catalog (`getModules`, the action catalog from `getActions`, and manifest field option sources resolved by `dispatchFieldOptionsRequest`), which already reflects exactly what is installed. They get no capability id: the engine build does not decide whether a creator has the Twitch module installed, and an id for it would advertise something the engine cannot promise. The engine's own Twitch methods (`twitch*`, served by the built-in Twitch adapter rather than a module) are engine API methods, and get ids like any other.
6. **Capabilities describe the build, not a plan.** An engine reports and serves every capability its build has, whoever hosts it and whatever plan its owner is on. The hosting ids above are the one exception to "whoever hosts it", and they gate no feature of the build: they tell a client how to reach and manage the engine. The engine does not enforce plans: a self-hosted engine of the same build would have the feature anyway, so a gate inside the engine would bind only the managed engines we host, and only against their own owners. Plans are enforced where the engine is not: in the dashboard (woofx3-ui `docs/patterns/entitlements.md`), in cloud services, and in the resources a managed engine is provisioned with.

## Capability ids

Since is the first release whose engine advertised the id, and `unreleased` until one does. Nobody writes it by hand: a new row leaves it `unreleased`, and the release job runs `.github/scripts/capability-since.mts` with the tag it is cutting, which records that tag for every id the release ships, in the same commit as the release's `CHANGELOG.md` entry. The script reads the release tags in git, so running it locally (`node .github/scripts/capability-since.mts`) fills any value a release has already settled. A recorded value never changes.

| Id | Since | Feature |
|---|---|---|
| `clients.pairing` | v0.50.1 | Browser pairing for a local or self-hosted engine: the gateway's `startPairing`, `claimPairing` and `cancelPairing`, `ping().pairing`, an approver's `lookupPairing`, `decidePairing` and `listPendingPairings`, the `client.pairing.started` event, and paired clients bound to the origin they paired from. Advertised only when `WOOFX3_HOSTING` is `local` or `self` (see `HOSTING_ENGINE_CAPABILITIES` above). See [Browser pairing](./pairing.md) |
| `engine.localMode` | v0.35.0 | This engine runs on the streamer's own machine under the desktop app: its deployment sets `WOOFX3_HOSTING=local`, and `getEngineInfo().hosting` is `local`. Advertised only by such an engine (see `HOSTING_ENGINE_CAPABILITIES` above) |
| `workflows.groups` | unreleased | Workflow groups (alert groups): `listWorkflowGroups`, `createWorkflowGroup`, `updateWorkflowGroup`, `deleteWorkflowGroup`, `setWorkflowGroupEnabled`, `addWorkflowGroupMembers` and `removeWorkflowGroupMembers`, the `workflow_group.{created,updated,deleted}` events, and `groupIds` on workflows. See [Workflow groups](../workflow/api.md#workflow-groups) |

A test in `api/tests/engine-capabilities.test.ts` fails if an id in `ENGINE_CAPABILITIES` has no row here, or its row has no Since value (a release tag or `unreleased`).

## Retiring a check

A capability check is temporary: a client gates on an id only until every engine it supports has it. Since says when that is. Once every engine in use runs a release at or after an id's Since, clients drop the check and its fallback for an older engine. Only after no supported client still checks the id (rule 3) does it leave `ENGINE_CAPABILITIES` and this table: a client that still checked it would otherwise take the engine for one that lacks the feature.

## Retired ids

These ids were declared and are no longer: every engine has the feature, and no client gates on it. Under rule 2 none is ever reused.

`alerts.compositionLayout`, `alerts.history`, `alerts.overview`, `alerts.queueControls`, `alerts.queueState`, `analytics.aggregates`, `analytics.gauges`, `analytics.sessionEvents`, `analytics.sessions`, `assets.sizedUploads`, `compositions.alerts`, `compositions.preview`, `config.bundles`, `engine.eventStream`, `events.log`, `marketplace.catalog`, `modules.files`, `modules.localEndpointCalls`, `modules.localEndpoints`, `modules.marketplaceInstall`, `modules.oauth`, `modules.resourceInstall`, `modules.resourceKinds`, `modules.storageUsage`, `obs.control`, `obs.status`, `platform.gateway`, `scenes.behaviors`, `scenes.editorSessions`, `scenes.editorSync`, `scenes.repair`, `scenes.snapshots`, `twitch.ads`, `twitch.chat`, `twitch.clips`, `twitch.dashboardTokens`, `twitch.deviceLogin`, `twitch.linkRead`, `twitch.moderation`, `twitch.pins`, `twitch.streamInfo`, `ui.settings`, `userPages.formSubmissions`, `widgets.themes`, `workflow.catalog`, `workflow.conditionListReferences`, `workflow.delayWait`, `workflow.dryRun`, `workflow.expressionFunctions`, `workflow.health`, `workflow.realCancel`, `workflow.runDetail`, `workflow.runSnapshots`, `workflow.testRunOptions`, `workflow.viewerFacts`, `workflow.widgetVisibility`.
