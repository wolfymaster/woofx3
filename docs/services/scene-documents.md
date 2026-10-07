# Scene documents

A saved scene reaches every overlay showing it, in OBS or in the editor's
preview, as a few small ops applied in place: nothing reloads, and only the
widgets a save touched change.

## The document

sceneManager holds each scene an overlay has open as a JSON document:

```json
{
  "layout": { "backgroundColor": "transparent" },
  "widgets": {
    "w_8f2c": {
      "widget": "woofx3:widget:text",
      "x": 120, "y": 80, "width": 640, "height": 120,
      "visible": true,
      "z": "a0000",
      "settings": { "text": "Thanks for the raid!", "color": "#ffffff" }
    }
  }
}
```

Widgets are keyed by placement id, so editing one never shifts another's
path, and `z` is a stacking key that sorts as text, bottom first. What a
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

## Starting and catching up

The scene page is rendered with the scene's snapshot (`{ sceneId, seq, doc,
meta }`), and `GET /scene/{id}/config` returns it beside the config. Every
event stream opens with a `hello` carrying the sequence number the overlay
should be at. An overlay resyncs from `/config` when that number differs
from its own, when an event's number is not the next one, or when ops fail
to apply.

Nothing here is persisted: the database stays the scene's record, and
sequence numbers start again at 0 when sceneManager restarts, which reloads
every overlay anyway (see the stream's boot id).
