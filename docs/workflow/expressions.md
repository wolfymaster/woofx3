# Expression Resolution

Workflow strings can carry expressions that are resolved against runtime
data. Two distinct resolvers operate on the same envelope, at two
different points in the pipeline. Knowing which one will see your token
is the difference between a working workflow and silent failure.

## The two layers, in order

```
                          published to NATS
                                  │
                                  ▼
   workflow                  ui.notify.alert            streamware → overlay
  ┌─────────┐                ┌─────────────┐           ┌──────────────┐
  │ engine  │                │  envelope   │           │  MediaWidget │
  │ Go      │ resolves only  │  on the wire│  resolves │  TS resolver │
  │ resolver│ ${…} tokens    │             │  only {…} │              │
  │ (path-  │ here →         │             │  segments │  (full       │
  │  only)  │                │             │  here →   │   expressions│
  └─────────┘                └─────────────┘           └──────────────┘
       ▲                                                       ▲
       │                                                       │
   reads `trigger.X`                                       reads `event.X`
   (the engine's source name)                              (the envelope's
                                                            attached event)
```

Both resolvers are **safe**: no `eval`, no globals. Both are bounded:
unknown identifiers resolve to undefined and propagate as empty
strings rather than throwing.

## Layer 1 — workflow engine (Go)

Code: `workflow/internal/expression/resolver.go`. Runs once per task
execution, before the task is dispatched.

**Syntax**: `${path.expression}`. Strings without `${` pass through
untouched (`workflow/internal/expression/resolver.go:41`).

**Sources** (`workflow/internal/engine/engine.go:642-663`, `buildResolver`):

| Source | What it carries |
|---|---|
| `trigger.id` | CloudEvent id of the firing event |
| `trigger.type` | CloudEvent type (e.g. `channel.cheer`) |
| `trigger.source` | CloudEvent source (e.g. `twitch`) |
| `trigger.time` | RFC3339 timestamp |
| `trigger.data.X` | Anything on the event's `data` map |
| `<taskId>.X` | Exports from a previously-executed task in the same workflow |
| `env.NAME` | Process environment variable (read at substitute time) |

**Semantics**: path lookup only. No operators, no comparisons, no
ternary, no string concatenation, no function calls. The grammar is
literally `source ('.' name | '[' index ']')*`
(`workflow/internal/expression/resolver.go:81-149`).

**Examples that work:**

```jsonc
"text": "${trigger.data.userName} just followed!"
"text": "Bits: ${trigger.data.amount}"
"params": ["Hello ${trigger.data.userName}!"]
"value": "${task1.result.userId}"          // task export
"apiKey": "${env.TWITCH_TOKEN}"
```

**Examples that DO NOT work in this layer** (use Layer 2 instead):

```jsonc
"text": "${trigger.data.amount > 1 ? 'subs' : 'sub'}"   // no operators
"text": "${trigger.data.userName + ' (mod)'}"           // no concatenation
"text": "${trigger.data.amount * 100}"                  // no arithmetic
```

When a `${…}` segment fails to resolve, the resolver leaves the
literal token in place and returns the surrounding string unchanged
(`workflow/internal/expression/resolver.go:50-58`). That makes
authoring errors visible at render time rather than swallowed.

### Referencing module assets from a bundled workflow (`${asset:<id>}`)

Modules and workflows must never bake a deployment-specific host into
an asset reference (a repository URL is meaningless on a different
install, and hardcoding one defeats the whole point of a portable
manifest — see `db/proto/v1/module_asset.proto`'s "resolving this to
a public URL is the deployer's concern" note). There is also a
structural constraint an earlier `${woofx3_asset_url}` source didn't
satisfy: an asset referenced in a workflow step's `parameters` (e.g. an
alert's `audioUrl`) can be rendered by a *generic* widget (like the
builtin `MediaWidget`) whose own `<base href>` belongs to a different
module than the one that declared the asset — so a bare relative
filename or a base-URL-relative template can't safely reach it (see
[Asset prefix rules](../woofwoofwoof/streamware/asset-prefix.md) for
why asset routes are public/token-independent, which is the other half
of this constraint).

The fix is a two-phase encoding, not a workflow-engine expression
source:

1. **Manifest authoring**: reference one of *this module's own*
   `assets[]` entries by id, inside a workflow step's `parameters`:
   ```jsonc
   "assets": [
     { "id": "pleasure", "name": "Pleasure", "path": "assets/pleasure.mp3" }
   ],
   "workflows": [{
     "steps": [{
       "parameters": { "audioUrl": "${asset:pleasure}" }
     }]
   }]
   ```
2. **Install-time baking** (barkloader, `encode_asset_url_markers` in
   `module_manifest.rs`): every `${asset:<id>}` marker anywhere in a
   bundled workflow's step `parameters` (recursively — including inside
   arrays, e.g. a `mediaUrl` list) is rewritten into
   `${woofx3_asset_url:<repositoryKey>}`, using the *just-uploaded*
   asset's actual repository key (e.g.
   `modules/wolfy_profile/assets/pleasure.mp3`) — this is what gets
   persisted in the workflow's `steps_json`. Install fails loudly if a
   marker references an asset id not declared in `assets[]`, rather than
   persisting something that would silently fail to resolve later.
3. **Execution-time resolution** (workflow engine,
   `workflow/internal/expression/resolver.go`): `${woofx3_asset_url:...}`
   is recognized as a distinct token shape (not the ordinary
   `source.path` grammar — repository keys contain dots from file
   extensions, which would otherwise be misparsed as a path segment) and
   resolved via plain string concatenation:
   `{overlayPublicUrl}/overlay/assets/{repositoryKey}`. No DB lookup at
   execution time — the repository key was already baked in at install
   time.

`overlayPublicUrl` is the `overlay.publicUrl` engine setting (see
[Engine settings the UI configures](../services/engine-settings-ui.md) —
`getEngineInfo().overlayPublicUrl` / `setOverlayPublicUrl`), resolved once
per workflow execution via `workflow/overlay_public_url_resolver.go`'s
`OverlayPublicURLResolver` (30s cache, process-wide, falls back to this
service's own env-configured `WOOFX3_OVERLAY_PUBLIC_URL` when unset, and
to an empty string beyond that — no further hardcoded guess, so an
unconfigured deployment resolves asset URLs as host-less relative paths).

This mechanism is scoped to a module's **own** declared assets,
referenced from **that module's own bundled workflows** — it does not
cover cross-module asset references or the `asset`-typed
`settingsSchema` field an external editor UI might populate for
user-authored workflows (see [Module manifest reference](../barkloader/modules.md)
for that field's separate, still-unresolved authoring story).

## Layer 2 — streamware MediaWidget (TypeScript)

Code: `streamware/ui/src/lib/resolver.ts`. Runs in the browser inside
the alert overlay, immediately before each alert is rendered.

**Syntax**: `{expression}` — bare braces, no leading `$`. Strings
without `{` pass through. The full grammar is documented in the
resolver source: ternary, logical AND/OR, equality, comparison,
arithmetic, string concat, paren-grouped subexpressions, string and
number literals, dotted paths, bracket indexing.

**Sources**: the resolver context is `{ ...parameters, event }` where
`parameters` is the alert envelope's `parameters` map and `event` is
the originating CloudEvent attached by the workflow engine
(`workflow/actions.go:118-131`). There is **no `trigger`** — the
streamware resolver only knows about `event`.

**Examples that work:**

```jsonc
"text": "{event.data.userName} cheered {event.data.amount} {event.data.amount > 1 ? 'bits' : 'bit'}"
"text": "{event.data.userName === 'wolfymaster' ? 'the boss' : 'a viewer'}"
```

## The legacy color-tag span

Streamware's `MediaWidget` runs a small substitution pass *before* the
expression resolver to support a legacy color tag from streamlabs:
`{primary}…{primary}` becomes `<span style="color: #EC6758">…</span>`.
First occurrence opens the span, second closes, third opens again, and
so on (`streamware/ui/src/widgets/media-widget.ts:30-38, 110-127`).
This is intentionally first in the pipeline so the expanded HTML
survives the expression resolver pass untouched.

## Mixing both layers in one string

You can — and the bundled `wolfy_profile` workflows do. The layers
process disjoint syntaxes, so the order is:

1. Workflow engine (Go) resolves every `${…}` against `trigger.*`.
2. The substituted result rides on `ui.notify.alert` to streamware.
3. Streamware's MediaWidget resolves `{primary}…{primary}` first, then
   every remaining `{…}` against `event.*`.

A "gifted subs" alert combining both layers:

```json
{
  "text": "$$ {primary}${trigger.data.gifterName}{primary} gifted {primary}${trigger.data.amount}{primary} {event.data.amount > 1 ? 'subs' : 'sub'} $$"
}
```

After Layer 1, the wire payload reads (gifter "alice", amount "5"):

```
$$ {primary}alice{primary} gifted {primary}5{primary} {event.data.amount > 1 ? 'subs' : 'sub'} $$
```

After Layer 2 (color tags expanded, ternary resolved):

```
$$ <span style="color: #EC6758">alice</span> gifted <span style="color: #EC6758">5</span> subs $$
```

## Common authoring mistakes

| Token | What goes wrong | Fix |
|---|---|---|
| `${trigger.data.amount > 1 ? 'subs' : 'sub'}` | Layer 1 (Go) doesn't support ternary; Layer 2 doesn't see `trigger.*`. Always falls through unresolved. | `{event.data.amount > 1 ? 'subs' : 'sub'}` |
| `{trigger.data.userName}` | Layer 1 ignores it (no `$`); Layer 2 has no `trigger`. Renders empty. | `${trigger.data.userName}` for plain substitution, or `{event.data.userName}` for use inside expressions. |
| `${event.data.X}` | Layer 1's `event` source doesn't exist; Layer 1 returns undefined. | `${trigger.data.X}` |
| `${trigger.data.X + 'suffix'}` | Layer 1 has no concat. Renders unresolved literal. | `{trigger…}` doesn't work in Layer 2 either; emit the prefix as a literal: `"${trigger.data.X}suffix"`. |

## See also

- Layer 2 reference: [Streamware substitutions](../streamware/substitutions.md).
- The alert action that produces these strings: [Tasks → builtin:action:alert](./tasks.md).
- The full alert envelope shape: [Widget events](../services/widget-events.md#alert-lifecycle-events).
