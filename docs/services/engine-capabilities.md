# Engine capabilities

The UI talks to engines of many builds: a creator's engine is updated when they pull a new image, not when the UI ships. Before the UI shows a feature that needs engine support, it has to know whether the connected engine has it.

Engine images are tagged, not semver-versioned, so `getEngineInfo().version` cannot answer that. Probing a method and parsing `'x' is not a function.` from the RPC error only works for whole methods, not for new options on an existing one, and it costs a failed call. Hard-coded feature flags in the UI go stale the moment an engine is updated.

Instead the engine lists what it supports.

## The method

```ts
getEngineCapabilities(): Promise<{ schema: 1; capabilities: string[] }>
```

- `capabilities` is a sorted, unique list of capability ids.
- `schema` versions the response shape, not the engine. It changes only if the response stops being a flat list of ids.
- An id's presence means the engine supports that feature. There is no negative form: a missing id means unsupported.

The ids are defined in one place, `ENGINE_CAPABILITIES` in `shared/clients/typescript/api/capabilities.ts` (exported from `@woofx3/api`). The engine route returns exactly those values, less the ids in `UNADVERTISED_ENGINE_CAPABILITIES`, so the list cannot drift from the build that serves it. An id is declared but not advertised when clients need to name it while this build does not support it: a shared contract that lands before the engine implements it, or an older protocol the engine no longer serves.

## Rules

1. **A PR that adds a UI-visible engine feature adds its capability id in the same PR.** That covers a new RPC method, a new option or behavior on an existing method that the UI must know about before using, and a new engine-native workflow action or trigger the UI offers in a picker. Add the entry to `ENGINE_CAPABILITIES` with a comment naming the feature and its methods, and add a row to the table below.
2. **Ids are `<area>.<feature>`**, lower camelCase within each part (`workflow.delayWait`). Once shipped, an id never changes meaning and is never reused. A behavior change clients must tell apart gets a new id.
3. **Ids are not removed while any supported UI still gates on them.** Removing an id tells the UI the feature is gone.
4. **The UI treats a missing `getEngineCapabilities` as a legacy engine with no capabilities.** An engine that predates this method answers with `'getEngineCapabilities' is not a function.`; the UI catches that one error, caches an empty set, and hides every gated feature. Any other error is a real failure and surfaces as one.
5. **The UI ignores ids it does not know.** A newer engine may list features an older UI has never heard of.
6. **Capabilities describe the engine, not platforms.** An id names a generic engine feature: an RPC on the engine API, an option on one, an engine-native workflow action or trigger, or a host extension module code calls (`ctx.obs`), which a platform module needs the engine to provide before it can install. Platform features (Twitch actions, stream info, ads, OBS scene lists read through a module) live in platform modules and are discovered through the module and action catalog (`getModules`, the action catalog from `getActions`, and manifest field option sources resolved by `dispatchFieldOptionsRequest`), which already reflects exactly what is installed. They get no capability id: the engine build does not decide whether a creator has the Twitch module installed, and an id for it would advertise something the engine cannot promise.

## Capability ids

| Id | Feature |
|---|---|
| `analytics.aggregates` | Lifetime and per-session viewer totals and leaderboards: `getViewerTotals`, `getLeaderboard` |
| `analytics.gauges` | Per-minute viewer, follower and subscriber series for a session: `getStreamSessionGauges` |
| `analytics.sessions` | Stream session history: `listStreamSessions`, `getStreamSession`, `getStreamSessionTotals` |
| `config.bundles` | Configuration bundle export, dry-run preview and import: `exportConfig`, `previewImport`, `importConfig` |
| `modules.localEndpoints` | A manifest's `local[]` endpoints, `setRelayConfig`, the `relay.credential.requested` callback, and sceneManager's endpoint dialer reaching OBS through the companion's bridge. See [Local endpoints](./local-endpoints.md) |
| `modules.files` | Reading an installed module's files for a read-only viewer: `listModuleFiles`, `getModuleFile` |
| `modules.oauth` | A manifest's `oauth[]` integrations, `ctx.oauth.request`, and finishing a connect with `completeModuleOAuth` |
| `obs.control` | The `ctx.obs` host extension and the `obs.control` manifest permission, which a module that changes OBS or lists its names needs to install and run |
| `obs.status` | The OBS connection's state and last failure: `getObsStatus` |
| `twitch.dashboardTokens` | A Twitch token that carries the app's `clientId` is renewed by asking the dashboard that sent it (`twitch.token.requested`), not with a refresh token, so the dashboard need not send one. See [Twitch channel → Who renews the token](./twitch-channel.md#who-renews-the-token) |
| `scenes.editorSessions` | Editing a scene live with sceneManager over editor socket protocol 1. Declared but no longer advertised: sceneManager answers a protocol 1 socket with HTTP 426, and a dashboard that only speaks it falls back to saving with `updateScene` |
| `scenes.editorSync` | Editing a scene live with sceneManager over editor socket protocol 2 (`@woofx3/api/scene-editor`): one ordered queue of items per editor across the draft and the published scene, publish and discard as items, exactly one answer per item, and reconnects that catch up from the server's log or rebase onto a snapshot. The socket is opened with the token from `getSceneEditorSession` and `protocol=2`. See [Scene documents](./scene-documents.md) |
| `widgets.themes` | Theme presets a widget declares, for the theme settings picker: `listWidgetThemes` |
| `workflow.widgetVisibility` | The `scene.widget.visibility` workflow action, which saves a placement's `visible` on the published scene, and the `scenes` / `scenePlacements` field sources its form uses. See [Task types → scene.widget.visibility](../workflow/tasks.md#scene-widget-visibility) |

A test in `api/tests/engine-capabilities.test.ts` fails if an id in `ENGINE_CAPABILITIES` has no row here.
