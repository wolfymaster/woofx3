# Theme packs

A **theme pack** is a module whose manifest carries only `themes` (plus
metadata and `requires`). It reskins a widget that declares a
[theme contract](../../docs/barkloader/modules.md#themes) and carries no code
of any kind: a theme entry rejects any property beyond the documented ones, so
there is nowhere to put a function, a script or markup.

`timer-neon/` is a complete, publishable pack for the bundled Timer widget.
Copy it and change the ids.

## What one contains

```
timer-neon/
  manifest.json          id, name, version, author, description, requires, themes[]
  README.md              becomes the listing's body in the marketplace
  themes/neon.css        loaded after the widget's own styles
  assets/grid.svg        fills an asset slot the contract declares
  assets/preview.svg     what a picker, and a storefront, shows for the theme
```

## The two rules that matter

**Target the widget, require its module.** A theme's `target` is
`{moduleId}:widget:{widgetId}`, and when that module is not this one, `requires`
must name it with a semver range:

```json
"requires": { "woofx3": ">=0.17.0" },
"themes": [{ "target": "woofx3:widget:timer", "contractVersion": 1, … }]
```

The engine refuses an install whose `requires` is unsatisfied, and refuses to
uninstall a module another one requires, so the dependency is real rather than
advisory. Validation happens at install (`lib_module::manifest_validate`), and
the error names the field.

**Match `contractVersion` exactly.** It is the widget's compatibility key,
independent of its module version. A theme built for another version renders as
the widget's own defaults rather than half-applying.

## Writing the CSS

The stylesheet is linked *after* the widget's own, so its rules win over the
defaults they restyle. Reach files through `var(--theme-asset-{id})`, never a
`url()` of your own: a themeable widget's frame is served with a
Content-Security-Policy that limits styles, fonts, images and media to the
engine's origins, so a `url()` or `@import` naming another host will not load.

Theme variables arrive as `--theme-{id}`. Write the widget's own CSS with the
same values as `var()` fallbacks and a widget already on screen is unchanged by
gaining a contract.

## Publishing

A theme pack publishes through the same path as any module — it *is* a module
archive, which is what lets it install with no special handling:

```bash
marketplace-cli publish examples/theme-packs/timer-neon
```

The marketplace then classifies it from what the manifest contains rather than
from a field you set: `themes` and no triggers, actions, functions, widgets,
workflows or commands makes it a **theme** listing. Adding so much as one
action makes it a module listing that happens to ship a theme — which is a
valid thing to publish, just not a theme pack.

The storefront reads `requires` to name the module a buyer needs installed
first, and prompts for it before offering to install the theme. See
`woofx3-marketplace-api`'s CLAUDE.md under "Listing types".
