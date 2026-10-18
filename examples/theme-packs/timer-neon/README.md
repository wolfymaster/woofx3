# Neon Timer

A neon look for the built-in Timer widget: glowing magenta text on a dark grid.

Needs the bundled `woofx3` module, which every engine has — the Timer widget
lives there. Install this, then pick **Neon** in the Timer widget's **Theme**
setting on any scene placement.

## What it changes

| | |
|---|---|
| Text | Heavier weight, uppercase, wide tracking, magenta glow |
| Box | Magenta border and a double glow, inside and out |
| Backdrop | A faint grid, through the contract's `backdrop` asset slot |

Nothing about the Timer's behaviour changes. It keeps counting the way it
always did, and a fix to the widget reaches this theme without republishing it.

## Files

- `themes/neon.css` — loaded after the Timer's own styles
- `assets/grid.svg` — fills the `backdrop` asset slot
- `assets/preview.svg` — what the theme picker shows
