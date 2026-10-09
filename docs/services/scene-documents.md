# Scene documents

Every change to a scene, whether an editor's edit or a save, reaches every
overlay showing it, in OBS or in the editor's preview, as a few small ops
applied in place: nothing reloads, and only the widgets a change touched
change.

## The document

sceneManager holds each scene an overlay or editor has open as two JSON
documents, the published scene overlays show and the editor's draft (see
[Drafts](#drafts-and-live-editing)), each like this:

```json
{
  "layout": { "backgroundColor": "transparent" },
  "widgets": {
    "w_8f2c": {
      "widget": "woofx3:widget:text",
      "x": 120, "y": 80, "width": 640, "height": 120,
      "visible": true,
      "z": "a0000",
      "settings": { "text": "Thanks for the raid!", "color": "#ffffff" },
      "name": "Raid banner", "rotation": 0, "opacity": 1, "locked": false,
      "extra": {}
    }
  }
}
```

Widgets are keyed by placement id, so editing one never shifts another's
path, and `z` is a stacking key that sorts as text, bottom first. `name`,
`rotation`, `opacity` and `locked` are the editor's, and `extra` keeps any
other field a placement was stored with, so writing the document back loses
nothing. `opacity` is a fraction from 0 (transparent) to 1 (opaque), as in
CSS, both in the document and in the stored placement. What a
placement needs on the page that depends on what is installed rather than on
the scene (its frame URL, linked resources, whether it is an alert area) is
kept beside the document as each placement's meta.

The document lives in `public/scene-manager/scene-document.ts`, the page's
wire format; the server imports it from there.

## Ops

A change is a list of [json0](https://github.com/ottypes/json0) op
components: a path into the document and what changes there.

| Change | Op |
| --- | --- |
| Move or resize | replace `["widgets", id, "x"]` (and `y`, `width`, `height`) |
| A setting | replace `["widgets", id, "settings", key]`, or deeper |
| Text | a splice: `{ "p": [..., "text", 15], "si": "big " }`, and `sd` to delete |
| Add or remove a widget | insert or delete `["widgets", id]` |

## A save

1. The db publishes `db.scene.updated.{id}`.
2. `SceneDocuments` loads the saved scene, diffs it against the document it
   holds, and stamps the ops with the scene's next sequence number.
3. It pushes them to every overlay open on the scene as an SSE `scene-ops`
   event: `{ seq, ops, meta }`, where `meta` holds the placements whose meta
   changed (null for one removed).
4. Each overlay applies the ops to its copy and runs the same update plan a
   config uses, so a widget whose settings changed is patched in or swapped
   for a fresh frame (see [Live settings](../barkloader/sdk.md#live-settings)).

Saves of one scene are applied one at a time, in the order they arrive. A
save of a scene no overlay has open does nothing: the next overlay to open it
loads it fresh.

## Editors

The dashboard's scene editor talks to sceneManager directly, over a
websocket at `/scene/{id}/edit`. It gets a token for one scene from the api
(`getSceneEditorSession`, behind the `scenes.editorSessions` capability),
which asks sceneManager for it over NATS (`engine.scene.editor-token`). The
token carries an edit scope and lives five minutes: it is presented once,
when the socket opens. An overlay's session never opens the editor.

On open the editor gets both versions' snapshots. It sends `submit` with
json0 ops and the sequence number they were made against; ops applied since
are transformed in first, so editors working at once converge (two people
typing in one text field both keep their typing). Ops are refused when they
leave the document's shape: a path outside the layout or a placement, a
placement inserted incomplete, a field of the wrong type, or too much at
once. Every change is pushed to every editor, its own tagged with its op id,
and each submit is answered with `ack` or `reject`; a `resync` reject comes
with a fresh snapshot.

Editors also tell each other who they are and which widget each has
selected (`presence`), so the editor can show where others are working.
That is relayed between the scene's open editors as it is and kept nowhere:
a newcomer is told the others' current selections, and an editor that
closes the scene clears its own.

## Drafts and live editing

Edits go to the draft by default: the editor's preview (`?view=draft`)
shows it, and OBS keeps showing what is published. `publish` applies the
draft to the published scene as ordinary ops, so overlays update in place;
`discard` applies the published scene back to the draft.

An editor can instead edit the published scene directly (live editing): its
ops then reach OBS as they are made, and each is copied into the draft field
by field, so a later publish cannot undo it and the draft keeps its other
edits.

## Autosave

There is no save button. Each version is written back to the database two
seconds after its last change (`widgets_json` and `layout_json` for the
published scene, `draft_widgets_json` and `draft_layout_json` for a draft),
and on shutdown. The database's echo of that write is recognised and
ignored, and a save made elsewhere while edits wait to be written loses to
them.

## Starting and catching up

The scene page is rendered with the scene's snapshot (`{ sceneId, seq, doc,
meta }`), and `GET /scene/{id}/config` returns it beside the config. Every
event stream opens with a `hello` carrying the sequence number the overlay
should be at. An overlay resyncs from `/config` when that number differs
from its own, when an event's number is not the next one, or when ops fail
to apply.

Sequence numbers and the op window live in memory: they start again at 0
when sceneManager restarts, which reloads every overlay and reconnects every
editor anyway (see the stream's boot id). Only the documents are persisted,
through autosave.

The scene row also has a nullable `editor_state_json` column for the scene
editor's sync state, opaque to the db proxy. `UpdateScene` stores it in the
same row update as the documents and draft named in the request, and a
request without it leaves it unchanged. A loaded scene carries it as
`editorStateJson` (absent when the column is NULL), and a `SceneWrite` can
include it. The documents described on this page neither read nor write it.
