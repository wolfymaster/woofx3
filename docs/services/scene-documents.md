# Scene documents

Every change to a scene, whether an editor's edit or a save, reaches every
overlay showing it, in OBS or in the editor's preview, as a few small ops
applied in place: nothing reloads, and only the widgets a change touched
change.

## The document

sceneManager holds each scene an overlay or editor has open as two JSON
documents, the published scene overlays show and the editor's draft (see
[Drafts](#drafts-and-live-editing)), each like this. An alert composition
is held and edited the same way (see [Scenes and alerts](#scenes-and-alerts)):

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
  },
  "behaviors": {
    "b_19ad": {
      "type": "transition",
      "kind": "slide",
      "target": "w_8f2c",
      "order": "a0",
      "timing": { "anchor": "enter", "offsetMs": 0, "durationMs": 400, "easing": "ease-out" },
      "params": { "phase": "in", "direction": "up" }
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

Behaviors are keyed by id like widgets, and act on a widget (`target` is its
placement id) or on the whole canvas (`"canvas"`): `transition` plays as its
target enters or exits (`params.phase` is `in` or `out`), `effect` modifies
it for a while, and `activity` is the window in which it is active. `kind` is
a host kind the overlay plays on the widget's box (a transition's `fade`,
`slide`, `zoom`, `bounce`, `spin`, `pop`, `blur`; an effect's `shake`,
`pulse`, `float`, `glow`, `flash`, `blur`) or a kind the widget declares
for itself in its manifest's `transitions` or `effects`, a lowercase token
(`typewriter`), which the widget plays. `timing` is
anchored rather than absolute: `anchor` (`start`, `end`, `enter`, `exit`,
`complete`), `offsetMs`, `durationMs` (or `"until-exit"`), `easing`, and for
`complete` optionally the `node` whose completion counts. A behavior whose
target no longer exists is skipped where it is played.

A document stored or sent without `behaviors` (one written before
compositions had them) is given an empty collection wherever a document is
parsed: `parseSnapshot`, the editor welcome's snapshot, and sceneManager's
load. The sequencer refuses to start from a document that lacks it. A
composition's `inputs` and `base` are part of the same type, but the scene
editor never changes them: an edit that does is refused. Inputs are set
where the composition is managed (`createAlertComposition`,
`updateAlertComposition`), and reach open editors as an `external` entry
replacing `inputs` whole (`invalidExternalOps`), the one change an external
entry may make that an edit may not. They are not drafted: both versions
declare the stored inputs, and a document whose composition declares none
has no `inputs` key.

The document's types come from the scene package's model
(`@woofx3/scene/model`, `shared/clients/typescript/scene/model/types.ts`);
`SceneDocument` is its `CompositionDocument`. The document's ops are shared
with the dashboard's scene editor in the api package
(`@woofx3/api/scene-editor/document`);
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
| Add or remove a behavior | insert or delete `["behaviors", id]` |
| Delete a widget with its behaviors | delete `["widgets", id]` and each `["behaviors", id]` targeting it, in one change (`withoutWidget` in the model) |
| A behavior's kind, target or order | replace `["behaviors", id, "kind"]` (and `target`, `order`) |
| A behavior's timing | replace `["behaviors", id, "timing", "offsetMs"]` (any timing field; `node` may also be inserted or removed) |
| A behavior's param | insert, delete or replace `["behaviors", id, "params", key]`, or deeper |
| The inputs (an `external` entry only, never an edit) | insert, delete or replace `["inputs"]` whole |

## Entry types and validation

What a valid entry of `widgets` or `behaviors` is, and how each of its
fields may change, is decided by the scene model's type registry
(`shared/clients/typescript/scene/model/registry.ts`). Each collection fixes
the fields every entry has and the grain each field changes at, which the
diff, the validation and the field-by-field copies (live edits into the
draft, rebasing onto a snapshot) all read:

| Grain | Fields | Changes as |
| --- | --- | --- |
| fixed | a behavior's `type` | only with the whole entry |
| value | a placement's position, size, `z`, `widget`, flags; a behavior's `kind`, `target`, `order` | replaced whole |
| text | a placement's `name` | replaced whole, or text splices |
| freeform | a placement's `settings`, `extra` | key by key at any depth, text spliced |
| keyed | a behavior's `params` | key by key at any depth, values replaced whole |
| struct | a behavior's `timing` | field by field, each replaced whole |

Entity types add what depends on the type: a placement is a `widget`; a
behavior's `type` picks `transition` (a duration from 50 to 10000 ms, a
`phase`, and a `direction` for a `slide`), `effect` (some duration, and its
host kind's params) or `activity` (never on the canvas). Types also carry
defaults for new entries and migrations from older shapes: a placement that
kept its transitions as `transitionIn` and `transitionOut` in `extra` has
them lifted into transition behaviors. Whether a widget actually declares a
widget kind depends on what is installed, so it is checked where the catalog
is known, not by the registry: the strict registry accepts any well-formed
kind that is not a host kind as the widget's own.

The catalog's declared kinds (`widgets.behavior_kinds`, see
[Widget entry](../barkloader/modules.md#declared-behavior-kinds)) reach each
placement's meta as `behaviorKinds: { transitions: string[], effects:
string[] }`, ids only. The overlay plans with them
(`PlanOptions.declaredKinds` in @woofx3/scene's runtime/plan.ts): a behavior
of a widget kind its widget does not declare is skipped, reported once as
`undeclared-kind` in the page's console, and never sent to the frame; a
placement whose meta has no `behaviorKinds` (its widget is not in the
catalog, or the catalog could not be read) declares none. Host kinds need no
declaration. An alert is checked when it is dispatched: `parseAlertLayout`
drops such a behavior with a reason (`the widget ... does not play the
transition "wave"`), like any other behavior the engine cannot play, so a
delivered alert holds only kinds its widgets play.

A registry is strict or tolerant. sceneManager validates every item with the
strict one: an entry of a type it does not know, or with a field (or a host
kind's param) it does not know, is refused, so it never stores what it
cannot play. Editors check their own edits with the tolerant one, which
accepts entries of unknown types and unknown fields as they are, so an
editor older than the engine keeps what it cannot read through the edits it
makes around it; the engine checks those edits again. `compositionJsonSchema`
emits the registry's rules as a JSON Schema (draft 2020-12) for checking a
composition without this code, such as one a module ships.

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
(`widgets_json`, `layout_json`, `behaviors_json`), the draft
(`draft_widgets_json`, `draft_layout_json`, `draft_behaviors_json`, or
`clearDraft` when there is none) and the editor state
(`editor_state_json`: the head `v` and its id, each client's watermark kept
for 30 days and at most 500 clients, and a digest of both documents). A
failed write is tried again with the next window. A scene is dropped from
memory only when nothing is open on it and nothing is waiting to be written.

Behaviors are stored as a JSON object keyed by behavior id, in their own
columns, so they survive restarts and a save made elsewhere carries them like
any other part of the document (capability `scenes.behaviors`). A draft's
behaviors are stored with its widgets and layout and cleared with them; a
draft written without behaviors has none. `inputs_json` is never written by
sceneManager: the api writes it, and sceneManager takes it in from the save
(see [The document](#the-document)).

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

The digest covers the whole of both documents, behaviors and inputs
included, so a load resumes the head only when they read back as written.

The scene row's `editor_state_json` column holds that state: a JSON object
the engine owns, stored as text so it reads back exactly as written.
`UpdateScene` stores it in the same row update as the documents and draft
named in the request, and refuses (writing nothing) a value that is not a
JSON object. A request without it leaves it unchanged, unless the request
writes a document (widgets, layout, draft or `clearDraft`): the stored state
then describes documents that were replaced, so the db proxy clears it in the
same write; `behaviors_json`, `draft_behaviors_json` and `inputs_json` are
documents in this sense too. `clearEditorState` clears it on purpose; it cannot be combined
with a new value. `UpdateScene` writes only the columns a request names, so
concurrent writers of different columns (an editor's autosave, a rename) do
not overwrite each other. Overlay scene state never carries it:
`OverlayHost.loadEditableScene` reads both versions and the editor state from
one read of the row, for the scene documents alone.

## Scenes and alerts

A row of the scenes table holds a composition of one of two kinds, fixed
when it is created (`kind`, migration `0060_scene_compositions`):

- `scene`: shown by overlays, in OBS and in the editor's preview.
- `alert`: a composition workflow and chat command steps play by id, always
  its latest published version. It is never an overlay page.

Names are unique per kind. Both are edited through the same editor socket,
sequencer, drafts and autosave; `getSceneEditorSession` takes either id.
Everything that serves or lists scenes reads only `scene` rows:

| Reader | How |
| --- | --- |
| `ListScenes` (db) | Lists `scene` rows unless asked for `kind: "alert"`, so every caller that predates alerts sees scenes only. |
| `getScenes`, `getScene`, `updateScene`, `deleteScene` (api) | Scenes only: `getScene` is null for an alert, `updateScene` and `deleteScene` refuse one. |
| Overlay tokens | `MintOverlayToken` refuses an alert, so no browser-source URL addresses one. |
| `/scene/{id}?token=…` (sceneManager) | `loadScene` serves no page for a token that resolves to an alert; every other overlay route needs the session that page mints. |
| Alert fan-out (`fanOutAlert`) and the alert queue controls | Skip anything that is not a scene. |
| `scene.*` webhooks | Carry `kind` (and the behaviors and inputs) in the snapshot, and `kind` on delete, so a dashboard cache of scenes skips alerts. |

The OBS integration names OBS's own scenes and never reads this table.

The api serves alerts apart from scenes (capability `compositions.alerts`):
`listAlertCompositions`, `getAlertComposition`, `createAlertComposition`,
`updateAlertComposition` (name, description and inputs; the document is
edited through the socket), `deleteAlertComposition` and
`listCompositionLinks`.

### Composition links

`composition_links` (migration `0061_composition_links`) records which step
plays which alert: `composition_id`, `owner_kind` (`workflow` or
`command`), `owner_id`, `step_id`, and when the link was made and last
changed. A step plays at most one composition.

The links are derived from the definitions and kept by the db proxy where it
stores them: `CreateWorkflow`, `UpdateWorkflow`, `CreateCommand` and
`UpdateCommand` replace the owner's links in the same transaction as they
write its steps (a command's `actions_json`), and `DeleteWorkflow` and
`DeleteCommand` remove them. A link is one `alert` step whose
`parameters.composition` names a composition; a step is named by its `id`,
or by its position (`step[2]`) when it has none. The save is refused with
`invalid_argument`, and nothing is written, when such a step names something
that is not an id, a composition that does not exist, or one that is not an
alert, or when two of them share a step id. An unchanged link keeps its row.
There is no RPC that writes links, so no caller can let them drift from the
steps. `SceneService` reads them:

| RPC | Does |
| --- | --- |
| `ListCompositionLinks` | The steps that play a composition, by owner kind, owner id and step. |
| `CountCompositionLinks` | How many. |

Deleting an alert that still has links is refused (`failed_precondition`,
naming the steps; the foreign key refuses it too), and
`deleteAlertComposition` answers `{ success: false, links }` so the
dashboard can say where it is used.

### Alerts played from a composition

An `alert` step that names a composition (see
[Tasks → alert](../workflow/tasks.md#alert)) reaches the scene manager as
`{ composition, inputs }` in the envelope's `parameters`, with every `${...}`
in the inputs already resolved by the workflow engine. Before anything is
delivered, `dispatchAlert` (`sceneManager/src/events/alert-dispatch.ts`, with
`alert-composition.ts`):

1. **Materializes** it: `SceneDocuments.published` gives the composition's
   published document as the documents hold it (live edits included, loading
   the row when it is not held) and its kind. A missing composition or a
   scene fails the alert.
2. **Binds** the inputs with `bindInputs` from `@woofx3/scene/model`: each
   `{ "$input": "id" }` becomes the value as it is and each `{{id}}` in text
   the value as text; an input with no value takes its default. An input with
   neither, a reference to an undeclared input or a malformed reference fails
   the alert, naming them. Values for undeclared inputs are logged and
   ignored.
3. **Validates** the bound document with `STRICT_REGISTRY`: a canvas with a
   positive size, and every widget and behavior a valid entry of a known type.
4. **Records** it on the alert's log row with `RecordAlertComposition`:
   `composition_id`, `composition_version` (a digest of the published
   document, the same for equal documents across restarts, see
   `documentVersion`) and `snapshot_json`, the bound document with no inputs
   left in it (migration `0062_alert_composition_snapshot`). Once per row;
   best-effort like the row itself.
5. **Plays** it through the same catalog validation, fan-out, delivery and
   queueing as an inline layout, so an alert widget cannot tell the two
   apart.

A failure at any step marks the row `failed` with the reason, as an unusable
inline layout does.

**Replay** (`replayAlert` in `alert-controls.ts`) of such an alert plays
`snapshot_json` and never loads the composition again, so it shows what the
original showed even after the composition was edited or deleted. The
replay's own row carries the same composition, version and snapshot
(`CreateAlert` takes them). A row whose envelope names a composition but has
no snapshot (the alert was refused before it was bound, or had no row to
record on) is not replayed. Replaying a workflow run is different: it runs
the step again, so it binds the composition's current published version
afresh.

A `scene.widget.visibility` step refuses an alert composition: it is not
running anywhere, and changing one of its widgets would change every later
play of it, which is an edit for the editor.

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

- `shared/clients/typescript/scene/tests/*.test.ts` cover the model: the
  registry in both modes (placements, each behavior type, field and timing
  changes, defaults, migrations, `withoutWidget`) and the emitted JSON
  Schema, checked against documents the registry accepts and refuses.

- `shared/clients/typescript/api/tests/scene-editor/*.test.ts` cover the shared
  core on its own: documents and ops (behaviors included), the protocol
  decoders, the sequencer
  (including an external change that carries only placement meta), rebasing
  pending edits onto a snapshot (touched fields are replaced whole, so text
  two editors rebased concurrently is never spliced into a value neither
  wrote), the client, and clients and sequencer together.
- `shared/clients/typescript/api/tests/scene-editor/sequencer.test.ts` also
  covers inputs: an external change replaces them, an edit never does.
- `db/app/services/scene_composition_test.go` covers kinds, behaviors and
  inputs in the scene service, listing by kind, composition links and the
  refused delete, and an overlay token refused for an alert;
  `composition_link_owners_test.go` covers workflow and command saves keeping
  their links and refusing a step that plays no stored alert;
  `alert_composition_test.go` covers recording what a play showed;
  `db/database/migrate/migrations/sqlite/0060_*_test.go` and `0061_*_test.go`
  cover the migrations.
- `sceneManager/tests/events/alert-controls.test.ts` covers playing a stored
  composition (bound, recorded, delivered), each refusal, and replaying the
  recorded document.
- `api/tests/compositions.test.ts` covers the alert routes and that the scene
  and alert routes never touch each other's rows.
- `sceneManager/tests/scene/scene-documents.test.ts` drives the real
  `SceneDocuments` over an in-memory scene store
  (`tests/scene/fake-scene-store.ts`, which applies writes the way the db
  proxy does) on a controlled clock: items and their answers, saves made
  elsewhere (a meta-only one included, and a refresh whose read fails, which
  never rejects), editors reconnecting, writing back and its retries
  (`close()` retrying a write that fails at shutdown), restarts, and
  behaviors and inputs: loaded per version, written back (inputs never),
  kept across a restart, and taken in from a save made elsewhere.
- `sceneManager/tests/scene/scene-host.test.ts` covers loading kinds,
  behaviors and inputs, and that no page is served for an alert;
  `sceneManager/tests/events/alert-controls.test.ts` that an alert
  composition never receives an alert.
- `sceneManager/tests/routes/editor.test.ts` covers the editor socket:
  upgrade, session errors and presence.
- `sceneManager/tests/scene/media-proxy.test.ts` covers what overlays see
  of a document (proxied media, placements resent whole) and placements
  framed again after barkloader gave no frame.
