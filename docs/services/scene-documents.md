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

Meta is worked out by asking barkloader for the widget's frame. When it
fails, times out or gives no frame, the placement gets an unversioned frame
URL and no `mediaProxyBase`, while the frame itself may later be served
under the theme policy, which would block its external media. Such a
placement is framed again a while later (10 s, doubling up to 5 minutes,
while anyone has the scene open), and the meta barkloader's answer brings
is committed as an `external` entry that carries only meta: overlays get
it as a `scene-ops` event with no ops, so the page swaps in the versioned
frame and gets the placement's media pointed at the proxy. An
edit to such a placement does not ask barkloader again, so edits never wait
on it while it is down; it is left to that retry. Barkloader has 5 s to
answer a frame request, after which it counts as failed.

The document and its ops are shared with the dashboard's scene editor in the
api package (`@woofx3/api/scene-editor/document`);
`public/scene-manager/scene-document.ts` re-exports them for the page and the
server and adds the page's own `configOfSnapshot`.

## Ops

A change is a list of [json0](https://github.com/ottypes/json0) op
components: a path into the document and what changes there.

| Change | Op |
| --- | --- |
| Move or resize | replace `["widgets", id, "x"]` (and `y`, `width`, `height`) |
| A setting | replace `["widgets", id, "settings", key]`, or deeper |
| Text | a splice: `{ "p": [..., "text", 15], "si": "big " }`, and `sd` to delete |
| Add or remove a widget | insert or delete `["widgets", id]` |

## Sequencing

Every change to a scene goes through one serial queue per scene and the
scene editor's sequencer (`@woofx3/api/scene-editor/sequencer`): it is
prepared without touching anything, then, once the placement meta it needs is
worked out, committed in one synchronous step as an entry of the scene's log.
An entry has a scene-wide number `v` and an id `${epoch}.${v}`, where the
epoch is drawn at random each time the scene is loaded, so an entry lost in a
crash and the one that later takes its number differ. A change that touches
both versions (a live edit and its copy into the draft, a publish, a discard)
is one entry. The log keeps the most recent 1000 entries (512 KB of ops).

Overlays do not see `v`. Each version keeps its own overlay sequence number,
bumped by every entry that changes that version's ops or meta, and the
`scene-ops` event is `{ version, seq, ops, meta }` as before.

## A save made elsewhere

1. The db publishes `db.scene.updated.{id}`.
2. `SceneDocuments` loads the saved published scene and diffs it against the
   one it holds. When it differs (in documents or meta), the change is
   committed as an `external` entry, copied into the draft when the scene has
   none.
3. Overlays get it as a `scene-ops` event for each version it changed:
   `{ version, seq, ops, meta }`, where `meta` holds the placements whose meta
   changed (null for one removed). Editors get the entry.
4. Each overlay applies the ops to its copy and runs the same update plan a
   config uses, so a widget whose settings changed is patched in or swapped
   for a fresh frame (see [Live settings](../barkloader/sdk.md#live-settings)).

A save of a scene nobody has open does nothing: the next overlay or editor to
open it loads it fresh. A save that lands while this process has document
changes it has not written yet loses to them (their write replaces it), and
the echo of this process's own write changes nothing. A workflow step
(`engine.scene.command`) is committed the same way, as an `external` entry on
the published scene, always copied into the draft.

## Editors

The dashboard's scene editor talks to sceneManager directly, over a websocket
at `/scene/{id}/edit?token=…&protocol=2`, protocol 2 of
`@woofx3/api/scene-editor/protocol` (capability `scenes.editorSync`). It gets
a token for one scene from the api (`getSceneEditorSession`), which asks
sceneManager for it over NATS (`engine.scene.editor-token`). The token carries
an edit scope and lives five minutes: it is presented once, when the socket
opens. An overlay's session never opens the editor. A socket without
`protocol=2` is answered with HTTP 426; a dashboard that only speaks protocol
1 falls back to saving with `updateScene`.

### Messages

From the editor:

| Message | Fields | Meaning |
| --- | --- | --- |
| `hello` | `protocol: 2, clientId, have: {v, id} \| null, name` | First message on every socket. `have` is the last entry the editor applied. |
| `item` | `seq, base, body` | One change: `{kind: "edit", version, ops}`, `{kind: "publish"}` or `{kind: "discard"}`, made against entry `base`. |
| `presence` | `selection, version` or `away: true` | What the editor has selected; `away` hides it while it drains before closing. |

From sceneManager:

| Message | Meaning |
| --- | --- |
| `welcome` | The answer to `hello`: the editor's watermark (`last`, its last decided `seq` and outcome), then either `catchup` (the entries after `have`) or a `snapshot` of both versions with `diverged`. |
| `entry` | Every committed change, to every editor; the submitter's own (`src` is its `clientId` and `seq`) is its answer. |
| `ack` | The item committed nothing: it transformed away, or it is a resend of one already applied. |
| `nack` | The item was refused, and nothing changed: `code` and `retryable`. |
| `presence` | Another editor's selection, by `clientId`, or `left: true`. |
| `error` | The session ends: `not_found` (close 4404), `protocol` (4400) or `unsupported_protocol` (4426). |

Every message is handed to the scene's serial queue as it arrives, and every
answer is sent inside the step that decides it, so per socket an editor sees
every entry up to the head a decision saw before the answer to it. A second
socket saying `hello` with the same `clientId` closes the first with 4409.

### Exactly once

Each editor keeps one ordered queue across both versions and has at most one
item in flight. Every item carries its `(clientId, seq)`, and the scene keeps
each client's watermark: the last seq it decided and whether it was applied
or refused. An item at or below the watermark is a resend: it is answered
`ack` when applied, or with the refusal it got, and is not applied again. An
item made against an older entry is transformed through the entries after
its base first (json0), so editors working at once converge: two people
typing in one text field both keep their typing.

| `nack` code | Retryable | When | The editor |
| --- | --- | --- | --- |
| `invalid` | no | Ops outside the document's shape, that do not apply, or too large. Recorded in the watermark. | Rolls the edit back, or drops the command, and reports it. |
| `stale_base` | yes | `base` is not in the log. | Reconnects; the welcome's snapshot moves its queue across. |
| `unavailable` | yes | Something failed before the commit (loading the scene, or sceneManager is shutting down). | Resends the same seq after a backoff. |

Placement meta that cannot be worked out (framing fails) never refuses an
item: the entry goes without it, and the placement is framed again with the
next change.

### Reconnecting

On `hello`, an editor whose `have` is the head or an entry still in the log
gets the entries after it; any other gets a snapshot. `diverged` is set when
the editor applied an entry this scene does not have (one past the head, or
a different id at that number): changes it saw were lost, and it rebases its
queue onto the snapshot field by field (last writer wins per field) and tells
its user. The watermark in the welcome settles the item that was in flight.

### Presence

Editors tell each other who they are and which widget each has selected,
keyed by `clientId`. It is relayed between the scene's open editors and kept
nowhere: a newcomer is told the others' current selections, and an editor
that closes the scene, or goes `away`, clears its own.

## Drafts and live editing

Edits go to the draft by default: the editor's preview (`?view=draft`)
shows it, and OBS keeps showing what is published. A `publish` item applies
the draft to the published scene as ordinary ops, so overlays update in
place; `discard` applies the published scene back to the draft. Both are
queue items like edits, so a publish includes every edit its editor made
before it, and each always commits an entry, even with nothing to change.

An editor can instead edit the published scene directly (live editing): its
ops then reach OBS as they are made, and in the same entry each is copied
into the draft field by field, so a later publish cannot undo it and the
draft keeps its other edits.

## Writing back

There is no save button. A scene is written back at most two seconds after
its first unwritten change, in one `UpdateScene`: the published scene
(`widgets_json`, `layout_json`), the draft (`draft_widgets_json`,
`draft_layout_json`, or `clearDraft` when there is none) and the editor state
(`editor_state_json`: the head `v` and its id, each client's watermark kept
for 30 days and at most 500 clients, and a digest of both documents). A
failed write is tried again with the next window. A scene is dropped from
memory only when nothing is open on it and nothing is waiting to be written.

On shutdown, `close()` stops taking items (later ones are answered
`unavailable`, so editors resend them to the next process), lets the queues
finish, and writes every scene still waiting, trying each up to three times.

## Restarts

Overlays: every event stream opens with a `hello` carrying the sequence
number the overlay should be at. An overlay resyncs from `/config` (which
returns the snapshot `{ sceneId, seq, doc, meta }` beside the config) when
that number differs from its own, when an event's number is not the next one,
or when ops fail to apply. Overlay sequence numbers start again at 0 when
sceneManager restarts, which reloads every overlay anyway (see the stream's
boot id).

Editors: a load resumes the stored head when the documents it reads are the
ones the stored state was written with (the digest matches). After a graceful
restart, an editor at the head gets an empty catch-up and resends its item in
flight, which the restored watermark answers once. When the documents read
differ (a placement the store does not keep exactly as the editor had it),
the head moves one past the stored one, so every editor takes a snapshot
quietly; the watermarks are kept. With no stored state (never synced, or
cleared by a save made elsewhere) or one that does not parse (logged as an
error), the scene starts from head 0 under a new epoch. A crash loses what
was committed since the last write; editors that had it are told their
history diverged.

The scene row's `editor_state_json` column holds that state: a JSON object
the engine owns, stored as text so it reads back exactly as written.
`UpdateScene` stores it in the same row update as the documents and draft
named in the request, and refuses (writing nothing) a value that is not a
JSON object. A request without it leaves it unchanged, unless the request
writes a document (widgets, layout, draft or `clearDraft`): the stored state
then describes documents that were replaced, so the db proxy clears it in the
same write. `clearEditorState` clears it on purpose; it cannot be combined
with a new value. `UpdateScene` writes only the columns a request names, so
concurrent writers of different columns (an editor's autosave, a rename) do
not overwrite each other. Overlay scene state never carries it:
`OverlayHost.loadEditableScene` reads both versions and the editor state from
one read of the row, for the scene documents alone.

## What overlays see

Overlays get the document with the external media values of themeable
placements (those whose meta has a `mediaProxyBase`) pointed at the
engine's media proxy (see [External media](./asset-delivery.md#external-media));
editors get it as entered. The snapshot in the page and `/config` is that
view. In a `scene-ops` event, a placement whose view is rewritten, before or
after the change, is sent whole as overlays see it, in place of the ops
made to it: a splice into a media value's `url` only applies to the value as
entered. A placement whose meta changed is checked the same way. Ops for
every other placement, and for the layout, are sent as made, so the work is
limited to the placements a change touches.

## Tests

- `shared/clients/typescript/api/tests/scene-editor/*.test.ts` cover the shared
  core on its own: documents and ops, the protocol decoders, the sequencer
  (including an external change that carries only placement meta), rebasing
  pending edits onto a snapshot (touched fields are replaced whole, so text
  two editors rebased concurrently is never spliced into a value neither
  wrote), the client, and clients and sequencer together.
- `sceneManager/tests/scene/scene-documents.test.ts` drives the real
  `SceneDocuments` over an in-memory scene store
  (`tests/scene/fake-scene-store.ts`, which applies writes the way the db
  proxy does) on a controlled clock: items and their answers, saves made
  elsewhere (a meta-only one included, and a refresh whose read fails, which
  never rejects), editors reconnecting, writing back and its retries
  (`close()` retrying a write that fails at shutdown), and restarts.
- `sceneManager/tests/routes/editor.test.ts` covers the editor socket:
  upgrade, session errors and presence.
- `sceneManager/tests/scene/media-proxy.test.ts` covers what overlays see
  of a document (proxied media, placements resent whole) and placements
  framed again after barkloader gave no frame.
