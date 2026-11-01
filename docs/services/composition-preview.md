# Composition preview

The dashboard's alert editor shows the alert being edited as it will play: the
real runtime, real widget frames, a sample event, and a timeline the editor can
play, pause and scrub. An alert has no overlay page of its own (it plays inside
a scene's alert area, see [Scenes and alerts](./scene-documents.md#scenes-and-alerts)),
so sceneManager serves a page for exactly this: `/preview/composition`. It
plays whatever composition the page framing it posts, and saves nothing.

Capability: `compositions.preview`.

## Opening the page

| Step | What happens |
| --- | --- |
| 1 | The dashboard calls `getCompositionPreviewUrl()` on the api. |
| 2 | The api asks sceneManager over NATS (`engine.scene.composition-preview-token`, request/reply, no body). sceneManager mints a JWT with the `composition-preview` scope, good for 300 s, and answers `{ ok, token, expiresInSeconds, path: "/preview/composition" }`. |
| 3 | The api answers `{ url, expiresInSeconds }`, `url` being `{sceneManager public URL}/preview/composition?token=…` (the URL stored as `scene.publicUrl`, else the configured one). |
| 4 | The dashboard frames `url` directly, like the scene editor's preview: a page from a third site in between would make every request to sceneManager cross-site and drop the session cookie. |
| 5 | `GET /preview/composition?token=` verifies the token and serves the page with a session cookie (`sm_preview_session`, HttpOnly, 60 s, partitioned and cross-site over HTTPS so the desktop app can frame the page, SameSite=Strict otherwise), which the page refreshes every 50 s at `POST /preview/composition/session/refresh`. Any other token, an overlay's session or an editor's included, gets a blank 404 page. |

The tokens name no scene or composition, so neither verifies as an overlay's
session or an editor's token, and neither of those opens this page. Overlay
tokens never reach it: no browser-source URL can open it, and an alert still
has no overlay page. The URL token is presented once; ask for a new URL to load
the page again.

The session authorizes the one thing the page asks the engine for:
`POST /preview/composition/frames` with `{ widgets: [{ id, widget, settings }] }`.
It frames each widget as an overlay frames a placement (the widget's versioned,
cached frame document at `/frames/{moduleId}/{manifestId}`, its module's linked
resources, the behavior kinds it declares in the catalog) and signs the external media in its settings for the media proxy,
for widgets whose frames run under the theme policy (see
[External media](./asset-delivery.md#external-media)). Every external URL in the
posted settings is signed, where a scene's draft config signs only URLs already
in the scene's document: an overlay token is held by every browser source, this
session only by a dashboard holding the engine's client credentials. A widget
that matches nothing installed comes back as an `unknown-widget` problem, and
one an overlay draws itself (an alert area) as `unframed-widget`.

## Messages

The protocol is typed in `@woofx3/scene/runtime` (`preview-protocol.ts`), which
the dashboard imports too. Each side parses what it receives with
`parsePreviewCommand` or `parsePreviewReport`: neither throws, a message of
another protocol is `null`, and a malformed one is refused with a reason.

Only the window that frames the page can drive it (`event.source ===
window.parent`); opened top-level, the page does nothing. Reports go to the
origin the parent's messages came from, once it has sent one.

From the editor to the page:

| Type (`woofx3.composition-preview.…`) | Fields | Effect |
| --- | --- | --- |
| `load` | `loadId`, `profile` (`"alert"` or `"scene"`), `document`, `event?` (`{ type, data }`), `inputs?`, `autoplay?` | Bind `inputs` into the document (`bindInputs`, a missing input takes its default), frame its widgets, and mount them held at 0 ms, or update what is playing in place (see below). An alert may also be posted in the list shape a step stores inline. Entries the tolerant registry refuses are dropped and reported. A later load replaces this one, even while this one is still being framed. |
| `overrides` | `overrides` (by widget id: `x`, `y`, `width`, `height`, `rotation`, `opacity`, `z`), or `null` | Lay gesture state over the document without remounting anything; kept across `restart`. |
| `play`, `pause` | | Run or hold the playhead. `play` at the finish starts over. |
| `seek` | `ms` | Move the playhead, playing or paused as before. |
| `restart` | | Unmount every frame and play from the start with fresh frames, as an overlay would. |

From the page to the editor (every report but `ready` carries the `loadId` it
is about):

| Type | Fields | When |
| --- | --- | --- |
| `ready` | `protocol` (1) | Once, when the page is listening. |
| `timeline` | `timeline` (`ResolvedTimeline`), `durationMs` (an alert's finish, `null` for a scene) | After a load, and whenever it changes. |
| `playhead` | `ms`, `playing` | On every change of state, and every 100 ms while playing. |
| `finished` | `ms` | An alert played to its finish; the page holds there, paused. |
| `problems` | `problems` (`{ kind, id?, detail? }`); `loadId` is `null` for a message that did not parse | Whenever the set changes: `invalid-message`, `invalid-entry`, `bind` (nothing plays), `unknown-widget`, `unframed-widget`, `frames-unavailable`, `timeline` (a `TimelineProblemKind`), `plan` (a `PlanSkipReason`). |

## Playing and seeking

The page plays with the runtime an overlay uses (`createDomRenderer`,
`createScheduler`, the widget bridge, `entranceOf` and the behavior relay).
Like an overlay, it hands a widget only the behavior kinds the widget declares
(`declaredKinds`, from the framing answer), and reports any other widget kind
as a `plan` problem with detail `undeclared-kind`. Frames are put on the
profile's surface: an alert's widgets are told
`surface: "alert"` in their frame URL's fragment (see
[Widget events](./widget-events.md)). Frames are mounted at load and receive the
sample event when the playhead first runs, as an alert's frames receive theirs
when it starts.

The scheduler resolves the timeline with estimates, the same ones the editor
draws an alert's tracks with (`mediaLengthEstimates` in `@woofx3/scene/model`):

- A widget's length is its `settings.duration` in seconds.
- At 0 (or unset) a widget has no length of its own and is untimed, except a
  media widget (video, audio, Lottie), which plays its media through: when its
  settings carry the media's length (`mediaDurationSeconds`, a positive number
  of seconds, from the media's metadata) it is estimated as timed for that
  long. One set to `loop` runs as long as the alert and stays untimed.

Every time is
therefore known before anything plays, so the editor can scrub anywhere at once,
and the timeline holds still under the playhead. It runs on a clock that can
pause and jump (`preview-clock.ts`), and `Scheduler.resync()` re-plans after a
jump, reporting `finished` again when the playhead goes back before the finish.

What seeks exactly:

- Box layout, stacking, visibility and activity windows: planned for the
  playhead's time.
- Host transitions and effects (fade, slide, zoom, ...): Web Animations sharing
  one origin, with `currentTime` set to the playhead on every seek and pause.

What does not:

- **A widget's own content** runs in its frame on its own time: a video, a
  sound, text it typed in on the event. Pausing the preview does not pause it,
  and seeking does not move it. `restart` is the way to see it again.
- **Behaviors a widget plays itself** (a kind it declares, such as a text
  widget's `typewriter`) take no offset in the widget protocol. After a seek,
  each one the widget plays at the new time is sent again: one still running
  with the time it has left, so it starts over but ends when the composition
  says; one already over with a duration of 0, so the widget lands on its end
  state.

What frames report (subscribed, painted, completed) replaces the estimates only
during a run uninterrupted from the start: a video's real length, a frame slow
to paint. After the first pause or seek the clock no longer runs in step with
the frames' own time, so their reports are ignored until `restart`, or a `load`
that mounts everything afresh.

The editor posts a `load` when the document changes (debounced), and uses
`overrides` for gestures in progress. A load for the same profile and sample
event updates the run in place, the way an overlay takes a saved change: what
is on screen stays, overrides included, while the new document is bound and
framed; then the scheduler takes it (placements moved, added and removed,
behaviors planned again), and the overlay's update plan (`planSceneUpdate` and
`settingsUpdate` in `scene-update.ts`) decides each kept frame's fate. Settings
the widget's script has not read are patched in; a frame whose script read a
changed setting, or whose frame document changed, is replaced by a fresh one
that loads invisibly and shows once it has painted, or after 2 s
(`frame-swap.ts`, shared with the overlay). The scheduler treats the new
document as the composition from its start (`documentChanges: "start"`), so an
added layer plays from 0 ms like the rest. A first load, another profile or
another sample event mounts every frame afresh.

## Tests

- `shared/clients/typescript/scene/tests/preview-protocol.test.ts`: both
  parsers, total over hostile input.
- `shared/clients/typescript/scene/tests/runtime-scheduler.test.ts`: estimates,
  `resync`, and documents changed from the start.
- `sceneManager/tests/client/preview-clock.test.ts` and
  `composition-preview.test.ts`: the clock, and the page's logic on a fake
  clock and DOM (load, play to the finish, scrub, measuring, delegated
  behaviors after a seek, bind failures, superseded loads, overrides,
  restart, and loads of an edit: moved, patched, swapped, added and removed
  widgets, overrides kept until the edit lands).
- `sceneManager/tests/routes/composition-preview.test.ts` and
  `tests/scene/session-token.test.ts`: the page, refresh and framing routes,
  and the tokens.
- `api/tests/composition-preview-url.test.ts`.
