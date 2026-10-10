# Widget transitions

A widget on a scene or in an alert layout can enter and leave with an
animation: fade in when it is shown, slide out when it is hidden, type its
text in letter by letter when an alert starts. A transition belongs to the
placement, not to the widget's code. The scene or the alert layout says how
each placement enters and leaves, and the page that hosts the widget plays it.

## On a placement

A placement carries up to two transitions, each optional:

```json
{
  "id": "w_8f2c",
  "widgetCanonicalId": "woofx3:widget:text",
  "transitionIn": { "type": "typewriter", "durationMs": 1200 },
  "transitionOut": { "type": "slide", "durationMs": 400, "direction": "down", "easing": "ease-in" }
}
```

| Field | | |
| --- | --- | --- |
| `type` | required | A generic type (below), or one the placed widget declares |
| `durationMs` | required | A whole number of milliseconds, 50 to 10000 |
| `easing` | optional | `linear`, `ease`, `ease-in`, `ease-out` or `ease-in-out`. Defaults to `ease-out` entering and `ease-in` leaving |
| `direction` | slide only | `up`, `down`, `left` or `right`, the way the widget moves. Defaults to `up` |

An absent transition means the placement simply appears and disappears. Any
other field is refused, so a misspelling is caught where it is written. The
shape is defined once, in the module SDK's
`shared/clients/typescript/module-sdk/src/widget-transitions.ts`, and
sceneManager checks it there:

- A scene editor's op that sets a transition to anything else is refused, and
  so is an op inside one (a new `durationMs`) that leaves it invalid (see
  [Scene documents](./scene-documents.md)).
- An alert layout widget whose transition does not parse, or names a type the
  widget does not declare, is dropped from the alert with that reason, as any
  other mistake in a layout is.
- A stored placement whose transition does not parse plays none, with a
  warning, rather than not appearing.

## Generic transitions

Every widget can enter and leave with these. The page plays them on the
placement's box (its frame, or an alert widget's area) with the Web
Animations API, so the widget never knows.

| Type | Entering | Leaving |
| --- | --- | --- |
| `fade` | fades in | fades out |
| `slide` | slides its own size in, from the side opposite `direction`, fading in | slides out toward `direction`, fading out |
| `zoom` | grows from half size | shrinks to half size |
| `bounce` | springs up from small, overshooting | the reverse |
| `spin` | spins a full turn while growing from nothing | the reverse |
| `pop` | pops from nothing, overshooting | the reverse |
| `blur` | comes into focus | blurs away |

Each also fades, so the placement is never visible at the start of an
entrance or the end of a leave.

## A widget's own transitions

A widget can declare types that animate its content, which only it can do: a
text widget revealing its letters one at a time. It lists them in its
manifest, beside the generic ones an editor offers:

```json
{
  "id": "text",
  "transitions": [
    { "id": "typewriter", "label": "Typewriter" },
    { "id": "wave", "label": "Wave" }
  ]
}
```

An id is a lowercase letter followed by up to 31 lowercase letters, digits or
`-`, and may not be a generic type or `none`. A widget that hosts a surface
(the alert widget) has no content of its own and declares none.

When a placement enters or leaves with one of these, the page tells the frame
(the `transition` message, or the boot payload for an entrance as the frame
loads), and the widget host shim marks the frame's root element:

| On `:root` | |
| --- | --- |
| `data-transition` | the type, `typewriter` |
| `data-transition-phase` | `in` or `out` |
| `--transition-duration` | `1200ms` |
| `--transition-easing` | `ease-out` |

The widget's own CSS animates from these, so it needs no script for it:

```css
:root[data-transition="typewriter"][data-transition-phase="in"] .letter {
  animation: show 1ms linear both;
  animation-delay: calc(var(--transition-duration) * var(--i) / var(--n));
}
```

The page clears the mark when the placement next enters with a generic
transition or none, and plays a type again by clearing and setting it, so its
CSS animations restart. It does not wait for the widget: a placement leaving
with one of the widget's types is hidden once `durationMs` has passed.

The bundled Text widget declares `typewriter` (typed in, backspaced out),
`letters` (each letter fades in rising, and out the same way) and `wave`
(each letter springs up into place, and drops away).

## When they play

**On a scene.** A placement enters when it is shown: when the overlay loads,
when it is added, and when it is made visible (by the editor, or a workflow's
`set_placement_visibility`). A generic entrance on a frame waits for the frame's
first paint, so it never plays on an empty box. A placement leaves when it is
hidden or removed, and is hidden or removed only once its out-transition has
finished. Shown again while it is leaving, it comes straight back.

**In an alert.** Each layout widget enters as the alert starts. A widget with
a length of its own (one that subscribes with `autoComplete: false`, such as
Text with a duration, or a video) leaves with its out-transition as soon as it
completes. The rest leave together when the alert is over, and the alert is
reported finished, letting the next one start, only once they are all gone.
So a widget with a length no longer hides itself when it is done: completing
is what takes it off screen.

## Where it lives

| | |
| --- | --- |
| The shape, the frame mark | `shared/clients/typescript/module-sdk/src/widget-transitions.ts` |
| The page's animations | `sceneManager/public/scene-manager/transitions.ts` |
| Scene placements | `sceneManager/public/scene-manager/index.ts`, `src/scene/scene-documents.ts` |
| Alert layouts | `sceneManager/public/scene-manager/alert-widget.ts`, `src/scene/alert-layout.ts` |
| A widget's declared types | manifest `widgets[].transitions`, stored in `widgets.transitions` |
