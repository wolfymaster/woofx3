# Module Format

A module is a ZIP archive whose root contains a **`manifest.json`** or **`manifest.yaml`** manifest. The canonical JSON field names and semantics match **`module-improvements-spec.md`** in the **woofx3-ui** repository. The archive also includes function sources, widget HTML/assets, overlay entry files, and any other paths referenced by the manifest.

## Structure (example)

```
my-module.zip
  |-- manifest.json
  |-- functions/
  |     +-- handler.lua
  +-- widgets/
        +-- alerts/
              +-- index.html
              +-- static/
                    +-- style.css
```

The manifest is **required**. If no manifest file is found (after extraction), processing fails.

**Manifest selection:** if multiple JSON/YAML files exist, barkloader ranks them `manifest.json`, `manifest.yaml`, `manifest.yml`, then the legacy `module.json`, `module.yaml`, `module.yml` (including under subpaths), and finally falls back to the first manifest-looking file.

## Manifest (canonical shape)

The manifest uses **camelCase** JSON keys. All top-level sections are optional **except** `id` and `name`, which must be present for a valid module record.

### Example `manifest.json`

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
      "schema": [{ "id": "tier", "label": "Tier", "type": "select" }],
      "emits": {
        "fields": [
          { "path": "userName", "type": "string", "description": "Who subscribed." },
          { "path": "tier", "type": "string", "example": "1000" },
          { "path": "isGift", "type": "boolean" }
        ]
      }
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
      "settingsSchema": [
        { "id": "theme", "label": "Theme", "type": "text", "defaultValue": "default" }
      ]
    }
  ]
}
```

> **`overlays[]` is not a manifest surface.** A module contributes the visual as
> a **widget**; the operator composes widgets into a **scene** and points a
> browser source at that scene's overlay token. A manifest that still declares
> `overlays[]` is rejected at install with a message naming the replacement.

### Canonical IDs and References

Every resource a module contributes — triggers, actions, functions, commands, workflows, widgets — gets a **canonical id** that the rest of the system uses to refer to it. Canonical ids are stable across module versions, unique system-wide, and structured so they encode the resource's provenance. Read this section before the per-section field tables below; the validation rules and reference syntax depend on it.

#### Format

```
{moduleId}:{kind}:{resourceId}
```

| Segment | Source | Notes |
|---------|--------|-------|
| `moduleId` | the manifest's top-level `id` field | **Required.** Namespace-claimed: planned to become globally unique across all modules ever published, like an npm package name (once a moduleId is taken, it stays taken). Install fails if missing or empty. |
| `kind` | reserved keyword identifying the resource type | One of `trigger`, `action`, `function`, `command`, `workflow`, `widget`, `overlay`, `asset`, `theme`. Not author-supplied. |
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
| `commands[].actions[].action: "play_alert"` | an action in the same manifest | `twitch_platform:action:play_alert` |
| `commands[].workflow: "on_subscription"` | a workflow in the same manifest | `twitch_platform:workflow:on_subscription` |

If a reference can't be resolved (no resource of the expected kind has the referenced id), install fails.

References to **other modules'** resources may use the full canonical id directly — `"some_other_module:trigger:foo"` is accepted as-is and stored without lookup.

#### What ends up in the database

After install, every persisted reference — entries in `module_resources`, edges in `resource_references`, the workflow trigger config, action `call` strings, command type values — carries the canonical id. The author-supplied `id` and `name` are preserved on the source rows for display, but every downstream lookup, join, and event subscription uses the canonical id. This is what makes the `CheckModuleResourceUsage` join trivial: ledger rows and inbound reference rows both key on the same canonical id string.

### Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **yes** | Stable module identifier. Used as the `moduleId` segment in every canonical id, as the storage namespace (`modules/{id}/…`), and as `CreateModule.name` until the DB API adds a dedicated `module_id`. **Cannot be auto-generated** — install fails if missing or empty. |
| `name` | string | yes | Human-readable name. |
| `version` | string | no | Semver (recommended). Used for archive naming (`archives/{id}/{version}.zip`) and as the `version` segment of `module_key`. Defaults to empty. |
| `description` | string | no | Short description. |
| `taxonomy` | array of string | no | Open, multi-valued UI classification for the module as a whole. **Legacy:** superseded by `category` (single string) on older manifests — see [Taxonomy](#taxonomy). |
| `category` | string | no | **Legacy.** UI catalog grouping for the module as a whole (e.g. `platform`, `automation`). Still accepted; folded into `taxonomy` at parse time when `taxonomy` is unset. New manifests should use `taxonomy` instead. |
| `triggers` | array | no | Event sources; see below. |
| `actions` | array | no | Module-contributed actions — implementations of the workflow engine's `action` step type. Each carries a `type` matching a workflow action handler (`function` is the only one today) and the handler-specific config (e.g. `function` for the canonical function id). See [Module actions vs. action handlers](#module-actions-vs-action-handlers). |
| `functions` | array | no | Callable assets (`runtime`, `path` relative to ZIP root). |
| `commands` | array | no | Chat/bot commands (`pattern`, `type`: `prefix` \| `exact` \| `regex`, optional `actions` or `workflow`, `requiredRole`). See [Command entry](#command-entry-commands). |
| `workflows` | array | no | Bundled workflows (`trigger` reference + `steps`). |
| `widgets` | array | no | Scene and alert widgets (`entry`, optional `assets` directory, `settingsSchema`, `surfaces`). |
| `resources` | array | no | Runtime-instance kind declarations — the K8s CRD analog. Each entry says "this module is the controller for instances of kind `X`". See [Resource entry](#resource-entry-resources) and [Runtime resource instances](#runtime-resource-instances). |
| `settings` | array | no | Module-level configuration values (API keys, tokens, etc.) registered into the `module_settings` table at install time and exposed to sandboxed functions as `ctx.module.settings`. Same `ConfigField[]` shape as every other declaration — see [Field declarations](#field-declarations) — but unlike a widget's `settingsSchema` the *values* are stored engine-side; see [Module-level settings](#module-level-settings-settings). |
| `backgroundTasks` (alias: `background_tasks`) | array | no | Cron-scheduled functions barkloader fires for the lifetime of the module. See [Background tasks](#background-tasks-backgroundtasks). |
| `deadlines` | array | no | One-shot, point-in-time invocations the module's own functions may schedule with `ctx.schedule.at`. See [Deadlines](#deadlines-deadlines). |
| `requires` | object | no | Other modules this one needs installed: module id to a semver range, e.g. `{ "timerpro": "^1.2.0" }`. See [Themes](#themes). |
| `themes` | array | no | Data-only appearance variants for widgets that declare a `theme` contract. See [Themes](#themes). |
| `permissions` | array of string | no | Privileged host functions this module's code may call, e.g. `["twitch.moderation"]`. See [Permissions](#permissions-permissions). |
| `oauth` | array of object | no | OAuth providers the module's code calls through `ctx.oauth`, with tokens the engine keeps. See [OAuth integrations](#oauth-integrations-oauth). |
| `local` | array of object | no | Things on the streamer's own network the module reaches (OBS, lights), and which of its settings hold the address. See [Local endpoints](#local-endpoints-local). |

### Trigger entry (`triggers[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local trigger id. Combined with the module id and the `trigger` kind to form the canonical id (`{moduleId}:trigger:{id}`). Must match `[A-Za-z0-9._-]+`. |
| `name` | string | yes | Display name. Used only for presentation; never used as an identifier. |
| `description` | string | no | Human-readable summary. |
| `type` | string | yes | Trigger transport: `eventbus`, `webhook`, `command`, `schedule`. Determines how install wires the trigger up. See [Webhook triggers](#webhook-triggers) for `webhook`. |
| `event` | string | yes (for `eventbus`) | The NATS subject this trigger fires on (e.g. `channel.subscribe`). Stored on the trigger row as `event`. The trigger's `id` is the manifest-local identifier and is **not** the same as `event` — earlier versions conflated them. Must not start with `webhook.`, which is reserved. An uploaded module also may not use a subject the engine treats as a command, because a webhook handler can publish its module's eventbus trigger events verbatim: `db.`, `engine.`, `slobs`, `twitchapi`, `message.send`, `ui.notify.`, `ui.alert.`, `widget.queue.`, `workflow.execute`, `workflow.replay`, `workflow.cancel` and `action.execute` (prefix match). Rejected on a `webhook` trigger. |
| `handler` | string | yes (for `webhook`) | Manifest-local id of the function that handles inbound HTTP requests for a `webhook` trigger. Rejected on every other type. |
| `taxonomy` | array of string | no | Open, multi-valued UI classification (e.g. `["platform.twitch.chat", "function.chat"]`). Sent to RegisterTrigger as `taxonomy`. See [Taxonomy](#taxonomy). **Legacy:** superseded by `category`. |
| `category` | string | no | **Legacy.** UX / registry grouping (e.g. `platform.twitch`). Still accepted; folded into a single-element `taxonomy` at parse time when `taxonomy` is unset, otherwise falls back to `type`. New manifests should use `taxonomy` instead. |
| `schema` | array | no | `ConfigField[]` describing user-editable inputs the UI surfaces when wiring this trigger to a workflow; see [Field declarations](#field-declarations). |
| `emits` | object | no | `DataShape` naming what `trigger.data` carries when this trigger fires; see [Emits and returns](#emits-and-returns). Forwarded to the DB as `emits`. |
| `sentence` | string | no | One-line English template the UI renders for a configured instance of this trigger, e.g. `"{reward} is redeemed"`; see [Trigger sentences](#trigger-sentences). Forwarded to the DB as `sentence`. |
| `allowVariants` | boolean | no | When true, the UI lets a user create multiple bound instances of this trigger (each with its own `schema` values). Used for trigger classes like cheer / subscribe that fan out per tier or threshold. |

On install, when `databaseProxyUrl` is set in `.woofx3.json`, each trigger is registered via Twirp `module.ModuleService/RegisterTrigger`. The trigger row's `event` column carries the NATS subject from the manifest's `event` field; `manifest_id` carries the manifest's `id`; `config_schema` is the JSON-encoded `schema`; `emits` is the JSON-encoded `emits` (`{}` when the manifest declares none); `sentence` is the manifest's `sentence` (`""` when it declares none). `taxonomy` is resolved in priority order: a non-empty `taxonomy` array as given, else a non-empty `category` wrapped in a single-element array, else the `type` field — see [Taxonomy](#taxonomy).

#### Webhook triggers

A `type: "webhook"` trigger gives the module a public URL, minted by the control plane,
and names the function that handles requests to it:

```json
{ "id": "orders", "name": "Store webhook", "type": "webhook", "handler": "handle_order" }
```

- **Nothing binds to it.** `event`, `schema`, `emits`, `sentence` and `allowVariants` are rejected on a
  webhook trigger, and no workflow or widget may reference it or any `webhook.*` event.
  Barkloader stores its `event` as the reserved `webhook.{moduleId}.{triggerId}`, which
  nothing publishes.
- **The handler runs in the request path.** `ctx.event.data` is the request,
  `{ method, headers, query, body, rawBody }`, and the function returns
  `{ status, headers?, body?, events? }`. See [Module SDK → Webhook handlers](./sdk.md#webhook-handlers).
- **The handler verifies the request itself**, with [`ctx.crypto`](./sandbox.md#ctxcrypto) and
  a key from module code or a [`secret` setting](#module-level-settings-settings).
- **The engine acts on the result.** It checks the result, then publishes each returned
  event before the provider gets its response. An event's `type` must be the `event` of an
  `eventbus` trigger this module declares; that trigger is what workflows bind to. A handler
  never publishes anything itself ([Engine integrity](../services/engine-integrity.md)).
- **Limits:** 5 s per request; response body at most 64 KiB, with only `content-type` and
  `x-*` headers, and a `content-type` that is not a page (HTML, XHTML, SVG or XML): the
  dashboard serves the answer from its own origin; at most 16 events, each `data` at most
  64 KiB. A result that breaks any rule is a 500 and publishes nothing.

### Taxonomy

Triggers, actions, workflows, and modules all support an open, multi-valued `taxonomy: string[]` field for UI classification. Each entry is a dotted hierarchical path — read left-to-right as most-general → most-specific (e.g. `platform.twitch.chat` reads as platform → twitch → chat) — mirroring the same dotted-path convention already used for CloudEvents subjects (`shared/common/golang/cloudevents/subjects.go`, e.g. `db.workflow.created.*`). Multiple array entries express **independent classification axes** on the same resource, rather than trying to encode everything into one path:

```json
{
  "taxonomy": ["platform.twitch.chat", "function.chat"]
}
```

```json
{
  "taxonomy": ["platform.govee", "function.lighting"]
}
```

The vocabulary is intentionally open — there is no fixed enum and the engine does not validate taxonomy terms against a known list. Module authors are free to introduce new terms as new platforms or functional groupings come along; the UI is responsible for interpreting and displaying whatever terms appear.

`taxonomy` replaces the older single-value `category` field, which is still accepted on manifests for backward compatibility: when a manifest sets `category` but not `taxonomy`, the engine folds it into a single-element `taxonomy` array at parse time. Everything downstream of the manifest (the DB row, the outbox events, the API) carries only `taxonomy` — `category` is not persisted.

### Field declarations

A trigger's `schema`, an action's `schema`, a widget's `settingsSchema` and a module's `settings` all mean the same thing — *render these inputs, collect these values* — so they are **the same shape**: a bare array of `ConfigField`. The canonical type lives in `shared/clients/typescript/api/ui-schema.ts`.

There is exactly one spelling for every property, and **no aliases**. Unknown properties are rejected at install, so a typo is reported where it can be fixed rather than silently producing a half-configured control — a field the renderer does not recognise is dropped, and a control that half-exists is harder to diagnose than one that never installed.

What legitimately differs per surface is where the *value* is stored — module settings persist engine-side in `module_settings` and are read by sandboxed functions as `ctx.module.settings`, while trigger, action and widget values live UI-side in workflow definitions and scene instances. That is a storage difference, not a reason to describe a field differently.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Stable field id; the key the collected value is stored under. Unique within one declaration. |
| `label` | string | yes | Display name shown above the input. |
| `type` | string | yes | One of the [field types](#field-types) below. |
| `required` | boolean | no | Marks the field as mandatory in the form. |
| `placeholder` | string | no | Placeholder shown inside empty inputs. |
| `unit` | string | no | Suffix shown next to numeric inputs (e.g. `bits`). |
| `options` | array | no | Static `{ value, label }` choices. Required for `select` unless a `source` supplies them. |
| `source` | object | no | Dynamic option source; see [dynamic-source select fields](#dynamic-source-select-fields-source-kind). |
| `defaultValue` | any | no | Initial value used when none is set. |
| `min`, `max` | number | no | Bounds for `number` / `range`. |
| `mediaType` | string | no | For `media` — `image`, `audio` or `video`. |
| `kinds` | string[] | no | For `asset` — filter the picker by `ManifestAsset.kind`. |
| `resourceKind` | string | no | Required for `resource_ref` — which resource kind the picker lists: `kind`, or `module:kind` to name the declaring module. See [Naming a kind](#naming-a-kind). |
| `surface` | string | no | Required for `layout` — the surface whose widgets the layout places (`alert`). |
| `itemFields` | array | no | Required for `list`, and only allowed there — the fields of one row. See [list fields](#list-fields). |
| `action` | object | no | Required for `button` — the request the button fires. See [module-level settings](#module-level-settings-settings). |
| `eventPath` | string | no | Trigger `schema` only. Dot path into the event payload this field maps to. |
| `operator` | string | no | Trigger `schema` only. Comparison emitted with this field's value (e.g. `gte`, `eq`). |
| `operators` | string[] | no | Trigger `schema` only, `number` fields only. Comparisons the user chooses between, e.g. `["gte", "eq"]` for "at least" or "exactly". At least two of `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, no repeats; `operator` is required alongside and names the default. |
| `description` | string | no | Short prose rendered as muted helper text below the input. Always visible. |
| `hint` | string | no | Longer prose rendered inside the field's info-icon popover. |
| `examplePayload` | string | no | JSON-encoded **example** of the event payload this field reads from, rendered with syntax highlighting in the info-icon popover. An illustration, not a declaration: nothing reads its keys. |
| `anyText` | string | no | Trigger `schema` only. The words a [trigger sentence](#trigger-sentences) shows in place of this field when it is set to "any". `""` drops that part of the sentence; whitespace alone is rejected. |
| `missingText` | string | no | Trigger `schema` only. The words a [trigger sentence](#trigger-sentences) shows in place of this field while it is required and has no value yet. Must be non-empty when present. |

The info icon next to a field's label appears if and only if `hint` or `examplePayload` is present. `description` renders independently below the input.

#### Field types

`number`, `range`, `text`, `select`, `media`, `toggle`, `color`, `asset`, `resource_ref`, `button`, `layout`, `list`, `theme`.

`theme` is never declared by a manifest; declaring one fails the install. The engine adds it, as the field `theme`, to the settings of a widget that declares a [theme contract](#themes). Its value is a theme canonical id (`{moduleId}:theme:{id}`), or absent for the widget's own look. The list is mirrored in `shared/clients/typescript/api/ui-schema.ts`, and a barkloader test fails when the two differ.

The set is closed — an unrecognised token fails the install rather than falling back to a text input, because a silent fallback is indistinguishable from a working field.

Note `text` and `toggle`, not `string` and `boolean`. These name **controls**. The `string` / `boolean` tokens belong to [`DataShape`](#emits-and-returns), which names **values**. The two vocabularies are deliberately different because the things they describe are different: a `toggle` renders a switch, a `boolean` is what comes back in a payload. Neither list is a superset of the other.

Five of them carry extra requirements, each checked at install:

| Type | Requires | Why |
|---|---|---|
| `select` | `options` or a `source` | A select with nothing to select is a dead control. |
| `resource_ref` | `resourceKind` | A picker that does not say what to pick lists nothing. |
| `button` | `action` | A button with nothing to fire does nothing. |
| `layout` | `surface` | A canvas that does not say which widgets it may hold can place nothing. |
| `list` | `itemFields` | A list that does not say what a row holds renders empty rows. |

#### List fields

A `list` collects any number of rows, each made of the fields in `itemFields`.
The stored value is an array of objects keyed by those fields' ids. The bundled
counter's goals are one:

```json
{ "id": "goals", "label": "Goals", "type": "list", "itemFields": [
  { "id": "value", "label": "Goal", "type": "number", "required": true },
  { "id": "name", "label": "Name", "type": "text" }
] }
```

which stores `[{ "value": 100, "name": "New emote" }, { "value": 250 }]`.

A row holds only controls that fit in one row and carry a plain value:
`number`, `text`, `select`, `toggle` and `color`. A list inside a list, a
picker that opens its own dialog, and a button are rejected. Row fields are
otherwise validated like any field list, so their ids must be unique within
the row. A module setting cannot be a `list`, because `settings` declares no
`itemFields`.

A row field may not carry an `internal` `source` or `action`: the api and the
UI resolve those on top-level fields only.

#### Picker field types

These three `type` values render dedicated pickers in the UI rather than freeform inputs. The engine treats their values opaquely (canonical id strings) and forwards them to the function at runtime.

| `type` | Extra fields | Stored value | Picker source |
|--------|-------------|---------------|----------------|
| `color` | — | CSS color string (`"#7ad7ff"`). | Native browser color picker. |
| `asset` | `kinds?: string[]` | Asset canonical id (`"twitch_platform:asset:bell.mp3"`). | Scoped to **this module's** `assets[]`, optionally filtered by `kinds`. |
| `resource_ref` | `kind: string` (required) | Instance canonical id (`"woofx3:counter:death_count"`). Stored verbatim; the function receives it via `ctx.event.parameters.<id>`. | Cross-module: every installed module's instances of the given `kind`. Backed by `ListResourceInstancesByKind` and refreshed live via the `module.resource.instance.{created,deleted}` webhook events. |

`resource_ref` is the discriminator that lets actions and widgets reference runtime instances (counters, timers, queues, future polls/leaderboards, etc.) without the engine learning what each kind means. See [Runtime resource instances](#runtime-resource-instances).

> **Asset URLs must not be baked into saved workflows at manifest-authoring
> time.** A repository key (`asset.repositoryKey` on the `Asset` row, see
> `db/proto/v1/module_asset.proto`) only resolves to a servable path on
> the deployment that installed the module — hardcoding a resolved
> `http://…` string breaks the moment the workflow runs on a different
> install, or the deployer moves assets to a different host/CDN.
>
> For a **settingsSchema `asset` field** (an operator-facing picker, filled
> in by an external editor UI when configuring a user-authored workflow),
> the stored value is the asset's canonical id
> (`"twitch_platform:asset:bell.mp3"`). Resolving that to a fetchable URL
> is the responsibility of whatever produces the saved workflow (today,
> external editor tooling, not this repo) — there is no
> workflow-engine expression-language mechanism for this specific case.
>
> For a **bundled workflow referencing one of its own module's declared
> `assets[]`** (e.g. `wolfy_profile`'s alert workflows), there is a
> mechanism: write `${asset:<id>}` in the step's `parameters`, matching an
> `assets[].id` in the same manifest. Barkloader bakes it into an absolute,
> deployment-portable form at install time — see
> [Expression resolution → Referencing module assets](../workflow/expressions.md#referencing-module-assets-from-a-bundled-workflow-asset-id)
> for the full mechanism (`overlay.publicUrl`, the `${woofx3_asset_url:...}`
> baked form, and why `${woofx3_asset_url}` alone — the earlier, retired
> mechanism — wasn't sufficient).



#### Dynamic-source select fields (`source.kind`)

Independent of the `type` value, **any field can carry a `source` property to load its options dynamically from a live data source**. This is how the Twitch channel-point trigger's "Reward" dropdown gets populated from the broadcaster's actual rewards instead of asking the user to paste a UUID. The form renderer short-circuits the type lookup whenever `source.kind` is recognized, so the field's `type` becomes documentation rather than a renderer selector.

Two source kinds are supported today:

| `source.kind` | What it does | Where it dispatches |
|----------------|---------------|----------------------|
| `"internal"` | Generic NATS request/reply against any subject. The engine wraps the descriptor's `payload` in a CloudEvent envelope, fires `nats.request(<event>, ...)`, unwraps the worker's reply (CloudEvent envelope or bare JSON), and forwards through `engine.response.received` to land in the UI's `transientEvents`. The default UI transform expects a `[{value, label}, ...]` shape; workers may include extra fields. | Worker subscribed to `descriptor.request.event` (e.g. `twitchapi`). |
| `"commands"` | UI-only specialisation that lists registered chat commands. Renderer resolves locally without a NATS round-trip. | Convex `commands` table. |

The UI never sends the descriptor. It names the field (`FieldOptionsReference` in `shared/clients/typescript/api/api.ts`: the module id, the declaration holding the field — `trigger`, `action`, `widget`, `resource` or `setting` — that declaration's id, and the field id), and the api's `dispatchFieldOptionsRequest` reads the installed module's stored manifest and sends exactly the request declared there. A reference to a module that is not installed or is disabled, to a field that does not exist, or to one that declares no `internal` request is refused (only top-level fields resolve; a list's `itemFields` cannot declare an `internal` source), and so is a request descriptor in place of a reference: a caller cannot choose the subject or payload, only ask for a request some installed module declared. A settings `button` whose `action` is `internal` goes through the same path, addressed as `{ moduleId, declaration: "setting", fieldId }`.

```jsonc
// What the UI sends for the reward field below
{ "moduleId": "woofx3_twitch", "declaration": "trigger", "declarationId": "channelpoints_redeem", "fieldId": "rewardId" }
```

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

The worker's reply data is a list of options: strings, or `{value, label, group?}` objects. The UI coerces a string to `{value: s, label: s}`, and lists options that carry a `group` under that heading. A worker that cannot list replies `{ "error": "<reason>" }`; the api relays that as a failed request, and the UI shows the reason in place of the options. Implementing a new `internal` source is just adding a new command branch to a worker that already subscribes to a NATS subject — no engine, manifest schema, or UI code changes.

The field's `type` decides whether a value outside the options can be saved. `select` is strict: only a listed option can be picked. `text` is a text box that offers the options as suggestions, and flags a typed value that is not among them rather than refusing it; use it when the value may also be typed while the source cannot answer, or built from a `${...}` variable. The OBS platform module's name fields are the worked example (see [OBS control](../services/obs.md#name-pickers-engine-obs-options)).

The request is sent verbatim, so for an uploaded module barkloader accepts an `internal` `source` (or a button's `action`) only on these subjects, and refuses the install otherwise (see [Engine integrity](../services/engine-integrity.md)):

- `barkloader.module.field_options`, for the module's own functions: `payload.moduleId` must be the manifest's `id`, and `payload.functionId` a function it declares. The responder runs that function with its module's permissions, so naming another module is refused.
- `twitchapi`, for the reads in `TWITCHAPI_FORM_READS` (`barkloader/lib_module/src/manifest_validate.rs`), today only `listChannelPointRewards`. The subject answers any method of the Twitch client, writes included.

The bundled system module's forms may also read engine subjects. Engine-held names a platform module offers, such as OBS's scenes, come from one of its own functions calling a host extension (`ctx.obs.listScenes`), through `barkloader.module.field_options`.

An `internal` source or action is supported on top-level fields only. The api and the UI do not resolve one inside a `list` field's `itemFields`, so barkloader refuses it there, for every module.

A worked example lives at `modules/platform/twitch/manifest.json` in the **woofx3-modules** repository (the `channelpoints.redeem` trigger) and `twitch/src/lib/twitch.ts` `listChannelPointRewards()`.

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
  "examplePayload": "{\n  \"bits\": 1000,\n  \"isAnonymous\": false,\n  \"userName\": \"viewer42\",\n  \"userId\": \"123456\",\n  \"message\": \"Cheer1000 woof\"\n}"
}
```

In the UI, the user sees:

- Below the input: the `description` text as muted helper text.
- Next to the label: an info icon. Hovering it shows a popover containing the `hint` paragraph followed by the `examplePayload` JSON rendered with syntax highlighting. Clicking the icon pins the popover open so the JSON can be read or copied.

### Emits and returns

`schema` describes a **form** the user fills in. `emits` and `returns` describe **values that exist at runtime**. Different things, and the naming keeps them apart on purpose.

Neither is called a schema, because **nothing is ever validated against them**. They answer one question — *which paths can a workflow reference?* — for the variable picker. Calling them schemas would promise enforcement the engine does not perform.

The workflow builder offers suggestions for `${trigger.data.X}` and `${tasks.<id>.<key>}`. Without a declaration it falls back to deriving them from config fields, which leaves a real gap:

- Only a config field carrying an `eventPath` becomes a variable. A trigger that emits payload keys it does not also expose as config fields cannot advertise them at all — and a trigger with no config fields offers no variables whatsoever.
- An action's result had no declaration that was not form-shaped.

Both fields are **optional**. A module that declares neither behaves exactly as it does today.

#### `DataShape`

```jsonc
{
  "fields": [
    {
      "path": "user_name",            // dot path into the value: "bits", "channel.title"
      "type": "string",               // string | number | boolean | array | object | unknown
      "description": "Who cheered.",  // optional, shown in the variable picker
      "example": "viewer42"           // optional
    }
  ]
}
```

Deliberately a flat list of path strings rather than full JSON Schema: it matches `${trigger.data.X}` access exactly and renders straight into a picker. It carries no `required`, no nesting and no constraints — those would all be promises the engine does not keep.

**Validated at install.** A malformed declaration aborts the install before any database or filesystem side effect, so a bad shape can never land and render wrong variables forever. Structure is enforced when the manifest is parsed (`fields` must be a list; every entry needs `path` and `type`), and these rules are checked after, each reporting the offending resource by id:

| Rule | Why |
|---|---|
| `path` must be non-empty | An unnamed variable cannot be referenced. |
| `type` must be one of the six tokens | The accepted set is quoted back, so `"integer"` tells you it should have been `"number"`. |
| paths must be unique within one shape | A path is a variable's identity. Two entries under one are either redundant or contradictory, and nothing can tell which — deduplicating would mean silently picking one. |

#### A trigger declares what it `emits`

```json
{
  "id": "channel_cheer",
  "name": "Cheer",
  "type": "eventbus",
  "event": "channel.cheer",
  "emits": {
    "fields": [
      { "path": "bits", "type": "number", "description": "Bits cheered.", "example": 1000 },
      { "path": "isAnonymous", "type": "boolean" },
      { "path": "userName", "type": "string", "description": "Display name of the cheerer." },
      { "path": "message", "type": "string" }
    ]
  }
}
```

Not to be confused with the `examplePayload` property on an individual **config field**: that is an illustration rendered in that field's info popover, scoped to explaining one input, and nothing reads its keys. `emits` is the machine-readable declaration for the whole payload, and is what feeds variable autocomplete. Declaring both is reasonable — one is for a human reading the form, the other for the variable picker.

#### Trigger sentences

A trigger's `sentence` is how the UI describes one configured instance of it in plain English. Each `{fieldId}` placeholder names a field in the trigger's `schema`, and the UI substitutes, in order of preference: the value the user configured, the field's `anyText` when it is set to "any", or the field's `missingText` (rendered as a warning) while a required field has no value yet.

```json
{
  "id": "channel_subscribe",
  "name": "Subscribe",
  "type": "eventbus",
  "event": "channel.subscribe",
  "sentence": "Someone subs at {tier}",
  "schema": [
    {
      "id": "tier",
      "label": "Tier",
      "type": "select",
      "required": true,
      "options": [{ "value": "1000", "label": "Tier 1" }, { "value": "2000", "label": "Tier 2" }],
      "anyText": "any tier",
      "missingText": "a tier you have not picked"
    }
  ]
}
```

A sentence is rejected at install, naming the trigger, when:

| Rule | Why |
|------|-----|
| it is empty or only whitespace | An empty sentence renders as nothing; omit the key instead. |
| a brace is unbalanced, nested, or encloses nothing (`{}`) | There is no escape syntax, so a stray brace would reach the user verbatim. |
| a placeholder is not the `id` of a field in the trigger's `schema` | Nothing could be substituted for it. Matching is exact: `{ tier }` does not name `tier`. |
| the trigger is a `webhook` trigger | Nothing configures it, so there is nothing to describe. |

Absent means the author declared none, and the UI falls back to the trigger's `name`.

#### An action declares what it `returns`

Same shape, describing the function's result rather than an event payload. See the [action entry](#action-entry-actions) below for a worked example.


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
| `schema` | array | no | `ConfigField[]` describing user-editable inputs the UI surfaces when wiring this action into a workflow step; see [Field declarations](#field-declarations). Forwarded to the DB as `params_schema`. |
| `returns` | object | no | `DataShape` naming what this action's function hands back; see [Emits and returns](#emits-and-returns). Powers the workflow builder's `${stepId.field}` autocomplete: when a downstream step references `${action-1.next}`, the picker looks up `action-1`'s declared `returns` to know `next` exists. Forwarded to the DB as `returns`. |
| `systemOnly` | boolean | no | Bundled system modules only. When `true`, a module that is not a system module is refused at install if any of its workflow steps or command actions names this action. See [Engine integrity](../services/engine-integrity.md#system-only-actions). |
| `taxonomy` | array of string | no | Open, multi-valued UI classification. See [Taxonomy](#taxonomy). |

Type-specific fields:

| When `type` is | Required field | Description |
|----------------|----------------|-------------|
| `function`     | `function`     | Manifest-local function id (or full canonical id for cross-module references). Resolved to the canonical function id at install and stored on the action row's `call` column. |

**Example — an increment action declaring what it returns:**

```json
{
  "id": "increment",
  "name": "Increment Counter",
  "description": "Increase the chosen counter by the configured step.",
  "type": "function",
  "function": "increment",
  "schema": [
    { "id": "target", "label": "Counter", "type": "resource_ref", "kind": "counter", "required": true },
    { "id": "step", "label": "Increment by", "type": "number", "defaultValue": 1, "min": 1 }
  ],
  "returns": {
    "fields": [
      { "path": "target", "type": "string", "description": "Counter that was incremented." },
      { "path": "previous", "type": "number", "description": "Value before the increment." },
      { "path": "next", "type": "number", "description": "Value after the increment." },
      { "path": "step", "type": "number", "description": "Step applied." }
    ]
  }
}
```

A later workflow step can then reference `${increment.next}` (where `increment` is that step's id) in any of its own field values, and the workflow builder's variable picker will offer `next` / `previous` / `step` with their declared descriptions.

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
| `actions` | array | no | The actions the command runs, in order. Each entry has the same shape as a workflow step (`id`, `action`, `parameters`, `dependsOn`); `action` names an action in the same manifest by `id`, or another module's by canonical id. Stored as the command's actions exactly as declared. Mutually exclusive with `workflow`. |
| `workflow` | string | no | Reference to a workflow the command runs as its one action (use the workflow's `id`; resolved to its canonical id at install). Mutually exclusive with `actions`. |
| `requiredRole` | string | no | Minimum role required to invoke (e.g. `public`, `subscriber`, `mod`). |

A command declaring neither `actions` nor `workflow` runs nothing itself; it
still matches and still publishes `chat.command.<slug>` for workflows listening
to it.

A command is registered once. Reinstalling or upgrading the module keeps an
existing command row, id and all, because the streamer may have edited it; only
a command the new manifest no longer declares is removed. Changing a command's
`actions` in a new module version therefore reaches new installs, not existing
ones.

```json
"commands": [
  {
    "id": "sr",
    "name": "Song Request",
    "pattern": "!sr",
    "type": "prefix",
    "actions": [
      { "id": "queue_song", "action": "song_request" },
      {
        "action": "woofx3:action:chat.reply",
        "parameters": { "message": "${queue_song.message}" }
      }
    ]
  }
]
```

Each action's output is available to the actions after it as
`${<id>.<field>}`. `song_request` returns a
[`ctx.response`](./sandbox.md#ctxresponse), and the `chat.reply` after it posts
that response's `message`.

#### `ctx.event` for a chat-command-triggered function

A chat command reaches a module function through one of two paths — a workflow
subscribed to the `chat.command.*` CloudEvent (via the built-in "Chat Command"
trigger), or a `function` step in the command's own `actions`. Both converge on the
same shape, so a function doesn't need to know which path invoked it:

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
nested objects. See `modules/platform/spotify/functions/song_request.js` (**woofx3-modules**) for a
worked example.

To reply to the chat command, `return ctx.response(success, message)` and put a
`chat.reply` action after the function's step that reads `${<id>.message}`, rather
than calling `ctx.chat.sendMessage(...)` directly — see
[`ctx.response`](./sandbox.md#ctxresponse).

### Workflow entry (`workflows[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local workflow id. Forms the canonical id `{moduleId}:workflow:{id}`. Must match `[A-Za-z0-9._-]+`. |
| `name` | string | yes | Display name. Presentation only. |
| `trigger` | string | yes | Reference to a trigger. Use a manifest-local id to point at a trigger declared in this same manifest, or a full canonical id (`other_module:trigger:foo`) to reference a trigger from another module. Resolved to canonical form at install. |
| `steps[]` | array | yes | Ordered steps. Each step's `action` field references an action by manifest-local id (or full canonical id for cross-module references); resolved at install. |
| `taxonomy` | array of string | no | Open, multi-valued UI classification. See [Taxonomy](#taxonomy). Set at install time only — not currently editable after creation. |

### Widget entry (`widgets[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local widget id. Forms the canonical id `{moduleId}:widget:{id}`. Must match `[A-Za-z0-9._-]+`. |
| `name` | string | yes | Display name. Presentation only. |
| `description` | string | no | |
| `entry` | string | no | HTML entry path in the ZIP. |
| `assets` | string | no | Directory prefix in the ZIP for static assets (all files under this prefix are uploaded). |
| `settingsSchema` | array | no | `ConfigField[]` describing the fields a user fills in when placing this widget on a scene; see [Field declarations](#field-declarations). Per-instance values reach the widget as `widgetHost.settings` and through its setting bindings, and edits reach it while it runs (see [Live settings](./sdk.md#live-settings)). |
| `surfaces` | string[] | no | Where the widget may be placed: `"scene"`, `"alert"` (inside an alert layout), or both. Defaults to `["scene"]`. |
| `hostsSurface` | string | no | Bundled system module only. Marks a widget whose placements host a surface: the `"alert"` widget is the area of a scene where alert layouts play. The scene manager draws it, so it declares no `entry`, and it cannot be placed on the surface it hosts. |
| `theme` | object | no | Opts the widget into themes by declaring a theme contract. Absent means the widget cannot be themed and nothing about it changes. See [Themes](#themes). |

Files are stored under **`modules/{moduleId}/widgets/{widgetId}/…`**.

#### Widget runtime — the `widgetHost` contract

Streamware loads widget bundles into sandboxed iframes (`streamware/ui/src/components/WidgetFrame.tsx`) and a shim script injected by the frame assembler installs a `widgetHost` object onto the iframe's `window` as part of the P1 (`woofx3.widget`) handshake with the parent scene manager. Widgets read `window.widgetHost` directly; the postMessage plumbing underneath is invisible to widget code.

```typescript
interface WidgetHost {
  readonly moduleId: string;
  readonly instanceId: string;            // stable per-placement id
  readonly settings: Readonly<Record<string, unknown>>; // resolved from settingsSchema
  readonly surface: "scene" | "alert";    // placed on a scene, or playing in an alert
  readonly theme: WidgetTheme | null;     // null unless the widget declares a theme contract
  readonly linkedResources: Readonly<Record<string, string>>; // setting id -> instance its module links
  readonly storage: WidgetHostStorage;    // get / subscribe over module storage

  onEvent(handler: (event: WidgetEvent) => void): () => void;
  reportStatus(key: string, value: unknown): void;
  reportComplete(reason?: string): void;  // sugar for reportStatus("complete", { reason })
}

interface WidgetEvent {
  type: string;       // event type, e.g. "alert"
  source: string;     // CloudEvent source
  time: string;       // RFC3339
  data: unknown;      // event payload
}
```

`reportStatus` and `reportComplete` send a P1 `status.report` message to the scene manager, which forwards it over the unified `widget.event` NATS channel. The streamware dispatcher persists generic events to the `widget_status` table and routes `alert.lifecycle` reports to the event queue — see [Widget event channel](../services/widget-events.md).

`onEvent` is the downward channel: the widget sends a P1 `events.subscribe` message and the scene manager relays deliveries as `event.deliver`. Scenes are only sent alerts, so a widget playing in an alert layout receives one `alert` event per alert (see [Alerts](../services/widget-events.md#alerts)), and a widget placed on a scene receives nothing — the right default for display widgets.

`widgetHost.storage` reads the latest module-storage value for `(moduleId, key)` from the local cache populated by `module.storage.changed` events, delivered over the P2 `storage` frame.

The contract definition lives at `shared/clients/typescript/module-sdk/src/widget-host.ts`; the shim that implements it inside the iframe is `shared/clients/typescript/module-sdk/src/widget-host-shim.ts`.

### Themes

A widget author can let others sell (or give away) looks for a widget without each look re-implementing it. The widget opts in with a **theme contract**; a **theme** is data only — CSS variables, one stylesheet, asset files — aimed at one widget's contract. The widget keeps all behavior, so a fix to it reaches every theme. Everything here is opt-in: a module with no `theme`, `themes` or `requires` behaves exactly as before.

A look that needs its own HTML or script is not a theme; ship it as its own widget.

#### The contract (`widgets[].theme`)

```json
"widgets": [{
  "id": "countdown",
  "entry": "widgets/countdown/index.html",
  "assets": "widgets/countdown",
  "theme": {
    "contractVersion": 1,
    "variables": [
      { "id": "accent", "type": "color", "default": "#7ad7ff" },
      { "id": "font",   "type": "text",  "default": "Inter" }
    ],
    "assetSlots": [
      { "id": "background", "kinds": ["image", "video"], "default": "widgets/countdown/bg.png" },
      { "id": "endSound",   "kinds": ["audio"] }
    ]
  }
}]
```

| Field | Description |
|---|---|
| `contractVersion` | Integer from 1. The compatibility key for themes, independent of the module version: bump it only when a variable or slot changes incompatibly. |
| `variables[]` | `id`, `type` (`color`, `text` or `number`) and `default`. Each reaches the widget as the CSS custom property `--theme-{id}`. |
| `assetSlots[]` | `id`, `kinds` (`image`, `video`, `audio`, `font`, told apart by file extension) and an optional `default`: a file inside the widget's own `assets` directory. A filled slot reaches the widget as `--theme-asset-{id}: url(...)`. |

Declare the defaults as the widget's current look, and write the widget's CSS with the same values as `var()` fallbacks (`text-shadow: var(--theme-shadow, 0 2px 8px #000)`). Adding a contract to a widget already on screen then changes nothing. The bundled Timer widget (`modules/woofx3`) is the reference.

A widget with a contract gets a `theme` field appended to its settings (see [Field types](#field-types)); a widget without one never shows it, and may not use `theme` as one of its own field ids.

#### Theme entries (`themes[]`) and `requires`

```json
{
  "id": "neonpack",
  "name": "Neon",
  "version": "1.0.0",
  "requires": { "timerpro": "^1.2.0" },
  "themes": [{
    "id": "neon",
    "name": "Neon",
    "target": "timerpro:widget:countdown",
    "contractVersion": 1,
    "variables": { "accent": "#ff2bd6", "font": "Orbitron" },
    "assets": { "background": "assets/grid.webm", "endSound": "assets/zap.mp3" },
    "stylesheet": "themes/neon.css",
    "preview": "assets/preview.png"
  }]
}
```

| Field | Description |
|---|---|
| `id`, `name`, `description` | Canonical id `{moduleId}:theme:{id}`. |
| `target` | The widget, as `{moduleId}:widget:{id}`. |
| `contractVersion` | Must equal the target contract's. |
| `variables` | Contract variable id to value. Unset variables keep their default. |
| `assets` | Contract slot id to a file in this zip. |
| `stylesheet` | A `.css` file linked after the widget's own styles. Refer to files through `var(--theme-asset-*)`; a `url()` to anything else will not load (see [Rendering](#rendering-and-fallback)). |
| `preview` | An image the settings picker shows. |

A theme entry carries nothing else: any other property fails the install, so there is nowhere for code to go. Any module may declare `themes` — a widget's own module can ship free themes for it — and a package whose manifest has only `themes` (plus metadata and `requires`) is a **theme pack**. `examples/theme-packs/timer-neon` is a sample pack for the bundled Timer widget.

`requires` maps module id to a semver range. A theme for another module's widget must name that module in `requires`.

#### Install-time validation

The install fails, naming the offending field, when:

- `requires` names a module that is not installed, or whose installed version is outside the range
- `target` names no installed widget, or a widget with no `theme` contract
- `contractVersion` differs from the target's
- a theme sets a variable or asset slot the contract does not declare, or a value does not fit the variable's type (a value may not contain `;`, braces, `<`, `>`, `\`, line breaks, unbalanced quotes, or anything that loads a file such as `url(`)
- an asset's kind is not one of its slot's `kinds`, or a file a theme or slot default names is missing from the zip
- a theme entry carries anything beyond the fields above
- a contract declares an unknown variable type or slot kind, a default that does not fit, or a slot default outside the widget's `assets` directory

#### Rendering and fallback

When the scene manager assembles a themeable widget's frame it passes the placement's `theme` setting to barkloader (`GET /widgets/{moduleId}/{widgetId}/frame?theme=...`), which resolves it against the installed modules. The frame then gets, before any widget code runs: a `:root` block setting every `--theme-*` property (theme values over defaults), the theme stylesheet, and `widgetHost.theme` (see [the SDK](./sdk.md#themes)). Theme files are stored under `modules/{moduleId}/{hash}/themes/{themeId}/…` and served by barkloader itself.

Every frame of a widget with a contract, themed or not, is served with a Content-Security-Policy limiting styles and fonts to the engine's own origins, so a stylesheet's `@import` or font `url()` cannot reach another host. Images and media may load from any http(s) host, since a placement's media settings can point at a file hosted elsewhere. Scripts and connections are not restricted by it.

A widget always renders. When the selected theme is uninstalled, is for another contract version, or no longer fits the contract, the frame uses the contract defaults and `widgetHost.theme.fallback` says why (`missing` or `incompatible`); a theme asset file missing from storage falls back to that slot's default.

#### Listing themes for a picker

`GET /themes?widget={moduleId}:widget:{id}` on barkloader (and `listWidgetThemes` on the API) returns the widget's `contractVersion` and every installed theme targeting it, each with `compatible` false when it no longer fits the current contract. Themes live in installed manifests, so the list changes only when a module is installed or removed.

#### Uninstalling

Saving a scene records an edge from the scene to every theme its widgets select, so uninstalling a module whose theme is on screen is refused like any other in-use resource. Uninstalling a module that another installed module `requires` is refused too; the in-use list carries a `resource_type: "module"` entry naming each dependent and the range it requires.

### Resource entry (`resources[]`)

A `resources[]` entry declares that this module is the **controller** for runtime instances of some named *kind* — the [Kubernetes CRD](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/) analog. The engine learns identity (the kind name + which module owns it) but never learns what the kind *means* — all semantics (value storage, mutation operations, validation) live in the owning module's functions and actions.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | string | yes | Open-ended kind identifier (e.g. `counter`, `timer`, `poll`). Must match `[A-Za-z0-9._-]+`. Forms the middle segment of instance canonical ids (`{moduleId}:{kind}:{instanceId}`). Unique within the manifest. |
| `name` | string | yes | Display name (singular). Shown in pickers and management UIs. |
| `description` | string | no | Short description. |
| `icon` | string | no | Optional asset canonical id for picker affordances. |
| `schema` | array | no | `ConfigField[]` — the fields a user fills in to create an instance of this kind; see [Field declarations](#field-declarations). The engine never renders the form and never validates an instance's value against it. |
| `display.summary` | string | no | Where in an instance's value to look for the reading the dashboard shows beside its name: object keys and list indexes joined by `.` (`items`, `spin.item`, `entries.0`), each of `[A-Za-z0-9_-]`. A list reads as how many entries it holds, a number or text as itself. Left out, the whole value is read the same way, which suits a kind whose value is a number, text or a list; set it when the value is an object. |


Declaring a kind is necessary but not sufficient — the module must also expose **actions or commands** that actually create / mutate / delete instances. By convention these:

- A `createX` action whose function calls `ctx.resources.create(kind, instanceId, displayName)`.
- A `deleteX` action with a `target: resource_ref(kind=...)` parameter that calls `ctx.resources.delete(target)`.
- One or more mutation actions (e.g. `increment`, `decrement`) whose `target` is a `resource_ref(kind=...)`.

See `modules/utility/counter/manifest.json` in the **woofx3-modules** repository for the canonical example.

#### Naming a kind

Kind names are an open namespace: two modules may each declare a `wheel`. A kind
is therefore identified by its module and its name, `{module}:{kind}`, the two
leading segments of every instance's canonical id. A `resourceKind` may be
written either way:

- `wheel` means this module's own `wheel` when it declares one, and otherwise
  the one installed module that declares it.
- `spinner:wheel` means the `wheel` that module `spinner` declares.

Install resolves every `resourceKind` to `{module}:{kind}` before validating,
registering or storing the manifest, so the stored manifest, registered schemas
and the dashboard only ever see the qualified form, and a module installed
later that declares the same name cannot change what an earlier install meant.
Install fails when a bare kind is declared by no installed module or by several
(write `module:kind` to say which), or when a qualified kind names a module that
is not installed or does not declare it.

### Module-level settings (`settings[]`)

A `settings[]` entry declares an engine-typed, module-scoped configuration value —
the mechanism a module uses for things like API credentials that its sandboxed
functions need at runtime (a Spotify client secret, a webhook URL, a poll interval).
It uses the same [field declaration](#field-declarations) shape as everything else —
the difference from a widget's `settingsSchema` is **where the value is stored**, not
how the field is described. A widget's values are per-placement and live UI-side,
surfaced to browser-side widget code as `widgetHost.settings`; a module's values are a
flat, per-module namespace persisted in `module_settings` and surfaced to **sandboxed
function code** as `ctx.module.settings`.

Only the properties below are meaningful here — a module setting renders in a simple
settings pane, not the workflow builder, so `eventPath`, `operator` and the picker
types have nothing to bind to.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local setting key, e.g. `clientId`. Combined with the module id to key the `module_settings` row (`module_id` + `key`, unique). This is the key a function reads via `ctx.module.settings.<id>`. |
| `label` | string | yes | Display label for the settings UI. |
| `description` | string | no | Defaults to `""`. |
| `type` | string | yes | A [field type](#field-types) — in practice `text`, `number`, `toggle`, `list` or `button` — or `secret` for a credential, or `url` for a URL the streamer enters, whose origin `ctx.http` may then reach (see [Where `ctx.http` may connect](#where-ctx-http-may-connect)). `secret` and `url` are valid only here, never on a trigger, action or widget field, and neither may declare `defaultValue`. Validated at install. |
| `required` | boolean | no | Defaults to `false`. Descriptive only today — **not enforced** anywhere in the install or read path; a module function reading an unset required setting just sees the type's zero value. |
| `defaultValue` | string | no | Stored as a string regardless of `type`. If omitted, the effective default is `"0"` for `type: "number"`, `"false"` for `type: "toggle"`, `"[]"` for `type: "list"`, and `""` otherwise. On a `list` it must be a JSON array, as text. Rejected on `type: "secret"`: the manifest would ship the secret. |
| `itemFields` | array | no | Required for `type: "list"`, and only allowed there: the fields of one row, as on any other [`list` field](#field-types). See [List settings](#list-settings). |
| `action` | object | no | Required for `type: "button"`. `{ kind: "internal", request: {...}, timeoutMs? }` or `{ kind: "integration", integration: "..." }`. Buttons store no value and are skipped by `RegisterModuleSettings`. |
| `resourceKind` | string | no | Required for `type: "resource_ref"`, and only allowed there: the kind of resource instance the setting links to (`timer`, or `woofx3:timer`; see [Naming a kind](#naming-a-kind)). Its value is that instance's canonical id. A `resource_ref` setting takes no `defaultValue`. See [Linking a resource](#linking-a-resource). |
| `create` | object | no | Only on a `resource_ref` setting: `{ instanceId, displayName, settings? }`, the instance install creates and links while the setting is empty. See [Linking a resource](#linking-a-resource). |

Example — credentials for a Spotify integration. The client id is plain configuration;
the client secret and refresh token are credentials, so they are `secret`:

```json
"settings": [
  {
    "id": "clientId",
    "label": "Spotify Client ID",
    "description": "Your Spotify application client ID from the Spotify Developer Dashboard.",
    "type": "text",
    "required": true
  },
  {
    "id": "clientSecret",
    "label": "Spotify Client Secret",
    "description": "Your Spotify application client secret.",
    "type": "secret",
    "required": true
  },
  {
    "id": "refreshToken",
    "label": "Spotify Refresh Token",
    "description": "OAuth refresh token for the streamer's Spotify account.",
    "type": "secret",
    "required": true
  }
]
```

#### Install-time registration

On install, barkloader registers every declared setting into the `module_settings`
table via the db-proxy `ModuleSettingService/RegisterModuleSettings` RPC, keyed by
the manifest-local module id (not the composite `{id}:{version}:{hash}` key used for
actions/widgets/background tasks). Re-installing or upgrading a module **never
overwrites** a value the user already configured — only a brand-new key gets its
manifest `default` (or type-based zero value) written. The one exception is a
setting whose declared `type` changed: its row takes the new type, and a value that
becomes `secret` is sealed in place, while a secret that stops being one is cleared
rather than decrypted into plain text.

#### Linking a resource

A module that works on a resource another module provides — a subathon board
adding time to a timer — links it with a `resource_ref` setting. The streamer
picks the instance in the module's settings, and the module's functions read its
canonical id from `ctx.module.settings` and drive it with
[`ctx.resources.run`](#ctxresources-surface).

```json
{
  "id": "timer",
  "label": "Subathon timer",
  "type": "resource_ref",
  "resourceKind": "timer",
  "create": { "instanceId": "hype_board_subathon", "displayName": "Hype Board subathon", "settings": { "duration": 3600 } }
}
```

With `create`, the module works without the streamer making an instance first.
After registering settings, install links every such setting that is still
empty: the instance is `{module}:{kind}:{instanceId}`, where `{module}`
is the module that declares the kind, resolved as [Naming a kind](#naming-a-kind)
describes. It is created with `displayName` and `settings` when it does
not exist and reused when it does, so a reinstall, or a second module asking for
the same instance, links rather than fails. A setting that already holds a value
is left alone, whether install linked it earlier or the streamer chose another
instance since.

Uninstalling the module leaves the instance in place: it belongs to the module
that provides the kind, and the streamer may have put it to other uses.

The module's widgets can show a linked instance. `widgetHost.linkedResources` maps
each linked `resource_ref` setting to its canonical id, and a widget subscribes to
`"state:" + canonicalId` for its value, or `"resource:" + canonicalId` for its value
with its settings, as it would to one of its own module's instances (see
[Widget storage](../services/widget-storage.md#resource-readings)). The scene
manager serves either key from the owning module's storage only after checking, at
every read, that one of the widget module's `resource_ref` settings holds that id; any
other instance reads as nothing.
`linkedResources` is fixed when the frame loads, so choosing another instance in the
settings takes effect when the scene next loads.

#### List settings

A `list` setting holds rows the streamer adds and removes on the module's settings
page, in the same editor every other `list` field uses, and the module's functions
can change them too. Use one for data the streamer curates and the module also
writes, like the entries on a wheel:

```json
{
  "id": "items",
  "label": "Entries on the wheel",
  "type": "list",
  "itemFields": [{ "id": "label", "label": "Entry", "type": "text", "required": true }]
}
```

The value is stored as a JSON array of objects keyed by the `itemFields` ids, and
read that way everywhere:

- **Functions** read the rows as an array in `ctx.module.settings.<id>` (`[]` when
  empty). To change them, use `ctx.module.compareAndSetSetting(id, expected, value)`,
  which writes only while the setting still holds `expected` and answers
  `{ swapped, current }`. A run and the streamer, or two runs, changing the list at
  the same moment then can't lose one another's change: on `swapped: false`, apply the
  change again to `current` and retry. The comparison is by meaning (key order,
  `1` vs `1.0`), so the array a function read matches the stored list however it was
  saved. `ctx.module.settings` is read once per run, so retry from `current`, not
  from the settings.
- **Widgets** of the module subscribe to `"setting:" + id` to get the rows, sent
  again whenever the setting is saved. The scene manager serves only `list`
  settings this way; any other setting reads as `null`.

```js
function add(ctx, label) {
  var current = ctx.module.settings.items;
  for (var attempt = 0; attempt < 8; attempt++) {
    var next = current.concat([{ label: label }]);
    var outcome = ctx.module.compareAndSetSetting("items", current, next);
    if (outcome.swapped) {
      return next;
    }
    current = outcome.current;
  }
  throw new Error("the list kept changing; try again");
}
```

A resource kind's `schema` may declare a `list` field the same way, for rows that
belong to each instance rather than to the module: the entries of one wheel, say,
typed by the streamer when they create or edit it. Functions of the module that
declares the kind read them from `ctx.resources.get(id).settings.<field>` and change
them with `ctx.resources.compareAndSetSetting(id, field, expected, value)`, which works
like `ctx.module.compareAndSetSetting` for that one instance. Until the streamer saves
the field the instance does not hold it, so it reads as `undefined`; pass back what was
read, not a defaulted `[]`, as the first `expected`:

```js
function add(ctx, wheel, label) {
  var current = ctx.resources.get(wheel).settings.items;
  for (var attempt = 0; attempt < 8; attempt++) {
    var next = (current || []).concat([{ label: label }]);
    var outcome = ctx.resources.compareAndSetSetting(wheel, "items", current, next);
    if (outcome.swapped) {
      return next;
    }
    current = outcome.current;
  }
  throw new Error("the list kept changing; try again");
}
```

Only the module that declares the kind may write an instance's settings. Lua has
one empty table for `[]` and `{}`, so an empty table replacing a list is written as
an empty list.

#### Reading settings at runtime — `ctx.module`

Both the QuickJS and Lua sandbox runtimes expose the invoking function's module
identity and resolved settings as `ctx.module`:

```js
ctx.module = {
  id: string,        // manifest-local module id
  name: string,       // manifest display name
  version: string,    // semver string from the manifest
  settings: {          // one key per module_settings row for this module
    [key: string]: string | number | boolean | object[]
  },
  setSetting(key, value),                        // write a string, unconditionally
  compareAndSetSetting(key, expected, value)     // write only while it holds expected
}
```

Values are stored as `TEXT` in the database and coerced to a native `string` /
`number` / `boolean`, or a `list` setting's array of rows, at read time based on the
setting's declared `type`
(`HttpSettingsClient::coerce_value` in barkloader). Example, from
`modules/platform/spotify/functions/poll_current_track.js` (**woofx3-modules**):

```js
var clientId = ctx.module.settings.clientId;
var clientSecret = ctx.module.settings.clientSecret;
var refreshToken = ctx.module.settings.refreshToken;

if (!clientId || !clientSecret || !refreshToken) {
  return { error: "missing config" };
}
```

Module code cannot read the engine's environment: it holds the engine's own
credentials, and module code is end-user code. Per-install configuration belongs in
`ctx.module.settings`.

See [Sandbox runtime → `ctx.module`](./sandbox.md#ctxmodule) for the full sandbox-side
contract, and [Module settings: the UI contract](../services/module-settings-ui.md)
for how a streamer's UI reads and writes these values after install.

> **Secrets.** A `type: "secret"` setting is sealed at rest by db-proxy, returned by the
> settings API only as `value: ""` plus `isSet`, and opened solely for this module's
> own functions, where it arrives in `ctx.module.settings` as a string. Every other
> type is plain `TEXT`, returned as-is. See
> [Module settings: the UI contract → Secret settings](../services/module-settings-ui.md#secret-settings).

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
| `schedule` | string | yes | A cron expression: the five-field POSIX form (`"*/5 * * * *"`) or a six-field, seconds-first form (`"*/30 * * * * *"`). An expression that does not parse fails the install. |
| `description` | string | no | Defaults to `""`. |
| `runOnLoad` (alias: `run_on_load`) | boolean | no | Defaults to `false`. When `true` the task also fires once each time the module is registered: boot, install, upgrade, reload and enable. Cron never fires at startup on its own; this is how a module re-arms its [deadlines](#deadlines-deadlines) and catches up on whatever came due while barkloader was down. A failed load firing is retried with backoff (1s, 2s, 4s, ... capped at a minute, 8 attempts) rather than waiting for the next cron fire. |

Example — `modules/platform/spotify/manifest.json` (**woofx3-modules** repository):

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

`runOnLoad` and the module's `deadlines` are read from the stored manifest when
the module is registered, alongside the persisted task rows.

Registration into the in-process scheduler happens on install, on the module's
`/functions/{name}/register` route, and on upgrade/reload. Registering replaces
everything the module had scheduled, deadlines included. Disabling a module drops
its entries and enabling it arms them again (and fires its `runOnLoad` tasks).
Unregistration happens on module delete, keyed by the task's **manifest-local module
id** (not the module's database-row UUID) — the scheduler's in-memory map is keyed
the same way the sandbox registry is, so using the wrong identifier here silently
no-ops the unregister and leaves the task firing after deletion.

#### Scheduler mechanics

One scheduler owns every cron task, `runOnLoad` firing and deadline in the
process: a min-heap of entries ordered by fire time, and one loop that sleeps until
the earliest entry or until an entry is armed, replaced or cancelled, whichever
comes first. Nothing runs while nothing is due. Replacing or cancelling an entry
never searches the heap: each arm carries a generation, and a heap item whose
generation no longer matches its entry is discarded when it surfaces.

A cron task re-arms itself from its schedule after each firing completes, so a slow
invocation is never overlapped by the next one. At most one invocation per entry
runs at a time; an entry that comes due while its previous invocation is still
running fires as soon as that one finishes. Every firing goes through the same
`SandboxFactory::invoke_blocking` entrypoint used for every other function call in
barkloader (chat commands, workflow steps, the field-options NATS responder).

A fired cron task invokes with an empty event and empty parameters — background
tasks receive no per-invocation context beyond what `ctx.module`/`ctx.resources`/etc.
already expose; if a task needs input, it has to fetch it itself (e.g. from module
storage or an external API). Each firing and its outcome are logged at `debug`; a
failure is logged at `error` and is not retried (a `runOnLoad` firing excepted).

### Deadlines (`deadlines[]`)

A deadline lets a module's functions schedule one-shot work at a specific moment —
end a timer when it reaches zero, close a window, lift a cooldown — instead of
polling for it from a high-frequency background task. The manifest declares which
function a deadline invokes and how many entries it may hold; functions then arm
and cancel entries with [`ctx.schedule`](#ctx-schedule-surface).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Manifest-local deadline id, unique within `deadlines`. The first argument to `ctx.schedule.at`/`cancel`. |
| `function` | string | yes | Manifest-local id of a function declared in the same manifest's `functions`. Only functions declared here can be scheduled. |
| `maxPending` (alias: `max_pending`) | number | yes | Most entries this deadline may hold at once, `1` to `1024`. |
| `description` | string | no | Defaults to `""`. |

All of it is checked at install: a duplicate id, an undeclared function, or a
missing or out-of-range `maxPending` fails the install.

```json
"deadlines": [
  {
    "id": "timer_end",
    "function": "timer.expire",
    "maxPending": 256,
    "description": "Ends a running timer the moment it reaches zero."
  }
],
"backgroundTasks": [
  {
    "id": "timer_reconcile",
    "function": "timer.reconcile",
    "schedule": "* * * * *",
    "runOnLoad": true,
    "description": "Re-arms timer deadlines from storage and ends any that ran out."
  }
]
```

#### `ctx.schedule` surface

Available in both QuickJS and Lua function runtimes. The module is implied: an entry
is identified by `(module, deadlineId, key)`, and a function can only arm or cancel
its own module's entries.

| Call | Returns | Notes |
|------|---------|-------|
| `ctx.schedule.at(deadlineId, key, whenMs, params?)` | `void` | Arms `key` to fire at `whenMs` (Unix epoch milliseconds), replacing an existing entry under the same key. A time in the past is valid and fires as soon as possible. `params` defaults to `{}`. |
| `ctx.schedule.cancel(deadlineId, key)` | `void` | Drops the entry. Cancelling one that does not exist is not an error. |

`at` throws for an undeclared `deadlineId`, a non-finite `whenMs`, a `whenMs` more
than 30 days out, `params` over 4 KiB serialized, a key over 512 bytes, or a
deadline already holding its `maxPending` entries (replacing an existing key does
not count against it). `cancel` throws for an undeclared `deadlineId`.

Keys are free-form strings; keying entries by a resource instance's canonical id is
the usual choice, and deleting that instance with `ctx.resources.delete` cancels
every entry whose key is its canonical id.

When an entry comes due, its function runs with:

- `ctx.event.parameters` — the `params` given to `at`
- `ctx.event.deadline` — `{ id, key, dueAt, firedAt }`: the deadline id, the key,
  the epoch ms the entry was armed for, and the epoch ms it actually fired

A failed firing is logged and not retried.

#### Durability: in memory by design

Entries are not persisted. A deadline is a cache of state the module already keeps
durably in its own storage, so barkloader holds entries in memory only, and drops a
module's entries whenever the module is registered again (upgrade, reload), disabled
or uninstalled. The module's `runOnLoad` reconcile task is what rebuilds them: it
reads its state, handles anything that came due while the process was down, and arms
the rest. That same task, on its cron schedule, is the safety net for any `at` or
`cancel` a function missed.

The contract that follows: **a stale or duplicate firing must be harmless.** A
deadline's function checks its own state before acting (the timer is still running,
its end time has passed) and writes with `ctx.storage.compareAndSet`, so a firing
for a timer that was paused, extended or deleted in the meantime does nothing.

### Permissions (`permissions[]`)

Most of what a module function can reach needs no declaration. A few host
functions act on the channel or its chatters, and a module calls those only
if its manifest asks for them by permission id:

```json
"permissions": ["twitch.moderation", "twitch.channel"]
```

| Permission | Opens |
|---|---|
| `twitch.moderation` | `ctx.twitch.timeout`: time a chatter out |
| `twitch.channel` | `ctx.twitch.updateStream`: change the stream title, category or tags |
| `net:<host>` | `ctx.http` to `https://<host>` on port 443, e.g. `net:api.spotify.com` |

The ids are fixed by the engine (`barkloader/lib_sandbox/src/permissions.rs`),
except `net:`, which names a host: an exact lowercase DNS name with no IP
address, port or wildcard. Declaring a host does not declare its subdomains,
so a module that calls `api.spotify.com` and `accounts.spotify.com` lists both.

#### Where `ctx.http` may connect

Module code reaches only the destinations its module was granted
(`barkloader/lib_sandbox/src/net.rs`):

- a `net:<host>` permission, over `https` on port 443;
- the origin (scheme, host and port) of a URL the streamer entered in a
  [`url` setting](#module-level-settings-settings). Module code cannot write a
  `url` setting (`ctx.module.setSetting` refuses it), and a manifest cannot
  give one a default.

Every redirect is checked like the first request, and every address a host
name resolves to must not be loopback, private, link-local or otherwise local
unless the engine sets `WOOFX3_MODULE_HTTP_ALLOW_PRIVATE=true` (a self-hosted
engine whose modules talk to its own network). `WOOFX3_MODULE_HTTP` decides
what happens to anything else: `log` (the default) logs it and sends the
request, so modules written before host permissions can be found and updated;
`enforce` refuses it with `permission_denied`.
An unknown id or one listed twice fails the install. At runtime barkloader
reads the permissions from the installed manifest, and a call to a function
whose permission the invoking module did not declare throws before anything is
sent, with `code` `permission_denied`. Permissions are declared by the module
and enforced by the engine, and shown on the module install page (woofx3-ui
feat/module-permissions-review).

### OAuth integrations (`oauth[]`)

A module that calls an OAuth API (Spotify, say) declares the provider, and the
engine holds the credentials: module code never sees the client secret or the
streamer's tokens.

```json
"settings": [
  { "id": "clientId", "label": "Spotify client ID", "type": "text" },
  { "id": "clientSecret", "label": "Spotify client secret", "type": "secret" },
  { "id": "connect", "label": "Connect Spotify", "type": "button",
    "action": { "kind": "integration", "integration": "spotify" } }
],
"oauth": [{
  "id": "spotify",
  "authorizeUrl": "https://accounts.spotify.com/authorize",
  "tokenUrl": "https://accounts.spotify.com/api/token",
  "scopes": ["user-read-playback-state", "user-modify-playback-state"],
  "clientIdSetting": "clientId",
  "clientSecretSetting": "clientSecret",
  "hosts": ["api.spotify.com"]
}]
```

| Field | Notes |
|---|---|
| `id` | 1-40 lowercase letters, digits, `_` or `-`; named by `ctx.oauth.request` and by the connect button's `integration` |
| `authorizeUrl`, `tokenUrl` | `https` |
| `scopes` | Asked for when the streamer connects |
| `clientIdSetting` | A `text` setting holding the OAuth client id. The dashboard may supply its own app's id instead, for a provider woofx3 has an app with, together with the `tokenUrl` it checked that app against; the engine refuses the exchange when the installed integration's `tokenUrl` differs, so a module updated mid-connect cannot receive a code issued to that app |
| `clientSecretSetting` | Optional: a `secret` setting holding the client secret. Without it the client is public; the flow always uses PKCE |
| `hosts` | The hosts the token may go to, as for `net:` permissions: `https` on port 443 |

The streamer connects from the module's settings: the dashboard sends them to
`authorizeUrl` and receives the callback, and the engine exchanges the code
(`completeModuleOAuth`), with the client secret when there is one. The tokens
are kept in the module's settings under the reserved key `oauth.<id>`, sealed
at rest like a `secret` setting; `ctx.module.settings` leaves them out,
`ctx.module.setSetting` refuses them, and no manifest setting may take an id
starting with `oauth.`. Module code then calls the provider with
`ctx.oauth.request({ integration, url, method?, headers?, query?, body? })`:
the engine attaches the access token, refreshes it when it is about to expire
or the provider answers 401, and sends it only to `hosts`, through the same
checks as `ctx.http` ([Where `ctx.http` may connect](#where-ctx-http-may-connect)).
It throws while the integration is not connected. A token is used only with the `tokenUrl` and `hosts` it was issued under: once an update moves the `tokenUrl` or adds a host, `ctx.oauth.request` throws without sending anything until the streamer connects again, so an update cannot redirect the refresh token or the access token. Dropping a host needs no reconnect.

A workflow step or command action that names another module's action runs that
module's function, with that module's permissions. So an uploaded module whose
bundled workflows or commands name another module's action must itself declare
every permission that module declares; otherwise the install fails, naming the
reference and the missing permissions. The other module must be installed with
a readable manifest. Bundled system modules are exempt, and references to the
module's own actions need nothing beyond its own `permissions`.

### Local endpoints (`local[]`)

A module that controls something on the streamer's own network (OBS, a key
light, VTube Studio) declares it as a local endpoint. The module states facts
only: what it reaches, which of its settings hold the address, and how the
device can be found. How the engine reaches it, straight to the address or
through the woofx3 companion on the streamer's PC, is the platform's decision
(see [Local endpoints](../services/local-endpoints.md)).

```json
"settings": [
  { "id": "host", "label": "Host", "type": "text", "defaultValue": "127.0.0.1" },
  { "id": "port", "label": "Port", "type": "number", "defaultValue": "4455" },
  { "id": "password", "label": "Password", "type": "secret" }
],
"local": [{
  "id": "obs",
  "name": "OBS WebSocket",
  "protocol": "websocket",
  "hostSetting": "host",
  "portSetting": "port",
  "passwordSetting": "password",
  "discover": { "known": "obs-websocket" }
}]
```

| Field | Notes |
|---|---|
| `id` | 1-40 lowercase letters, digits, `_` or `-`; unique within the module |
| `name` | 1-80 characters. Shown in the companion and on the module install page |
| `protocol` | `websocket` or `http`. Any other value fails the install, because the platform could not carry it |
| `hostSetting` | A `text` setting holding the host |
| `portSetting` | A `number` setting holding the port |
| `passwordSetting` | Optional: a `secret` setting holding the endpoint's own password |
| `discover` | Optional, with exactly one of `mdns` or `known`. `mdns` is a DNS-SD service type such as `_elg._tcp`, browsed by the companion. `known` names a discoverer built into the companion (`obs-websocket` reads OBS's own WebSocket config file); it is checked for shape only, because which discoverers exist depends on the companion's version, not the engine's |

The install fails when a named setting is missing or of another type, or when
two endpoint fields name the same setting: the companion fills these settings
in, and two endpoints sharing one would overwrite each other's values. Unknown
fields in an entry also fail the install. The block is stored with the manifest
in `modules.manifest`, where the dashboard and sceneManager read it.

Module code cannot open a local endpoint yet. Today the one endpoint in use is
OBS's, and sceneManager holds that connection on the module's behalf
(`woofx3_obs/obs`, see [OBS](../services/obs.md)); module code reaches OBS
through `ctx.obs`.

## Runtime resource instances

Resource instances are runtime-created rows that record one specific instance of a declared kind — for example, a `death_count` counter or a `goal_progress` counter, both of kind `counter` declared by the bundled `woofx3` module. Instances live in the `module_resource_instances` table; the owning module owns the underlying value (in module storage).

A kind's `schema` is its create-instance form. Whatever that form produced — a counter's lifetime and starting value, say — is kept on the instance as its **settings**: a JSON object the engine stores verbatim and never interprets. The owning module reads it back with `ctx.resources.get`.

Settings can be changed afterwards (`updateResourceInstance`), along with the display name. Identity — module, kind and instance id — never changes, so everything holding the canonical id keeps working. A setting that describes how a value is *stored*, such as a counter's lifetime, applies from the module's next write, since the engine does not know which stored keys a setting governs.

### Lifecycle

| Step | API | Owner |
|------|-----|--------|
| Module declares it provides a kind | `manifest.resources[].kind` | Module manifest |
| User triggers instance creation (UI, chat command, etc.) | `createResourceInstance(...)` engine RPC, or `ctx.resources.create(kind, instanceId, displayName, settings?)` | Dashboard / module function |
| Engine persists the row + emits NATS event | `module.ModuleService/CreateResourceInstance` | DB proxy |
| Other parts of the system reference the instance | `resource_ref(kind=...)` ConfigField → canonical id | UI / workflow editor |
| Owning function performs work using the canonical id | `ctx.event.parameters.target` | Module function |
| User triggers instance deletion | `ctx.resources.delete(canonicalId)` | Module function |
| Engine cascades on module uninstall | FK `module_resource_instances.module_id → modules.id ON DELETE CASCADE` | DB |

The owning module's storage is the source of truth for instance values. The engine's row is identity plus the settings the instance was created with (id, kind, instanceId, displayName, settings).

### `ctx.resources` surface

Available in both QuickJS and Lua function runtimes:

| Call | Returns | Notes |
|------|---------|-------|
| `ctx.resources.create(kind, instanceId, displayName?, settings?)` | `{ canonical_id, module_name, kind, instance_id, display_name, settings }` | The owning module is implicit (taken from the function's canonical path). `settings` must be an object. |
| `ctx.resources.get(canonicalId)` | the same shape, or `null` | How a function reads the settings of the instance it was asked to act on. `null` when nothing has the id — a workflow can name an instance deleted after it was configured. |
| `ctx.resources.delete(canonicalId)` | `void` | Idempotent from the caller's perspective when the row exists; surfaces an error if it doesn't. Also cancels every [deadline](#deadlines-deadlines) entry keyed by `canonicalId`. |
| `ctx.resources.list(kind)` | an array of the same shape | A bare `kind` returns every instance of that name across every installed module; `module:kind` returns only that module's. |
| `ctx.resources.run(canonicalId, verb, params?)` | what the action returns | Runs the providing module's `{kind}.{verb}` action on the instance — `ctx.resources.run(timer, "add", { seconds: 60 })` runs `woofx3:action:timer.add` with `target` set to `timer`. See below. |
| `ctx.resources.compareAndSetSetting(canonicalId, key, expected, value)` | `{ swapped, current }` | Writes `settings[key] = value` on an instance this module owns, only while `settings[key]` still holds `expected`, compared by meaning (key order, `1` vs `1.0`, `[]` vs `{}`). `null`/`undefined` (`nil` in Lua) matches a key the instance does not hold, which is how a schema field the streamer never saved reads. `current` is the setting as it reads now, `null` when absent. A swap is announced as an instance update (`db.module.resource.instance.updated`), the same as a streamer's edit, so the dashboard and `resource:<canonicalId>` readers refresh. Throws for an instance another module owns, one that does not exist, or a value JSON cannot hold. See [List settings](#list-settings). |

`ctx.resources.run` is how a module drives a resource another module provides. The
action runs as the providing module — its function, its storage, the events it
announces — on the caller's thread, within the caller's time. Before running it the
engine checks that:

- the instance belongs to the calling module, or one of the calling module's
  settings holds its canonical id: the streamer chose it, typically through a
  [linked `resource_ref` setting](#linking-a-resource);
- it exists and is of the kind its id names;
- the providing module declares `{kind}.{verb}` as a `type: "function"` action;
- the calling module declares every permission the providing module does, since the
  action runs with them.

Runs may nest (an action that runs another), up to four deep; deeper is refused as a
loop. A failure throws, carrying the reason from wherever in the chain it happened.

**Where an instance's value lives:** at `state:<canonicalId>` in the owning module's storage (e.g. `state:woofx3:counter:death_count`). This is the contract, not a suggestion: the engine's `getResourceValues` reads it, and the dashboard's value mirror keys on it, so a kind that stores its value anywhere else shows nothing on its first-party page.

The bundled `woofx3` module's kinds store these values, which is what a widget or page showing one reads:

| Kind | Value at `state:<canonicalId>` | No value stored means |
|------|--------------------------------|-----------------------|
| `counter` | `{ "value": <number>, "reached": { "<goal>": <epoch ms> } }`. `reached` records when each of the counter's goals was first reached, which is what decides whether reaching one again is the first time. A counter written before counters carried goals holds a bare number and still reads. Its goals are a `list` setting of `{ value, name }` rows, the name optional; goals set up before they had names are a comma-separated string of numbers, which still reads. | Its `initialValue` setting, no goal reached. |
| `timer` | `{ "running": true, "endsAt": <epoch ms> }` while counting down; `{ "running": false, "remainingMs": <ms> }` while stopped. A running timer is never rewritten as it ticks, so time left is `max(0, endsAt - now)`. | Stopped at its `duration` setting. |
| `queue` | An array of strings, first in line first. | Empty. |

Each kind also declares eventbus triggers, announced by its functions through
[`ctx.result`](./sandbox.md#ctxresult), so a workflow — and the dashboard's resource
pages, which edit those workflows — can act on a change however it was made. Every
trigger carries a `resource_ref` field bound to the event's `target`, which narrows a
workflow to one instance.

| Event | Announced when |
|-------|----------------|
| `counter.changed` | Any counter action moves the number. |
| `timer.started` | A timer goes from standing still to counting down. |
| `timer.paused` | Pause stops a timer that was counting down. |
| `timer.ended` | A running timer reaches zero. Every change that leaves a timer running arms the module's `timer_end` [deadline](#deadlines-deadlines) for its `endsAt`, and the firing stops the timer and announces it. The `timer_reconcile` task (on load, then once a minute) ends any timer that ran out while the engine was down or whose deadline was not armed. Starting a timer from its ended workflow makes it repeat. |
| `queue.added` | An entry joins a queue. |
| `queue.next` | The entry at the front of a queue is taken. |
| `goal.reached` | A change carries a counter from below one of its goals to at or above it. Climbing further past that goal announces nothing more, and one change crossing several goals announces each. Reaching a goal again after dropping below it announces again only when the counter's `announceEveryTime` setting is on; `first` on the event says which crossing this was, and `goalName` carries the goal's name, or `""` when it has none. A counter with no goals announces none. |

**Storage is per module.** Every key a function reads or writes belongs to its own module — the store addresses a value by module and key — so two modules using the same key hold two separate values. Update a value from its previous one with `ctx.storage.compareAndSet(key, expected, value, options?)`, which writes only if the key still holds `expected` (or nothing, for `null`) and otherwise returns `{ swapped: false, current }` to retry from. A `get` followed by a `set` loses one of two concurrent updates.

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
| `.json` | Manifest | Prefer `manifest.json` at ZIP root. |
| `.yaml`, `.yml` | Manifest | |
| *other* | Asset | Stored as-is (HTML, CSS, images, fonts, etc.); used for widgets and any referenced path. |

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
      ...                    # paths from manifest function.path, e.g. functions/foo.lua
    assets/
      ...                    # paths from manifest assets[].path, e.g. assets/bell.mp3
    widgets/
      {widget-id}/...
archives/
  {module-id}/
    {version}.zip
```

`functions[].path` and `assets[].path` are both **full zip-relative paths**,
already including whatever directory the author put the file under (by
convention `functions/` and `assets/` respectively) — the upload key is
`modules/{module-id}/{path}` verbatim, not `modules/{module-id}/assets/{path}`.
Declaring `"path": "assets/bell.mp3"` is correct; it does not produce
`modules/{module-id}/assets/assets/bell.mp3`.

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
