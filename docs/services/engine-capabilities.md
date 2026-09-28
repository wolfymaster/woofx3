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

The ids are defined in one place, `ENGINE_CAPABILITIES` in `shared/clients/typescript/api/capabilities.ts` (exported from `@woofx3/api`). The engine route returns exactly those values, so the list cannot drift from the build that serves it.

## Rules

1. **A PR that adds a UI-visible engine feature adds its capability id in the same PR.** That covers a new RPC method, a new option or behavior on an existing method that the UI must know about before using, and a new engine-native workflow action or trigger the UI offers in a picker. Add the entry to `ENGINE_CAPABILITIES` with a comment naming the feature and its methods, and add a row to the table below.
2. **Ids are `<area>.<feature>`**, lower camelCase within each part (`workflow.delayWait`). Once shipped, an id never changes meaning and is never reused. A behavior change clients must tell apart gets a new id.
3. **Ids are not removed while any supported UI still gates on them.** Removing an id tells the UI the feature is gone.
4. **The UI treats a missing `getEngineCapabilities` as a legacy engine with no capabilities.** An engine that predates this method answers with `'getEngineCapabilities' is not a function.`; the UI catches that one error, caches an empty set, and hides every gated feature. Any other error is a real failure and surfaces as one.
5. **The UI ignores ids it does not know.** A newer engine may list features an older UI has never heard of.

## Capability ids

| Id | Feature |
|---|---|
| `alerts.skipClear` | Alert queue controls on the live dashboard: `skipCurrentAlert`, `clearAlertQueue` |
| `analytics.aggregates` | Lifetime and per-session viewer totals and leaderboards: `getViewerTotals`, `getLeaderboard` |
| `analytics.gauges` | Per-minute viewer, follower and subscriber series for a session: `getStreamSessionGauges` |
| `analytics.sessions` | Stream session history: `listStreamSessions`, `getStreamSession`, `getStreamSessionTotals` |
| `widgets.themes` | Theme presets a widget declares, for the theme settings picker: `listWidgetThemes` |

A test in `api/tests/engine-capabilities.test.ts` fails if an id in `ENGINE_CAPABILITIES` has no row here.
