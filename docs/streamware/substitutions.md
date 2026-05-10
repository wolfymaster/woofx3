# Streamware Substitutions

Strings inside an alert's `parameters` go through a render-time
substitution pass in the browser before they're displayed. This page
covers the streamware (UI) layer specifically.

For the upstream layer that runs inside the workflow engine before
publish — and for the rules that govern when to use which — see
[Workflow expressions](../workflow/expressions.md).

## Pipeline order

For each text-bearing field on an alert (`text`, `mediaUrl`, `audioUrl`,
elements of `options`):

```
raw → {primary}…{primary} expansion → {…} expression evaluation → output
```

Both passes happen inside `MediaWidget.render`
(`streamware/ui/src/widgets/media-widget.ts:42-74`). The legacy color
tag is processed first so the expanded HTML survives the expression
parser untouched.

## Color tags — `{primary}…{primary}`

A pre-processor pass that pairs occurrences of `{primary}` and emits
`<span style="color: #EC6758">…</span>` around the wrapped text.

Pairing is positional: the first `{primary}` opens, the second closes,
the third opens again, and so on
(`streamware/ui/src/widgets/media-widget.ts:110-127`). Unbalanced
counts are tolerated — a trailing unmatched `{primary}` just emits an
opening span at the end.

Today there's only the one tag (`{primary}`), and the table is
intentionally open-ended in source (`LEGACY_TAGS` at
`media-widget.ts:33-38`) so future tags drop in without a parser
change.

## Expression syntax — `{expression}`

Curly-brace segments get evaluated by a hand-written safe AST walker
(`streamware/ui/src/lib/resolver.ts`). No `eval`, no `new Function`,
no access to globals or method calls. Unknown identifiers resolve to
`undefined` and propagate as empty strings rather than throwing
(`resolver.ts:218-454`).

### Grammar

Low-to-high precedence:

| Form | Example |
|---|---|
| Ternary | `a ? b : c` |
| Logical OR / AND | `a \|\| b`, `a && b` |
| Equality | `==`, `!=`, `===`, `!==` |
| Comparison | `>`, `<`, `>=`, `<=` |
| Additive | `+`, `-` (string concat when either side is a string) |
| Multiplicative | `*`, `/`, `%` |
| Unary | `-x`, `!x` |
| Primary | number, string (`"…"` or `'…'`), `true`, `false`, `null`, `undefined`, identifier path, `(expr)` |
| Path | `name`, `name.subname`, `name[index]`, `name[expr]` |

Strings can use single or double quotes. Both are valid inside the
grammar; `'subs'` and `"subs"` mean the same thing.

### Single-segment vs multi-segment

If the entire field is a single `{…}` segment, the resolver returns
the typed result — number stays a number, boolean stays boolean
(`resolver.ts:27-34`). Useful for fields like `duration` where the
consumer wants a number.

```jsonc
"duration": "{event.data.amount > 100 ? 10 : 5}"   // resolves to 10 or 5 (number)
```

Multi-segment strings (anything with literal text or more than one
`{…}` block) get stringified and concatenated, with `undefined` /
`null` rendering as empty.

### Resolver context — what's in scope

The context object the parser walks against is built at render time in
`media-widget.ts:42-46`:

```ts
const ctx: ResolverContext = { ...parameters, event };
```

That gives expressions access to:

| Identifier | Source |
|---|---|
| `event.id` | CloudEvent id |
| `event.type` | CloudEvent type |
| `event.source` | CloudEvent source |
| `event.time` | RFC3339 timestamp |
| `event.data.X` | Event payload |
| `event.subject` | CloudEvent subject (when set) |
| any `parameters.K` | The alert author's parameter, by its key |

There is **no `trigger`**. The workflow engine's `trigger` source name
is a Layer 1 concept — by the time strings reach this resolver,
`${trigger.…}` substitutions have already happened, and what survives
is the wire envelope's `event`.

## Why the split is what it is

The two layers exist for different reasons:

- **Layer 1 (Go)** runs server-side, before publish. It needs to be
  cheap and obviously safe — workflow authors are users, the engine
  is shared infrastructure. Path-only resolution is intentional: a
  workflow that types `${trigger.data.amount * 1000000}` should not
  pin a CPU. If you need expressions, push them to Layer 2 where the
  cost lives in the renderer's tab.

- **Layer 2 (TS)** runs in the overlay's browser, once per alert
  render. The overhead is local. Expressions are useful there
  because the renderer is the one place where pluralization,
  conditional formatting, and computed display values actually
  matter.

If you find yourself wanting an operator inside `${…}`, that's the
signal to switch braces.

## Cheat sheet

| Want | Token | Resolves where |
|---|---|---|
| Substitute a value into a string | `${trigger.data.userName}` | Layer 1 (Go) |
| Pluralize / pick on a value | `{event.data.amount > 1 ? 'bits' : 'bit'}` | Layer 2 (TS) |
| Concatenate text + value | `"${trigger.data.userName} just followed!"` | Layer 1 |
| String concatenation inside an expression | `{event.data.userName + ' (mod)'}` | Layer 2 |
| Color-emphasised text | `"{primary}…{primary}"` | Layer 2 (color tag pass) |
| Combine substitution + expression | `{primary}${trigger.data.userName}{primary} gifted {event.data.amount > 1 ? 'subs' : 'sub'}` | Layer 1 → Layer 2 |
| Read an event field | `${trigger.data.X}` (Layer 1) or `{event.data.X}` (Layer 2) | depends on layer |
| Read an env var | `${env.NAME}` | Layer 1 only |
| Read another task's export | `${<taskId>.X}` | Layer 1 only |

## See also

- Upstream layer + the precedence rules: [Workflow expressions](../workflow/expressions.md).
- Where a MediaWidget alert envelope comes from: [Tasks → builtin:action:alert](../workflow/tasks.md).
- Wire format for alert delivery: [Widget events](../services/widget-events.md).
