# Streamware Substitutions

Strings inside an alert's `parameters` go through a render-time substitution pass in
the browser before they're displayed. This page covers the streamware (widget) layer
specifically.

For the upstream layer that runs inside the workflow engine before publish — and for
the rules that govern when to use which — see
[Workflow expressions](../workflow/expressions.md).

## Where this runs

Substitution happens inside the built-in `media_alert` widget, a static HTML document
at `streamware/public/widgets/builtin/media_alert/index.html` — served like any other
widget via the frame assembler, not part of the `streamware/ui` React bundle. There is
no per-widget substitution contract; a widget author who wants this behavior copies
the pattern into their own widget's script.

## Pipeline order

For each text-bearing field on an alert (`text`, `mediaUrl`/`animation.value`,
`audioUrl`):

```
raw → {primary}…{primary} expansion → {path} / ${path} lookup → output
```

Text fields go through `formatText()`; URL and Lottie animation-value fields go through
`resolveTemplate()` (`index.html:134-152`). Both are plain string functions — there is
no expression grammar, no operators, and no `eval`.

## Color tags — `{primary}…{primary}`

A regex pre-pass in `formatText()` pairs occurrences of `{primary}` and wraps the
enclosed text in `<span class="primary">…</span>`:

```js
template.replace(/\{primary\}(.*?)\{primary\}/gs, '<span class="primary">$1</span>')
```

Pairing is positional and non-greedy: the first `{primary}` opens, the second closes.
An unmatched trailing `{primary}` is simply left unconsumed by the regex (no span is
emitted for it). This pass always runs first, so its output survives the `{expr}`
lookup pass untouched.

## `{path}` lookup

After the color-tag pass, `formatText()` replaces every remaining `{expr}` segment
with a **flat dot-path lookup** against the context object:

```js
function deepGet(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}
```

`{expr}` is looked up as `deepGet(ctx, expr.trim())`; `null`/`undefined` render as an
empty string, everything else is stringified with `String(val)`. There is **no
ternary, logical, comparison, or arithmetic operator support** — `{a.b}` and
`{a.b.c}` work, `{a > 1 ? "x" : "y"}` does not (the whole expression is treated as a
literal, dotless-lookup-failing path and resolves to an empty string).

## URL / animation fields — `resolveTemplate()`

`mediaUrl` entries and a Lottie `animation.value` field go through a second resolver
that accepts **both** `{path}` and `${path}` syntax, in that order:

```js
function resolveTemplate(template, ctx) {
  return template
    .replace(/\$\{([^{}]+)\}/g, (_, expr) => { const v = deepGet(ctx, expr.trim()); return v == null ? "" : String(v); })
    .replace(/\{([^{}]+)\}/g, (_, expr) => { const v = deepGet(ctx, expr.trim()); return v == null ? "" : String(v); });
}
```

The `${…}` form exists for backward compatibility with animation-value fields authored
before this widget existed; new content can use either form interchangeably here (both
resolve identically — this is *not* the Layer 1 workflow-engine `${…}` resolver, which
runs server-side before this code ever sees the string).

## Resolver context — what's in scope

Built once per render (`index.html:308-312`):

```js
const cfg = Object.assign({}, settings, parameters);
// `event`/`parameters` at the top level, spread `settings`+`parameters` flattened in,
// and also flattened one level via the legacy trigger.data alias.
const ctx = Object.assign({ event, parameters, trigger: { data: event.data ?? {} } }, cfg);
```

| Identifier | Source |
|---|---|
| `event.id`, `event.type`, `event.source`, `event.time`, `event.data.X`, `event.subject` | The CloudEvent, verbatim |
| `parameters.K` | The alert author's parameter, by its key |
| `trigger.data.X` | **Legacy alias** for `event.data.X` — kept for content authored before the `event`-shaped context existed |
| any top-level key from `settings` or `parameters` | Flattened in directly (e.g. a `parameters.title` is reachable as both `{parameters.title}` and `{title}`) |

Unlike the workflow engine's own `trigger` source name (a Layer 1 concept resolved
server-side before publish), this widget's `trigger.data` is a same-layer compatibility
alias, not a separate resolution pass.

## Not currently in use: the AST-walker resolver

`streamware/ui/src/lib/resolver.ts` implements a full hand-written expression grammar
(ternary, logical/equality/comparison operators, arithmetic, typed single-segment
results) with its own test suite (`resolver.test.ts`). It is real, working code, but
**nothing in `streamware/src` or `streamware/ui/src` currently imports it outside its
own test** — the shipped `media_alert` widget uses the simpler `formatText`/
`resolveTemplate` functions described above instead. Treat `resolver.ts` as an
available-but-unwired building block, not the resolver that runs on a live alert
today.

## Cheat sheet

| Want | Token | Resolves where |
|---|---|---|
| Substitute a value into a string | `${trigger.data.userName}` | Layer 1 (Go, workflow engine) |
| Concatenate text + value | `"${trigger.data.userName} just followed!"` | Layer 1 |
| Read an event field in the widget | `{event.data.X}` or `{trigger.data.X}` | Layer 2 (this page), dot-path only |
| Color-emphasised text | `"{primary}…{primary}"` | Layer 2 (color tag pass) |
| Combine substitution + color tag | `{primary}${trigger.data.userName}{primary} gifted a sub!` | Layer 1 → Layer 2 |
| Read an env var | `${env.NAME}` | Layer 1 only |
| Read another task's export | `${<taskId>.X}` | Layer 1 only |
| Conditional / computed value (`a > 1 ? … : …`) | not supported by the shipped widget | would require wiring in `resolver.ts` |

## See also

- Upstream layer + the precedence rules: [Workflow expressions](../workflow/expressions.md).
- Where a `media_alert` envelope comes from: [Tasks → builtin:action:alert](../workflow/tasks.md).
- Wire format for alert delivery: [Widget events](../services/widget-events.md).
