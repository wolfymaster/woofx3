# Module Format

A module is a ZIP archive whose root contains a **`module.json`** or **`module.yaml`** manifest. The canonical JSON field names and semantics match **`module-improvements-spec.md`** in the **woofx3-ui** repository. The archive also includes function sources, widget HTML/assets, overlay entry files, and any other paths referenced by the manifest.

## Structure (example)

```
my-module.zip
  |-- module.json
  |-- functions/
  |     +-- handler.lua
  |-- widgets/
  |     +-- alerts/
  |           +-- index.html
  |           +-- static/
  |                 +-- style.css
  |-- overlays/
        +-- main/
              +-- index.html
```

The manifest is **required**. If no `module.json` / `module.yaml` is found (after extraction), processing fails.

**Manifest selection:** if multiple JSON/YAML files exist, barkloader prefers `module.json`, then `module.yaml` / `module.yml` (including under subpaths), then falls back to the first manifest-looking file.

## Manifest (canonical shape)

The manifest uses **camelCase** JSON keys. All top-level sections are optional **except** `id` and `name`, which must be present for a valid module record.

### Example `module.json`

```json
{
  "id": "twitch-platform",
  "name": "Twitch Platform",
  "version": "1.0.0",
  "description": "Twitch eventbus triggers and platform actions",

  "triggers": [
    {
      "id": "channel_subscribe",
      "name": "Twitch Subscription",
      "description": "Fires when a viewer subscribes",
      "type": "eventbus",
      "event": "channel.subscribe",
      "schema": [{ "id": "tier", "label": "Tier", "type": "select" }]
    }
  ],
  "functions": [
    {
      "id": "play_alert",
      "name": "Play Alert Handler",
      "runtime": "lua",
      "path": "functions/play_alert.lua"
    }
  ],
  "actions": [
    {
      "id": "play_alert",
      "name": "Play Alert",
      "description": "Trigger the alert widget",
      "type": "function",
      "function": "play_alert",
      "schema": [{ "id": "alertType", "label": "Alert type", "type": "text" }]
    }
  ],
  "commands": [
    {
      "id": "clip",
      "name": "!clip",
      "pattern": "!clip",
      "type": "prefix",
      "workflow": "create_clip_workflow",
      "requiredRole": "public"
    }
  ],
  "workflows": [
    {
      "id": "on_subscription",
      "name": "New Subscription Alert",
      "trigger": "channel_subscribe",
      "steps": [
        {
          "id": "alert",
          "type": "action",
          "action": "play_alert",
          "parameters": { "alertType": "subscription" }
        }
      ]
    }
  ],
  "widgets": [
    {
      "id": "alerts-widget",
      "name": "Alerts Widget",
      "description": "Stream alert animations",
      "entry": "widgets/alerts/index.html",
      "assets": "widgets/alerts/",
      "settingsSchema": { "theme": { "type": "string", "default": "default" } },
      "acceptedEvents": ["twitch.subscription", "twitch.cheer"]
    }
  ],
  "overlays": [
    {
      "id": "main-overlay",
      "name": "Main Stream Overlay",
      "description": "Default full-screen overlay",
      "entry": "overlays/main/index.html"
    }
  ]
}
```

### Canonical IDs and References

Every resource a module contributes — triggers, actions, functions, commands, workflows, widgets, overlays — gets a **canonical id** that the rest of the system uses to refer to it. Canonical ids are stable across module versions, unique system-wide, and structured so they encode the resource's provenance. Read this section before the per-section field tables below; the validation rules and reference syntax depend on it.

#### Format

```
{moduleId}:{kind}:{resourceId}
```

| Segment | Source | Notes |
|---------|--------|-------|
| `moduleId` | the manifest's top-level `id` field | **Required.** Namespace-claimed: planned to become globally unique across all modules ever published, like an npm package name (once a moduleId is taken, it stays taken). Install fails if missing or empty. |
| `kind` | reserved keyword identifying the resource type | One of `trigger`, `action`, `function`, `command`, `workflow`, `widget`, `overlay`. Not author-supplied. |
| `resourceId` | the resource's `id` field from the manifest | **Required.** Every trigger / action / function / command / workflow / widget / overlay must declare its own `id`. Install fails if missing or empty. The author still supplies a `name` for display, but downstream lookups never use it. |

**Examples** for a module whose top-level `id` is `twitch_platform`:

| Manifest entry | Canonical id |
|---|---|
| `triggers[0]` with `id: "channel.subscribe"` | `twitch_platform:trigger:channel.subscribe` |
| `triggers[1]` with `id: "channel_cheer"` | `twitch_platform:trigger:channel_cheer` |
| `actions[0]` with `id: "play_alert"` | `twitch_platform:action:play_alert` |
| `functions[0]` with `id: "play_alert"` | `twitch_platform:function:play_alert` |

The trigger and function above share `play_alert` as their resource segment — this is fine because the `kind` segment makes the canonical ids distinct.

**Allowed characters in explicit `id` values:** `[A-Za-z0-9._-]+`. The `:` character is reserved as the canonical id separator. Whitespace, `/`, and other special characters are rejected at install time. Lowercase is recommended for consistency with slugged ids; case is preserved as written but matched case-sensitively in references.

> **Not the same as `module_key`.** The `module_key` (`{moduleId}:{version}:{hash}`) identifies a specific *release* of a module and changes on every upgrade. A canonical id identifies a *resource* within a module and is stable across versions. They share the first segment (`moduleId`) and the same `:` separator but have disjoint shapes — `kind` is always a reserved keyword while `version` is a semver string.

#### Validation rules

Install fails with a clear error message when any of the following hold:

- The manifest's top-level `id` is missing or empty.
- Any trigger / action / function / command / workflow / widget / overlay has a missing or empty `id`.
- Any explicit `id` (top-level or resource) contains characters outside `[A-Za-z0-9._-]`.
- Two resources of the same kind would produce the same canonical id (per-kind duplicates). Resources of different kinds may share a resource segment, since the kind segment disambiguates them.

Cross-module collisions are not the author's responsibility — the namespace claim on `moduleId` is what prevents them.

#### Intra-manifest references

Several manifest fields reference other resources in the same manifest. Authors write these references using the resources' manifest-local `id`. Barkloader resolves each reference to canonical form before persisting.

| Reference | Targets | Persisted form (example) |
|-----------|---------|---------------------------|
| `actions[].function: "play_alert"` (when `actions[].type` is `"function"`) | a function in the same manifest | `twitch_platform:function:play_alert` |
| `workflows[].trigger: "channel_subscribe"` | a trigger in the same manifest | `twitch_platform:trigger:channel_subscribe` |
| `workflows[].steps[].action: "play_alert"` | an action in the same manifest | `twitch_platform:action:play_alert` |
| `commands[].workflow: "on_subscription"` | a workflow in the same manifest | `twitch_platform:workflow:on_subscription` |
| `widgets[].acceptedEvents: ["channel_subscribe"]` | trigger ids in the same manifest | `["twitch_platform:trigger:channel_subscribe"]` |

If a reference can't be resolved (no resource of the expected kind has the referenced id), install fails.

References to **other modules'** resources may use the full canonical id directly — `"some_other_module:trigger:foo"` is accepted as-is and stored without lookup.

#### What ends up in the database

After install, every persisted reference — entries in `module_resources`, edges in `resource_references`, the workflow trigger config, action `call` strings, command type values, widget `acceptedEvents` arrays — carries the canonical id. The author-supplied `id` and `name` are preserved on the source rows for display, but every downstream lookup, join, and event subscription uses the canonical id. This is what makes the `CheckModuleResourceUsage` join trivial: ledger rows and inbound reference rows both key on the same canonical id string.

### Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **yes** | Stable module identifier. Used as the `moduleId` segment in every canonical id, as the storage namespace (`modules/{id}/…`), and as `CreateModule.name` until the DB API adds a dedicated `module_id`. **Cannot be auto-generated** — install fails if missing or empty. |
| `name` | string | yes | Human-readable name. |
| `version` | string | no | Semver (recommended). Used for archive naming (`archives/{id}/{version}.zip`) and as the `version` segment of `module_key`. Defaults to empty. |
| `description` | string | no | Short description. |
| `triggers` | array | no | Event sources; see below. |
| `actions` | array | no | Module-contributed actions — implementations of the workflow engine's `action` step type. Each carries a `type` matching a workflow action handler (`function` is the only one today) and the handler-specific config (e.g. `function` for the canonical function id). See [Module actions vs. action handlers](#module-actions-vs-action-handlers). |
| `functions` | array | no | Callable assets (`runtime`, `path` relative to ZIP root). |
| `commands` | array | no | Chat/bot commands (`pattern`, `type`: `prefix` \| `exact` \| `regex`, optional `workflow`, `requiredRole`). |
| `workflows` | array | no | Bundled workflows (`trigger` reference + `steps`). |
| `widgets` | array | no | Scene widgets (`entry`, optional `assets` directory, `settingsSchema`, `acceptedEvents`). |
| `overlays` | array | no | Overlay browser sources (`entry`). |
| `resources` | array | no | Runtime-instance kind declarations — the K8s CRD analog. Each entry says "this module is the controller for instances of kind `X`". See [Resource entry](#resource-entry-resources) and [Runtime resource instances](#runtime-resource-instances). |
| `settings` | array | no | Module-level configuration values (API keys, tokens, etc.) registered into the `module_settings` table at install time and exposed to sandboxed functions as `ctx.module.settings`. Distinct from a widget's `settingsSchema` — see [Module-level settings](#module-level-settings-settings). |
| `backgroundTasks` (alias: `background_tasks`) | array | no | Cron-scheduled functions barkloader fires for the lifetime of the module. See [Background tasks](#background-tasks-backgroundtasks). |

### Trigger entry (`triggers[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local trigger id. Combined with the module id and the `trigger` kind to form the canonical id (`{moduleId}:trigger:{id}`). Must match `[A-Za-z0-9._-]+`. |
| `name` | string | yes | Display name. Used only for presentation; never used as an identifier. |
| `description` | string | no | Human-readable summary. |
| `type` | string | yes | Trigger transport: `eventbus`, `webhook`, `command`, `schedule`. Determines how install wires the trigger up. |
| `event` | string | yes (for `eventbus`) | The NATS subject this trigger fires on (e.g. `channel.subscribe`). Stored on the trigger row as `event`. The trigger's `id` is the manifest-local identifier and is **not** the same as `event` — earlier versions conflated them. |
| `category` | string | no | UX / registry grouping (e.g. `platform.twitch`). Sent to RegisterTrigger as `category`; falls back to `type` when omitted. |
| `schema` | array | no | `ConfigField[]` describing user-editable inputs the UI surfaces when wiring this trigger to a workflow; see [Schema field reference](#schema-field-reference). |
| `allowVariants` | boolean | no | When true, the UI lets a user create multiple bound instances of this trigger (each with its own `schema` values). Used for trigger classes like cheer / subscribe that fan out per tier or threshold. |

On install, when `databaseProxyUrl` is set in `.woofx3.json`, each trigger is registered via Twirp `module.ModuleService/RegisterTrigger`. The trigger row's `event` column carries the NATS subject from the manifest's `event` field; `manifest_id` carries the manifest's `id`; `category` falls back to the `type` field when not set; `config_schema` is the JSON-encoded `schema`.

### Schema field reference

Every entry in a trigger or action `schema` array is a `ConfigField`. The canonical type lives in `shared/clients/typescript/api/ui-schema.ts`. Recognized properties:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Stable field id; used as the key when the UI emits values. |
| `label` | string | yes | Display name shown above the input. |
| `type` | string | yes | One of `number`, `range`, `text`, `select`, `media`, `toggle`, `color`, `asset`, `resource_ref`. The last three are picker types — see field-type reference below. |
| `required` | boolean | no | Marks the field as mandatory in the form. |
| `placeholder` | string | no | Placeholder shown inside empty inputs. |
| `unit` | string | no | Suffix shown next to numeric inputs (e.g. `bits`). |
| `options` | array | no | Static `{ value, label }` choices for `select`. |
| `defaultValue` | any | no | Initial value used when no value is set. |
| `min`, `max` | number | no | Bounds for `number` / `range`. |
| `eventPath` | string | no | Dot path into the trigger event payload that this field maps to. |
| `operator` | string | no | Comparison operator emitted with this field's value (e.g. `gte`, `eq`). |
| `description` | string | no | Short prose rendered as muted helper text directly below the input. Always visible. |
| `hint` | string | no | Longer prose rendered inside the field's info-icon popover. |
| `dataSchema` | string | no | JSON-encoded example payload, rendered with syntax highlighting in the info-icon popover. Documents the underlying event/data shape so end users know what to type into path-style inputs. |

The info icon next to a field's label appears if and only if `hint` or `dataSchema` is present. `description` renders independently below the input.

#### Picker field types

These three `type` values render dedicated pickers in the UI rather than freeform inputs. The engine treats their values opaquely (canonical id strings) and forwards them to the function at runtime.

| `type` | Extra fields | Stored value | Picker source |
|--------|-------------|---------------|----------------|
| `color` | — | CSS color string (`"#7ad7ff"`). | Native browser color picker. |
| `asset` | `kinds?: string[]` | Asset canonical id (`"twitch_platform:asset:bell.mp3"`). | Scoped to **this module's** `assets[]`, optionally filtered by `kinds`. |
| `resource_ref` | `kind: string` (required) | Instance canonical id (`"counter:counter:death_count"`). Stored verbatim; the function receives it via `ctx.event.parameters.<id>`. | Cross-module: every installed module's instances of the given `kind`. Backed by `ListResourceInstancesByKind` and refreshed live via the `module.resource.instance.{created,deleted}` webhook events. |

`resource_ref` is the discriminator that lets actions and widgets reference runtime instances (counters, future timers/polls/leaderboards, etc.) without the engine learning what each kind means. See [Runtime resource instances](#runtime-resource-instances).

> **Asset URLs must not be baked into saved workflows.** A repository
> key (`asset.repositoryKey` on the `Asset` row, see
> `db/proto/v1/module_asset.proto`) only resolves to a servable URL on
> the deployment that installed the module — hardcoding a resolved
> `http://…` string breaks the moment the workflow runs on a different
> install, or the deployer moves assets to a different host/CDN.
> Instead, save the field's value as a path relative to the engine's
> asset base URL and let the engine substitute it at execution time via
> `${woofx3_asset_url}` (e.g. `${woofx3_asset_url}/modules/<moduleKey>/assets/<path>`).
> See [Expression resolution → `${woofx3_asset_url}`](../workflow/expressions.md#woofx3_asset_url-referencing-module-uploaded-assets)
> for how that source is resolved and how to override it (a future UI
> settings page will write the `assets.baseUrl` engine setting; today it
> falls back to barkloader's own `/assets` route).



#### Dynamic-source select fields (`source.kind`)

Independent of the `type` value, **any field can carry a `source` property to load its options dynamically from a live data source**. This is how the Twitch channel-point trigger's "Reward" dropdown gets populated from the broadcaster's actual rewards instead of asking the user to paste a UUID. The form renderer short-circuits the type lookup whenever `source.kind` is recognized, so the field's `type` becomes documentation rather than a renderer selector.

Two source kinds are supported today:

| `source.kind` | What it does | Where it dispatches |
|----------------|---------------|----------------------|
| `"internal"` | Generic NATS request/reply against any subject. The engine wraps the descriptor's `payload` in a CloudEvent envelope, fires `nats.request(<event>, ...)`, unwraps the worker's reply (CloudEvent envelope or bare JSON), and forwards through `engine.response.received` to land in the UI's `transientEvents`. The default UI transform expects a `[{value, label}, ...]` shape; workers may include extra fields. | Worker subscribed to `descriptor.request.event` (e.g. `twitchapi`). |
| `"commands"` | UI-only specialisation that lists registered chat commands. Renderer resolves locally without a NATS round-trip. | Convex `commands` table. |

`internal` descriptor shape (`shared/clients/typescript/api/api.ts` `FieldOptionsDescriptor`):

```jsonc
{
  "id": "rewardId",
  "label": "Reward",
  "type": "select",
  "source": {
    "kind": "internal",
    "request": {
      "event": "twitchapi",                                  // NATS subject
      "payload": { "command": "listChannelPointRewards" }    // request body, opaque to the engine
    },
    "timeoutMs": 10000                                       // optional, defaults to 10s
  },
  "required": true,
  "eventPath": "rewardId",                                   // for trigger schemas — runtime filter binding
  "operator": "eq"
}
```

The worker's reply data is whatever it returns — strings or `{value, label, ...}` objects. The default UI transform (`use-field-options.ts:defaultTransform`) coerces strings to `{value: s, label: s}` and passes through `{value, label}` objects verbatim; consumers that need richer shapes can pass a custom `transform`. Implementing a new `internal` source is just adding a new command branch to a worker that already subscribes to a NATS subject — no engine, manifest schema, or UI code changes.

A worked example lives at `barkloader/modules/twitch_platform/manifest.json` (the `redeem.channelpoints.twitch` trigger) and `twitch/src/lib/twitch.ts` `listChannelPointRewards()`.

#### Helping users map fields to event payloads

The Twitch cheer trigger is the canonical worked example. The module author already knows that "Minimum bits" maps to the `bits` property of the `channel.cheer` event payload (encoded via `eventPath`). The end user needs the same knowledge to author conditions or to pick which payload field to read elsewhere. The new manifest fields surface that knowledge directly in the form:

```json
{
  "id": "minBits",
  "label": "Minimum bits",
  "type": "number",
  "eventPath": "bits",
  "operator": "gte",
  "description": "Only fire when the cheer meets or exceeds this amount.",
  "hint": "Compares against the 'bits' field on the Twitch channel.cheer event payload.",
  "dataSchema": "{\n  \"bits\": 1000,\n  \"isAnonymous\": false,\n  \"userName\": \"viewer42\",\n  \"userId\": \"123456\",\n  \"message\": \"Cheer1000 woof\"\n}"
}
```

In the UI, the user sees:

- Below the input: the `description` text as muted helper text.
- Next to the label: an info icon. Hovering it shows a popover containing the `hint` paragraph followed by the `dataSchema` JSON rendered with syntax highlighting. Clicking the icon pins the popover open so the JSON can be read or copied.

### Action entry (`actions[]`)

> **Module actions vs. action handlers.** A manifest "action" is **not** a workflow primitive — it's a *configured implementation* of the workflow engine's built-in `action` step type. Each action's `type` field names a workflow action handler (`function` is the only one today; more may ship), and at runtime the engine dispatches via that handler. Modules cannot add new step types or new action handlers; they only declare configured invocations of existing handlers. The shape mirrors how engine `TaskDefinition` puts handler-specific config (`wait`, `workflow`, etc.) at the top level next to `type`.
>
> See also: [terminology — `action` is overloaded](#module-actions-vs-action-handlers).

Common fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local action id. Forms the canonical id `{moduleId}:action:{id}`. Must match `[A-Za-z0-9._-]+`. |
| `name` | string | yes | Display name. Presentation only. |
| `description` | string | no | Human-readable summary. |
| `type` | string | yes | Workflow action handler name. Must match an existing engine handler (`function` is the only one today). Determines which other top-level fields are required. |
| `schema` | array | no | `ConfigField[]` describing user-editable inputs the UI surfaces when wiring this action into a workflow step; see [Schema field reference](#schema-field-reference). Forwarded to the DB as `params_schema`. |

Type-specific fields:

| When `type` is | Required field | Description |
|----------------|----------------|-------------|
| `function`     | `function`     | Manifest-local function id (or full canonical id for cross-module references). Resolved to the canonical function id at install and stored on the action row's `call` column. |

### Function entry (`functions[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local function id. Forms the canonical id `{moduleId}:function:{id}`. Workflow steps and `function`-typed actions reference functions exclusively by canonical id. Must match `[A-Za-z0-9._-]+`. |
| `name` | string | yes | Display name. Presentation only. |
| `runtime` | string | yes | e.g. `lua`, `js`. |
| `path` | string | yes | Path inside the ZIP to the source file. |
| `entryPoint` | string | no | Entry symbol if not the default. |

Uploaded bytes are stored at **`modules/{moduleId}/functions/{path}`** (path as in the manifest, normalized).

#### Module actions vs. action handlers

The word `action` shows up at three layers in the system. Authors and reviewers should know which is which:

| Layer | What it is | Example | Extensible by modules? |
|-------|-----------|---------|------------------------|
| **Engine step type** | A workflow step's `type` field. The `action` value selects the action-dispatch step path. Other step types are `wait`, `condition`, `log`, `workflow`. | `step.type = "action"` | No — engine flow primitive |
| **Action handler** | When a step's type is `action`, the handler that runs the work. | `function`, `print` | No — engine-built-in |
| **Module action** | What a manifest contributes — a parameterized invocation of an action handler, exposed in the UI as a building block. | `twitch_platform:action:play_alert` (type `function`, function `twitch_platform:function:play_alert`) | **Yes** — that's what this section is about |

A module's `actions[]` list is not "things modules add to the engine." It's "configured ways to use the engine's existing handlers, surfaced in the UI as building blocks for workflows."

### Command entry (`commands[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local command id. Forms the canonical id `{moduleId}:command:{id}`. Must match `[A-Za-z0-9._-]+`. |
| `name` | string | yes | Display name. Presentation only. |
| `pattern` | string | yes | The matching pattern (e.g. `!clip`). |
| `type` | string | yes | One of `prefix`, `exact`, `regex`. |
| `workflow` | string | no | Reference to a workflow in the same manifest (use the workflow's `id`; resolved to its canonical id at install). |
| `requiredRole` | string | no | Minimum role required to invoke (e.g. `public`, `subscriber`, `mod`). |

#### `ctx.event` for a chat-command-triggered function

A chat command reaches a module function through one of two paths — a workflow
subscribed to the `chat.command.*` CloudEvent (via the built-in "Chat Command"
trigger), or a direct `woofwoofwoof` → barkloader invoke for a command configured
with `type: "function"` in the (DB-backed, not manifest-declared) `commands` admin
UI. Both converge on the same shape, so a function doesn't need to know which path
invoked it:

```js
ctx.event.data = {
  command: "sr",
  rawMessage: "!sr bad angel",
  text: "bad angel",                    // rawMessage with the matched command token stripped
  args: ["bad", "angel"],                // raw whitespace-split tokens
  variables: { songTitle: "bad angel" }, // named argument_pattern captures — {} if none declared
  chatter: "wolfymaster",
  platform: "twitch",
  channelId: undefined                   // reserved, never populated today
}
ctx.event.parameters = { /* deviceId, etc. */ } // workflow-step-authored config only — never
                                                 // command-derived data, to avoid field collisions
```

`variables` comes from a command's `argument_pattern` (a UI/admin-configured field
on the DB `commands` row — e.g. `"{songTitle}"` — not currently declarable from the
manifest's `commands[]` entry above). Dotted variable names (`"{user.name}"`) build
nested objects. See `barkloader/modules/spotify_sr/functions/song_request.js` for a
worked example.

To reply to the chat command, `return ctx.response(success, message)` instead of
calling `ctx.chat.sendMessage(...)` directly — see [`ctx.response`](./sandbox.md#ctxresponse).

### Workflow entry (`workflows[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local workflow id. Forms the canonical id `{moduleId}:workflow:{id}`. Must match `[A-Za-z0-9._-]+`. |
| `name` | string | yes | Display name. Presentation only. |
| `trigger` | string | yes | Reference to a trigger. Use a manifest-local id to point at a trigger declared in this same manifest, or a full canonical id (`other_module:trigger:foo`) to reference a trigger from another module. Resolved to canonical form at install. |
| `steps[]` | array | yes | Ordered steps. Each step's `action` field references an action by manifest-local id (or full canonical id for cross-module references); resolved at install. |

### Widget entry (`widgets[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local widget id. Forms the canonical id `{moduleId}:widget:{id}`. Must match `[A-Za-z0-9._-]+`. |
| `name` | string | yes | Display name. Presentation only. |
| `description` | string | no | |
| `entry` | string | no | HTML entry path in the ZIP. |
| `assets` | string | no | Directory prefix in the ZIP for static assets (all files under this prefix are uploaded). |
| `settingsSchema` | object | no | JSON Schema–style settings for the UI. Per-instance values flow back to the widget at render time as `widgetHost.settings`. |
| `acceptedEvents` | string[] | no | Trigger references this widget cares about. Each entry is a manifest-local trigger id (resolved to canonical form at install) or a full canonical id for cross-module triggers. At runtime, the scene overlay only fires the widget's `widgetHost.onEvent` handler for events whose canonical trigger id matches an entry in this list — widgets without an `acceptedEvents` declaration receive no events. |

Files are stored under **`modules/{moduleId}/widgets/{widgetId}/…`**.

#### Widget runtime — the `widgetHost` contract

Streamware loads widget bundles into sandboxed iframes (`streamware/ui/src/components/WidgetFrame.tsx`) and a shim script injected by the frame assembler installs a `widgetHost` object onto the iframe's `window` as part of the P1 (`woofx3.widget`) handshake with the parent scene manager. Widgets read `window.widgetHost` directly; the postMessage plumbing underneath is invisible to widget code. See [Widget protocol (P1)](../woofwoofwoof/streamware/widget-protocol.md) for the wire-level handshake.

```typescript
interface WidgetHost {
  readonly moduleId: string;
  readonly instanceId: string;            // stable per-placement id
  readonly settings: Readonly<Record<string, unknown>>; // resolved from settingsSchema
  readonly storage: WidgetHostStorage;    // get / subscribe over module storage

  onEvent(handler: (event: WidgetEvent) => void): () => void;
  reportStatus(key: string, value: unknown): void;
  reportComplete(reason?: string): void;  // sugar for reportStatus("complete", { reason })
}

interface WidgetEvent {
  type: string;       // canonical trigger id, e.g. "twitch_platform:trigger:follow.user.twitch"
  source: string;     // CloudEvent source
  time: string;       // RFC3339
  data: unknown;      // event payload
}
```

`reportStatus` and `reportComplete` send a P1 `status.report` message to the scene manager, which forwards it over the unified `widget.event` NATS channel. The streamware dispatcher persists generic events to the `widget_status` table and routes `alert.lifecycle` reports to the [event queue](../streamware/alert-queue.md) — see [Widget event channel](../services/widget-events.md).

`onEvent` is the downward channel: the widget sends a P1 `events.subscribe` message, and the scene manager matches engine-side trigger events (delivered over the P2 `event` frame) against the widget's `acceptedEvents` declaration before relaying a matching one as `event.deliver`. A widget that lists `twitch_platform:trigger:follow.user.twitch` in its manifest will see every follower event the engine processes. Widgets without `acceptedEvents` receive nothing — that's the right default for static display-only widgets.

`widgetHost.storage` reads the latest module-storage value for `(moduleId, key)` from the local cache populated by `module.storage.changed` events, delivered over the P2 `storage` frame.

The contract definition lives at `shared/clients/typescript/module-sdk/src/widget-host.ts`; the shim that implements it inside the iframe is `shared/clients/typescript/module-sdk/src/widget-host-shim.ts`.

### Overlay entry (`overlays[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local overlay id. Forms the canonical id `{moduleId}:overlay:{id}`. Must match `[A-Za-z0-9._-]+`. |
| `name` | string | yes | Display name. Presentation only. |
| `description` | string | no | |
| `entry` | string | yes | HTML entry path in the ZIP. |

Stored under **`modules/{moduleId}/overlays/{overlayId}/…`**.

### Resource entry (`resources[]`)

A `resources[]` entry declares that this module is the **controller** for runtime instances of some named *kind* — the [Kubernetes CRD](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/) analog. The engine learns identity (the kind name + which module owns it) but never learns what the kind *means* — all semantics (value storage, mutation operations, validation) live in the owning module's functions and actions.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | string | yes | Open-ended kind identifier (e.g. `counter`, `timer`, `poll`). Must match `[A-Za-z0-9._-]+`. Forms the middle segment of instance canonical ids (`{moduleId}:{kind}:{instanceId}`). Unique within the manifest. |
| `name` | string | yes | Display name (singular). Shown in pickers and management UIs. |
| `description` | string | no | Short description. |
| `icon` | string | no | Optional asset canonical id for picker affordances. |
| `valueSchema` | object | no | Opaque JSON document — the engine doesn't validate values. Modules may publish a JSON-schema-like document here to drive a create-form in the UI. |

Declaring a kind is necessary but not sufficient — the module must also expose **actions or commands** that actually create / mutate / delete instances. By convention these:

- A `createX` action whose function calls `ctx.resources.create(kind, instanceId, displayName)`.
- A `deleteX` action with a `target: resource_ref(kind=...)` parameter that calls `ctx.resources.delete(target)`.
- One or more mutation actions (e.g. `increment`, `decrement`) whose `target` is a `resource_ref(kind=...)`.

See `barkloader/modules/counter/manifest.json` for the canonical example.

### Module-level settings (`settings[]`)

A `settings[]` entry declares an engine-typed, module-scoped configuration value —
the mechanism a module uses for things like API credentials that its sandboxed
functions need at runtime (a Spotify client secret, a webhook URL, a poll interval).
This is a **different feature from a widget's `settingsSchema`** (see
[Widget entry](#widget-entry-widgets)): `settingsSchema` is an opaque, per-instance
JSON blob scoped to one widget placement and surfaced to browser-side widget code as
`widgetHost.settings`; `settings[]` is a flat, typed, per-module namespace surfaced to
**sandboxed function code** as `ctx.module.settings`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local setting key, e.g. `clientId`. Combined with the module id to key the `module_settings` row (`module_id` + `key`, unique). This is the key a function reads via `ctx.module.settings.<id>`. |
| `name` | string | yes | Display label for a settings UI. |
| `description` | string | no | Defaults to `""`. |
| `type` | string | yes | One of `"string"`, `"number"`, `"boolean"`. Not enum-validated by the manifest parser — any string is accepted, but only these three are coerced meaningfully at read time (see below). |
| `required` | boolean | no | Defaults to `false`. Descriptive only today — **not enforced** anywhere in the install or read path; a module function reading an unset required setting just sees the type's zero value. |
| `default` | string | no | Stored as a string regardless of `type`. If omitted, the effective default is `"0"` for `type: "number"`, `"false"` for `type: "boolean"`, and `""` otherwise. |

Example — `barkloader/modules/spotify_sr/manifest.json`:

```json
"settings": [
  {
    "id": "clientId",
    "name": "Spotify Client ID",
    "description": "Your Spotify application client ID from the Spotify Developer Dashboard.",
    "type": "string",
    "required": true
  },
  {
    "id": "clientSecret",
    "name": "Spotify Client Secret",
    "description": "Your Spotify application client secret.",
    "type": "string",
    "required": true
  },
  {
    "id": "refreshToken",
    "name": "Spotify Refresh Token",
    "description": "OAuth refresh token for the streamer's Spotify account.",
    "type": "string",
    "required": true
  }
]
```

#### Install-time registration

On install, barkloader registers every declared setting into the `module_settings`
table via the db-proxy `ModuleSettingService/RegisterModuleSettings` RPC, keyed by
the manifest-local module id (not the composite `{id}:{version}:{hash}` key used for
actions/widgets/background tasks). Registration is an upsert-if-absent
(`ON CONFLICT DO NOTHING` server-side): re-installing or upgrading a module **never
overwrites** a value the user already configured — only a brand-new key gets its
manifest `default` (or type-based zero value) written.

#### Reading settings at runtime — `ctx.module`

Both the QuickJS and Lua sandbox runtimes expose the invoking function's module
identity and resolved settings as `ctx.module`:

```js
ctx.module = {
  id: string,        // manifest-local module id
  name: string,       // manifest display name
  version: string,    // semver string from the manifest
  settings: {          // one key per module_settings row for this module
    [key: string]: string | number | boolean
  }
}
```

Values are stored as `TEXT` in the database and coerced to a native `string` /
`number` / `boolean` at read time based on the setting's declared `type`
(`HttpSettingsClient::coerce_value` in barkloader). Example, from
`barkloader/modules/spotify_sr/functions/poll_current_track.js`:

```js
var clientId = ctx.module.settings.clientId;
var clientSecret = ctx.module.settings.clientSecret;
var refreshToken = ctx.module.settings.refreshToken;

if (!clientId || !clientSecret || !refreshToken) {
  return { error: "missing config" };
}
```

This replaced an earlier pattern of reading credentials from process environment
variables via `ctx.env`; new modules needing per-install configuration should use
`ctx.module.settings`, not `ctx.env`.

See [Sandbox runtime → `ctx.module`](./sandbox.md#ctxmodule) for the full sandbox-side
contract, and [Module settings: the UI contract](../services/module-settings-ui.md)
for how a streamer's UI reads and writes these values after install.

> **No secrecy guarantees.** `module_settings.value` is a plain `TEXT` column with no
> encryption, hashing, or field-level redaction — there is no `secret`/`sensitive`
> flag anywhere in the manifest schema or the DB row. The `GET
> /modules/{moduleId}/settings` API route returns every setting's value verbatim,
> including things like `clientSecret`. Do not expose that route to untrusted
> clients without an access-control layer in front of it.

> **`widget_settings` exists in the schema but is not wired up.** Migration 0020 also
> created a `widget_settings` table and a matching Go model/repository, intended as a
> future per-widget-instance counterpart to `settings[]`. As of this writing nothing
> in the install flow, the sandbox, or the API reads or writes it — it's inert
> scaffolding, not a working feature. Don't build against it yet.

### Background tasks (`backgroundTasks[]`)

A `backgroundTasks[]` entry (manifest key `backgroundTasks`, with `background_tasks`
accepted as an alias) declares a sandboxed function that barkloader's internal
scheduler fires on a recurring cron schedule for the lifetime of the module — the
mechanism modules use for polling an external API on an interval (spotify_sr's
now-playing poll is the canonical example).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local task id, e.g. `poll_now_playing`. Persisted as `manifest_id` on the `background_tasks` row and used as the scheduler's in-process key together with the module id. |
| `function` | string | yes | Manifest-local function id to invoke on each fire. Resolved to the canonical function id (`{moduleId}:function:{function}`) at fire time. |
| `schedule` | string | yes | A 6-field, seconds-first cron expression (parsed with the `cron` crate), e.g. `"*/30 * * * * *"` for every 30 seconds. An invalid expression is logged and that task is skipped — it does not fail the install. |
| `description` | string | no | Defaults to `""`. |

Example — `barkloader/modules/spotify_sr/manifest.json`:

```json
"backgroundTasks": [
  {
    "id": "poll_now_playing",
    "function": "poll_current_track",
    "schedule": "*/30 * * * * *",
    "description": "Polls Spotify every 30 seconds to update the currently playing track."
  }
]
```

#### Persistence and lifecycle

Background tasks are persisted as rows in a `background_tasks` table (one row per
task, keyed by `created_by_type`/`created_by_ref`/`manifest_id`, upserted on
reinstall) rather than re-parsed from the stored manifest JSON at every boot. On
process start, barkloader hydrates the in-process scheduler by listing all persisted
tasks from db-proxy and registering each with the scheduler — no manifest parsing is
involved at boot.

Registration into the in-process scheduler happens on install, on the module's
`/functions/{name}/register` route, and on upgrade/reload. Unregistration happens on
module delete, keyed by the task's **manifest-local module id** (not the module's
database-row UUID) — the scheduler's in-memory map is keyed the same way the sandbox
registry is, so using the wrong identifier here silently no-ops the unregister and
leaves the task firing after deletion.

#### Scheduler mechanics

Each registered task runs as an independent loop: compute the next fire time from the
cron schedule, sleep until then, invoke the target function via the same
`Sandbox::invoke` entrypoint used for every other function call in barkloader (chat
commands, workflow steps, the field-options NATS responder), then repeat. A fired
task always invokes with an empty event and empty parameters — background tasks
receive no per-invocation context beyond what `ctx.module`/`ctx.resources`/etc.
already expose; if a task needs input, it has to fetch it itself (e.g. from module
storage or an external API). Each fire logs its scheduled time, its start, and its
outcome (success with elapsed ms, or an error) so a stuck or failing poller is
visible in the barkloader logs without instrumenting the module itself.

## Runtime resource instances

Resource instances are runtime-created rows that record one specific instance of a declared kind — for example, a `death_count` counter or a `goal_progress` counter, both of kind `counter` declared by the counter module. Instances live in the `module_resource_instances` table; the owning module owns the underlying value (typically in BadgerDB).

### Lifecycle

| Step | API | Owner |
|------|-----|--------|
| Module declares it provides a kind | `manifest.resources[].kind` | Module manifest |
| User triggers instance creation (UI, chat command, etc.) | `ctx.resources.create(kind, instanceId, displayName)` | Module function |
| Engine persists the row + emits NATS event | `module.ModuleService/CreateResourceInstance` | DB proxy |
| Other parts of the system reference the instance | `resource_ref(kind=...)` ConfigField → canonical id | UI / workflow editor |
| Owning function performs work using the canonical id | `ctx.event.parameters.target` | Module function |
| User triggers instance deletion | `ctx.resources.delete(canonicalId)` | Module function |
| Engine cascades on module uninstall | FK `module_resource_instances.module_id → modules.id ON DELETE CASCADE` | DB |

The owning module's storage is the source of truth for instance values. The engine's row is metadata only (id, kind, instanceId, displayName).

### `ctx.resources` surface

Available in both QuickJS and Lua function runtimes:

| Call | Returns | Notes |
|------|---------|-------|
| `ctx.resources.create(kind, instanceId, displayName)` | `{ canonicalId, moduleName, kind, instanceId, displayName }` | The owning module is implicit (taken from the function's canonical path). Modules can only create instances of kinds they declared in `resources[]`. |
| `ctx.resources.delete(canonicalId)` | `void` | Idempotent from the caller's perspective when the row exists; surfaces an error if it doesn't. |
| `ctx.resources.list(kind)` | `Array<{ canonicalId, moduleName, kind, instanceId, displayName }>` | Returns every instance of the kind across every installed module. |

**Storage-key convention:** by convention, modules key their per-instance state at `state:<canonicalId>` (e.g. `state:counter:counter:death_count`). This keeps the module storage namespace flat while allowing many kinds to coexist. The convention isn't engine-enforced — modules may key however they like — but matching it lets widgets that subscribe to `module.storage.changed` filter by canonical id without reverse-mapping.

### NATS subjects

Lifecycle events fire on the db-proxy outbox using the standard `db.{entityType}.{operation}.{appId}` shape:

| Subject (wildcard) | Fired when | CloudEvent `type` |
|---------------------|------------|--------------------|
| `db.module.resource.instance.created.*` | Module function calls `ctx.resources.create()` | `module.resource.instance.created` |
| `db.module.resource.instance.deleted.*` | Module function calls `ctx.resources.delete()`, or FK cascade from module uninstall | `module.resource.instance.deleted` |

The api/ service forwards both to the registered Convex webhook as `ModuleResourceInstanceCreatedEvent` / `ModuleResourceInstanceDeletedEvent` (see `shared/clients/typescript/api/webhooks.ts`).

### Uninstall behavior

`run_delete_resolved` calls `ListResourceInstancesByModule` after the existing `CheckModuleResourceUsage` check. If the module owns any instances, uninstall is **refused** and the existing in-use error path surfaces them with `resource_type` set to `instance:<kind>` (so the UI can render an instance-specific affordance — "delete this counter first"). FK cascade is reserved for the case where a module is being removed by an out-of-band path that doesn't go through `run_delete_resolved`.

## Supported file types (upload)

| Extension | `ModuleFileKind` | Notes |
|-----------|------------------|--------|
| `.js` | Program (QuickJS) | Sandbox function source. |
| `.lua` | Program (Lua) | Sandbox function source. |
| `.json` | Manifest | Prefer `module.json` at ZIP root. |
| `.yaml`, `.yml` | Manifest | |
| *other* | Asset | Stored as-is (HTML, CSS, images, fonts, etc.); used for widgets/overlays and any referenced path. |

ZIP members are read as **raw bytes** (not UTF-8–only), so binary assets are supported.

## Writing Functions

Every program file must define a `main` function. This is the entry point called during invocation. The `args` value from the WebSocket invoke request is passed directly to `main`.

### JavaScript (QuickJS)

```javascript
function main(args) {
  return "Hello, " + args.name;
}
```

Type conversion between JSON and JavaScript is handled automatically. Return values are serialized back to JSON. Supported types: null, boolean, integer, float, string, array, object.

QuickJS is a lightweight, embeddable JavaScript engine. It runs in-process with no access to Node/Bun APIs, the filesystem, or the network.

### Lua 5.4

```lua
function main(args)
  return "Hello, " .. args.name
end
```

Lua runs with `StdLib::NONE` -- no standard library is loaded. There is no `io`, `os`, `require`, `dofile`, or any other I/O capability. Only the core language is available (tables, strings, math, coroutines).

JSON-to-Lua type conversion maps objects to tables, arrays to integer-indexed tables, and primitives directly.

### Echo Adapter (Debug)

Non-program files are not executed through the sandbox adapters. For debugging execution paths, the echo adapter may still be used where configured in the sandbox layer.

## Function Trust Model

Each function has an `is_trusted` flag set during module loading. This flag is available to runtime adapters for future use in permission gating (e.g., allowing trusted functions access to additional APIs).

## Upload processing pipeline

When a ZIP is uploaded to `POST /functions`:

```
Multipart upload → temp dir
    → extract ZIP
    → classify each file by extension (program / manifest / asset)
    → ModuleService.create_plan()
         → pick manifest file
         → parse ModuleManifest
    → ModuleService.execute_plan(archive_key, db_proxy_url?)
         → run_install():
              → upload each function path to modules/{id}/functions/…
              → upload widget entry + assets
              → upload overlay entries
              → if databaseProxyUrl (.woofx3.json): Twirp CreateModule + RegisterTrigger per trigger
              → action/command/workflow stubs (log only)
    → archive original ZIP to archives/{id}/{version}.zip
    → temp dir cleanup (SafeTempDir)
```

The HTTP **200** response is returned when the upload is accepted; install runs in a **background task**. If install fails, the error is logged (check server logs).

### SafeTempDir

Temp directories are wrapped in `SafeTempDir`, which cleans up on drop with safety guards:

- Path must be within the allowed parent directory
- Path must not be a dangerous system path (`/`, `/home`, `/usr`, `/var`, `/etc`, `C:\Windows`, etc.)
- Maximum 10,000 files per directory (prevents runaway cleanup)
- Iteration limits to prevent infinite loops

## Repository backends

Module files are stored via the `Repository` trait (filesystem or S3). See [API -- Storage](./api.md#storage-api).

### Repository layout (after install)

```
modules/
  {module-id}/
    functions/
      ...                    # paths from manifest function.path
    widgets/
      {widget-id}/...
    overlays/
      {overlay-id}/...
archives/
  {module-id}/
    {version}.zip
```

**Registration** (`POST /functions/{name}/register`) loads **`.lua` and `.js`** files found under `modules/{name}/` into the in-memory `ModuleRegistry` for WebSocket invocation. Other extensions in the tree (HTML, CSS, etc.) are ignored by the registry but remain in storage for browser sources / future loaders.

At **startup**, the same rule applies: only `*.lua` / `*.js` under each module prefix are loaded into the sandbox registry.

### File repository (default)

- Destination: `MODULES_DIR`
- Nested keys create nested directories automatically

### S3 repository

See deployment configuration for bucket and endpoint settings.

## Module registry

The `ModuleRegistry` (`lib_sandbox`) holds registered modules for **invocation**. See the previous sections for which files are loaded.

### Invocation

WebSocket invoke uses `module_id/function_id`-style paths (see [API](./api.md#websocket-invoke)); resolution uses the registry built from stored `.lua` / `.js` files.

### Registry API

| Method | Description |
|--------|-------------|
| `get_function(path)` | Resolve `module/function` path, return `Function` clone. Rejects disabled modules. |
| `register_module(name, module)` | Insert or replace a module in the registry. |
| `unregister_module(name)` | Remove a module from the registry. |
| `update_module(name, module)` | Replace an existing module. |
| `set_module_state(name, state)` | Toggle `Active`/`Disabled`. |
| `list_modules()` | Return metadata for all registered modules. |
| `has_module(name)` | Check if a module exists. |
