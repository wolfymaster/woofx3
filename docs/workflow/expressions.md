# Expression Resolution

Workflow strings can carry `${…}` expressions, which the workflow engine
resolves against runtime data before a step runs. Alert text adds one
piece of markup, `{primary}…{primary}`, which the Text widget renders as
highlighted text. It is markup, not an expression.

## The two layers, in order

1. **Workflow engine** — resolves every `${…}` in a step's parameters
   against the trigger, earlier tasks and the environment. An alert's
   layout, widget settings included, leaves the engine with final values.
2. **Text widget** — renders `{primary}…{primary}` spans in its highlight
   color. Nothing else in the text is interpreted.

The resolver is **safe**: no `eval`, no globals, no arithmetic, no calls.

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

**Semantics**: a plain reference is a path lookup,
`source ('.' name | '[' index ']')*`. An expression containing an
operator or a quote is evaluated with a small grammar
(`workflow/internal/expression/compound.go`):

| Form | Meaning |
|---|---|
| `cond ? a : b` | Only the chosen branch is evaluated. |
| `a \|\| b`, `a && b` | Short-circuiting; yields one of the operands, as in JavaScript. |
| `!a` | Negation. |
| `==` `!=` `>` `>=` `<` `<=` | Numeric when both sides are numbers, otherwise compared as text. `===` and `!==` are accepted as aliases. |
| `( … )` | Grouping. |
| `'text'` `"text"` `12` `1.5` `-3` `true` `false` `null` | Literals. |

The falsy values are `null`, `false`, `0` and `""`. Inside an expression a
path that does not exist is `null`, so `${trigger.data.nick ||
trigger.data.userName}` falls back cleanly, and ordering (`>`, `>=`, `<`,
`<=`) against `null` is false. An unknown source is still an error. There
is deliberately no arithmetic, concatenation or function call: an
expression chooses between values, it does not compute them.

**Examples:**

```jsonc
"text": "${trigger.data.userName} just followed!"
"text": "${trigger.data.amount} ${trigger.data.amount > 1 ? 'subs' : 'sub'}"
"text": "${trigger.data.userName == 'wolfymaster' ? 'the boss' : 'a viewer'}"
"params": ["Hello ${trigger.data.userName}!"]
"value": "${task1.result.userId}"          // task export
"apiKey": "${env.TWITCH_TOKEN}"
```

A string that is exactly one `${…}` keeps the value's type, so a number
stays a number; one inside a longer string becomes text.

When a `${…}` inside a longer string fails to resolve, the resolver
leaves the literal token in place and returns the rest of the string
unchanged, which makes authoring errors visible at render time. A string
that is nothing but one failing `${…}` fails the step instead.

### Referencing module assets from a bundled workflow (`${asset:<id>}`)

Modules and workflows must never bake a deployment-specific host into
an asset reference (a repository URL is meaningless on a different
install, and hardcoding one defeats the whole point of a portable
manifest — see `db/proto/v1/module_asset.proto`'s "resolving this to
a public URL is the deployer's concern" note). There is also a
structural constraint an earlier `${woofx3_asset_url}` source didn't
satisfy: an asset referenced in a workflow step's `parameters` (e.g. an
Audio widget's `src` in an alert layout) can be rendered by a *generic*
widget (like the bundled Audio widget) whose own `<base href>` belongs to a different
module than the one that declared the asset — so a bare relative
filename or a base-URL-relative template can't safely reach it (see
[Asset delivery](../services/asset-delivery.md) for
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
       "parameters": { "layout": { "widgets": [{ "settings": { "src": "${asset:pleasure}" } }] } }
     }]
   }]
   ```
2. **Install-time baking** (barkloader, `encode_asset_url_markers` in
   `module_manifest.rs`): every `${asset:<id>}` marker anywhere in a
   bundled workflow's step `parameters` (recursively — including inside
   arrays, e.g. a layout's `widgets`) is rewritten into
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
   `{sceneManagerUrl}/assets/{repositoryKey}`. No DB lookup at
   execution time — the repository key was already baked in at install
   time.

`sceneManagerUrl` is the `scene.publicUrl` engine setting (see
[Engine settings the UI configures](../services/engine-settings-ui.md) —
`getEngineInfo().overlayPublicUrl` / `setOverlayPublicUrl`), resolved once
per workflow execution via `workflow/scene_manager_url_resolver.go`'s
`SceneManagerURLResolver` (30s cache, process-wide, falls back to the
required `WOOFX3_SCENE_MANAGER_URL` when unset). sceneManager relays
`/assets/...` to barkloader, which redirects to a presigned storage URL
when the storage backend can sign one and serves the bytes itself
otherwise.

This mechanism is scoped to a module's **own** declared assets,
referenced from **that module's own bundled workflows** — it does not
cover cross-module asset references or the `asset`-typed
`settingsSchema` field an external editor UI might populate for
user-authored workflows (see [Module manifest reference](../barkloader/modules.md)
for that field's separate, still-unresolved authoring story).

## Layer 2 — Text widget highlight markup

Code: `modules/woofx3/widgets/text/index.html`. The Text widget splits its
`text` setting on `{primary}` and shows every other segment in its
highlight color: the first marker opens a highlight, the second closes
it, and so on. The text goes in as text, never as HTML, so a viewer's
name cannot inject markup. No other `{…}` is interpreted.

## Mixing both layers in one string

The bundled `wolfy_profile` workflows do. The layers never overlap, so
the order is:

1. The workflow engine resolves every `${…}` against `trigger.*`,
   earlier tasks and the environment.
2. The Text widget highlights the `{primary}…{primary}` spans.

A "gifted subs" Text widget setting:

```json
{
  "text": "$$ {primary}${trigger.data.gifterName}{primary} gifted {primary}${trigger.data.amount}{primary} ${trigger.data.amount > 1 ? 'subs' : 'sub'} $$"
}
```

After the engine (gifter "alice", amount 5), the widget receives:

```
$$ {primary}alice{primary} gifted {primary}5{primary} subs $$
```

and shows "alice" and "5" in its highlight color.

## Common authoring mistakes

| Token | What goes wrong | Fix |
|---|---|---|
| `{trigger.data.amount > 1 ? 'subs' : 'sub'}` | Braces without `$` are not an expression; the Text widget shows them as written. | `${trigger.data.amount > 1 ? 'subs' : 'sub'}` |
| `${event.data.X}` | The engine has no `event` source, so the token is left unresolved. | `${trigger.data.X}` |
| `${trigger.data.X + 'suffix'}` | There is no concatenation. | Put the literal outside the expression: `"${trigger.data.X}suffix"`. |

## See also

- The alert action that produces these strings: [Tasks → alert](./tasks.md#alert).
- How a scene plays an alert: [Alerts](../services/widget-events.md#alerts).
