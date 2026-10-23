# Widget Event Channel

Every overlay-originated message — alert lifecycle acks, counter increments, timer state, goal progress, generic completion — flows through one NATS subject (`widget.event`) and one UI-side surface (`widgetHost.reportStatus` / `widgetHost.reportComplete`). This page documents the wire format, the dispatch rules, and the host API contract.

## Why one channel

Before this refactor, the api boundary owned three subscriptions:

- `ui.notify.alert` — workflow alert intent
- `ui.widget.status` — alert overlay acks
- `module.widget.status.changed` — generic widget reports

The api layered the alert queue manager and the widget-status persistence on top of those subscriptions, which made it both a webhook gateway and a runtime orchestrator. The refactor pushed the orchestration role into **streamware** and collapsed the inbound channels to a single `widget.event` subject. The api now subscribes only to db-proxy outbox events and projects them to outbound webhooks (its actual boundary job).

A generic widget reporting `key="count"` and the alert overlay reporting `key="alert.lifecycle"` use the exact same plumbing. The only difference is what streamware does with the event after it arrives — see [Dispatch rules](#dispatch-rules) below.

## Wire format

The overlay sends the canonical wire shape (`OverlayWidgetEvent`) as a raw JSON
message over the single P2 overlay WebSocket (`/o/{token}/events`); there is no longer
a separate alert-specific transport. See
`shared/clients/typescript/module-sdk/src/widget-host-shim.ts` (widget → shim →
`status.report` P1 message → `WidgetBridge` → this shape) and
`streamware/src/events/wire.ts:9` (`publishWidgetEvent`, server-side decode + republish).

```typescript
interface OverlayWidgetEvent {
  kind: "widget.event";
  moduleId: string;          // "core" for system widgets, manifest id otherwise
  instanceId: string;        // stable per-placement id (e.g. "alert-overlay")
  widgetCanonicalId?: string; // {moduleId}:widget:{manifestId}, when known
  key: string;               // event name owned by the widget ("count", "alert.lifecycle", ...)
  value: unknown;            // any JSON-serializable payload
  ts?: string;               // ISO 8601; defaults to now if omitted
}
```

`streamware/src/events/wire.ts` (`publishWidgetEvent`) validates the message, wraps it in a CloudEvents 1.0 envelope, and republishes to NATS `widget.event`. The CloudEvent `data` field carries the same fields, with `ts` renamed to `occurredAt` to match the rest of the engine's CloudEvent payloads.

```jsonc
{
  "specversion": "1.0",
  "id": "<uuid>",
  "source": "streamware",
  "type": "widget.event",
  "time": "2026-05-09T14:32:11.482Z",
  "datacontenttype": "application/json",
  "data": {
    "moduleId": "raid_counter",
    "instanceId": "raid-counter-1",
    "widgetCanonicalId": "raid_counter:widget:counter",
    "key": "count",
    "value": 42,
    "occurredAt": "2026-05-09T14:32:11.482Z"
  }
}
```

Malformed messages (missing `kind`, `moduleId`, `instanceId`, or `key`) are dropped with a single warning so a misbehaving widget cannot flood the log.

## Dispatch rules

`streamware/src/events/handlers.ts` subscribes to `widget.event` and dispatches by `data.key`:

| Condition | Handler | Persistence |
|-----------|---------|-------------|
| `key === "alert.lifecycle"` AND `instanceId === "alert-overlay"` | `EventQueueManager.handleStatus(envelopeId, state, error?)` | `alerts` table — lifecycle column on the existing row keyed by `envelope_id` |
| anything else | `db.upsertWidgetStatus({ moduleId, instanceId, widgetCanonicalId?, key, value, occurredAt })` | `widget_status` table — upsert on `(instance_id, key)` |

The two tables answer different questions and so are kept separate:

- **`alerts`** is the durable record of every dispatched alert envelope, with a full lifecycle (`sent` → `dispatched` → `playing` → `completed` / `failed` / `timed_out` / `skipped` / `replayed`). See `db/database/migrate/migrations/0008_alerts.go` and `0010_alert_lifecycle.go`. A settled row (any status from `completed` on) is deleted once it is older than `EVENT_DETAIL_RETENTION_PERIOD` (default 7 days); a row still `sent`, `dispatched` or `playing` is kept. See [Analytics: retention](./analytics.md#retention).
- **`widget_status`** holds only the latest value per `(instanceId, key)`. See `db/database/migrate/migrations/0011_widget_status.go` and `db/proto/v1/widget_status.proto`.

Alert lifecycle reports are intentionally not also written to `widget_status` — the alerts table is already the durable record and double-bookkeeping would create reconciliation work for no gain.

## The `alert.lifecycle` value

When the alert overlay calls `host.reportStatus("alert.lifecycle", value)`, `value` is:

```typescript
{
  envelopeId: string;                              // matches alerts.envelope_id
  state: "playing" | "completed" | "failed";
  error?: string;                                  // populated when state === "failed"
}
```

The orchestrator drops reports where `state` is anything other than the three values above, where `envelopeId` is empty, or where the in-flight lease for that application doesn't match the reported envelope id (stale acks after a reconnect or lease expiration).

## Host API contract

Every framed widget gets the same `WidgetHost` contract, whether it is placed on a
scene or plays inside an alert layout; `surface` tells it which. The contract lives
in `shared/clients/typescript/module-sdk/src/widget-host.ts`.

```typescript
interface WidgetHost {
  readonly moduleId: string;
  readonly instanceId: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly surface: "scene" | "alert";     // placed on a scene, or playing in an alert
  readonly storage: WidgetHostStorage;     // get / subscribe over module storage

  onEvent(handler: (event: WidgetEvent) => void): () => void;
  reportStatus(key: string, value: unknown): void;
  reportComplete(reason?: string): void;   // sugar for reportStatus("complete", { reason })
}
```

`reportStatus` and `reportComplete` are best-effort: they post a P1 `status.report`
message and never throw. If the handshake with the parent scene manager hasn't
completed yet, the shim queues nothing and the report is silently dropped.

### Iframe widgets

Every framed widget is served through the frame assembler into
a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) and talks to
the scene manager exclusively through the P1 postMessage protocol; there is no
direct property injection onto `iframe.contentWindow`. This is deliberate, not a
same-origin shortcut waiting to be replaced: widget assets can already be served
from barkloader or a CDN (see [Asset delivery](./asset-delivery.md)),
and postMessage is what makes that origin-agnostic.

A scene placement's frame document is the widget's own, served at
`/frames/{moduleId}/{manifestId}?theme=…&v=…` and cached by the browser while
`v` (a hash of what barkloader resolved for it) is current. The placement --
nonce, instance id, settings and linked resources -- is appended in the URL's
fragment (`#boot=…`) and merged in by the shim, so it never reaches the server
and every placement of a widget shares one cached document. The fragment may also
carry `surface`: the cached document says `scene`, and the
[composition preview](./composition-preview.md) frames an alert's widgets from the
same documents with `surface: "alert"`.

### Alerts

A scene gets alerts through **alert widgets** (`woofx3:widget:alert`): named areas the
page draws itself, with no frame of their own. The workflow `alert` action carries a
target name and a layout (see [Tasks → alert](../workflow/tasks.md#alert)). The scene
manager validates the layout against the widget catalog and records one scene event for
each running scene that has an alert widget answering to the target; a scene nobody has
open gets nothing.

Every alert is delivered as a composition (a layout in the older list shape is
converted on the way in). For each alert, the page plays it with the scene runtime
(`@woofx3/scene/runtime`) inside the alert widget's area, scaled from the layout's
canvas: each widget is placed, rotated, faded and stacked as its placement says, and
its transitions and effects play around it. A widget whose placement is hidden does not
play at all. The scene manager frames each layout widget as it dispatches the alert,
the same way it frames a scene placement, and records where it loads from with the
delivery (`frames`, see `sceneManager/contract/alert-delivery.ts`). Each frame loads
the widget's own document, `/frames/{moduleId}/{manifestId}?theme={id}&v={version}`,
which every placement and alert showing that widget shares and the browser caches, so
an alert's frames need no request to the scene manager once the widget has been shown.
The alert's half of the boot (instance id, settings, linked resources, entrance) rides in
the frame URL's fragment and never reaches the server. External media in the settings
of a widget under the theme policy is signed each time the delivery is sent to a page,
never when it is stored. Each layout widget boots with `surface: "alert"` and receives
one `alert` event whose `data` is the triggering CloudEvent (`{ type, data }`, or
`null` when nothing triggered the workflow).

The page plays alerts on **prepared** stages, so a widget's frame has usually loaded
before its alert is due. A prepared stage is built transparent and already fitted
to the area, with its frames booting and painting and its time held at its first
moment. (Transparent rather than `visibility: hidden`, and fitted rather than left at
its canvas size, because Chromium stops rendering a cross-origin frame that is hidden
or clipped out of view, so a widget could not paint before it is shown.) An alert area keeps up to four prepared stages,
one per shape (the same layout, behaviors and frames, whatever the settings), and
decides which from its queue each time the queue changes: first the shapes of the
alerts waiting in it, in the order they will play, so an alert's frames boot while it
waits its turn; then, only while no alert is on screen, the shapes it played most
recently, each prepared from the last alert of that shape, so preparing for an alert
nobody is waiting on never competes with one on screen. When more shapes are wanted
than it keeps, the stages due soonest stay and a shape due later than all of them is
not prepared. An alert delivered to an idle area with nothing of its shape prepared
plays at once on frames made for it. An alert takes over the prepared stage of its
shape. Its settings are handed to the running widgets as a settings change, and only
then is the alert's event sent. If a widget read a setting the alert changes while it
booted, or has not painted yet (so what it read is not known yet), its
frame might not show the new value, so the alert gets fresh frames instead. Each stage plays one
alert and is then removed. A widget in a prepared stage boots with an instance id of
its stage's (`prepared-{n}.{widgetId}`), not the alert's; its status reports are
recorded under `{eventId}.{widgetId}` once its alert is known. Widget code therefore
runs well before its alert, sometimes for an alert that never comes; see
[Playing in an alert](../barkloader/sdk.md#playing-in-an-alert).

A layout widget that subscribes with `autoComplete: false` has a length of its own and
holds the alert until it calls `complete()`; one that completes on handler return has
none. Once every timed widget is done, or after 5 seconds when none is timed, the
widgets play their exits; once those are over the page removes the frames, acks the
scene event, and plays the alert widget's next alert.

#### Measuring an alert's latency

Where an alert's time goes is recorded at both ends, so a slow alert can be traced
without adding logging:

- **Dispatch.** The scene manager logs `ui.notify.alert: dispatched` once per alert it
  delivers, with `layoutMs` (reading the layout and checking it against the widget catalog),
  `framesMs` (framing its widgets), `scenesMs` (finding each running scene's alert widgets),
  `recordMs` (recording and pushing each scene's delivery) and `totalMs`, timed from when
  the scene manager starts dispatching the alert.
- **Frame documents.** Every widget frame document that is built per request carries a
  `Server-Timing` header: `frame` (barkloader's widget entry) and `total`. Browser
  devtools show it on the frame's request. A frame document the browser caches for good,
  which is what alerts load, carries none, since a cached response would replay the first
  miss's numbers.
- **The page.** One alert is delivered to every alert area on a scene, and each area
  plays it on its own, so the overlay's User Timing marks are named for the area
  (`areaId`, the alert area's placement id) as well as the alert:
  `woofx3.alert/{eventId}/{areaId}/{stage}` for `delivered`, `prepared` (it played on a
  stage built before its turn came; an alert that played on frames made for it has no
  such mark), `started` and `finished` (the alert is off the stage: played out, skipped,
  or torn down with its area), and
  `woofx3.alert/{eventId}/{areaId}/{widgetId}/{stage}` for each frame's `mounted`,
  `ready` (the frame's shim is running: its response arrived and its head was parsed up
  to the shim script, while the body and the widget's own scripts are still to load),
  `subscribed` (the widget's own script has run) and `rendered`. On a prepared stage,
  the steps its frames reached before the alert are marked, under the area the alert
  plays in, as it starts. The measure
  `woofx3.alert/{eventId}/{areaId}/on-screen` spans from delivery to the area's first
  widget paint; its `detail.from` is `delivered`, or `started` for an alert delivered
  before the page loaded. They appear in the devtools Performance panel, and
  `performance.getEntriesByType("mark")` reads them from a script. Entries are cleared
  once more than 20 later alerts have finished, so a burst's queued alerts keep theirs
  until they have played, and at most 200 alerts are tracked, since an overlay can stay
  open for a whole stream.

#### Skip, clear and replay

An operator can act on the alerts queued in open overlays through the api's
`skipCurrentAlert`, `clearAlertQueue` and `replayAlert`. The api forwards each as a NATS
request (`widget.queue.skip`, `widget.queue.clear`, `widget.queue.replay`) and the scene
manager answers it, because the queues are the ones it streams to
(`sceneManager/src/events/alert-controls.ts`). Every answer carries `ok`, and `reason`
when `ok` is false.

| Request | Reply | Effect |
|---------|-------|--------|
| `widget.queue.skip` `{}` | `{ ok, skipped, reason? }` | Ends the alert each alert widget on an open overlay is playing; the next one starts. |
| `widget.queue.clear` `{}` | `{ ok, cleared, reason? }` | Drops every alert waiting behind the playing one; the playing one keeps playing. |
| `widget.queue.replay` `{ id }` | `{ ok, replayEnvelopeId?, reason? }` | Plays the alert-log row `id` again. |

`skipped` and `cleared` count distinct alerts: one alert playing on two alert widgets
counts once. With no overlay open, every request answers
`{ ok: false, reason: "no overlay is open" }`; an api that gets no answer at all returns
`ok: false` with `the scene manager did not answer: ...`.

A request that arrives as a plain publish, with no reply subject, is ignored: the api
always sends a request, and a workflow's `publish_event` must not be able to skip, clear
or replay alerts.

Skip and clear act on the scene manager's open deliveries and on what the pages report.
An alert widget's page posts `POST /scene/{sceneId}/events/{eventId}/started` when it
starts an alert and `.../completed` when it finishes one, each as its own request rather
than batched. The first start report also moves the alert's row to `playing`.

- **Skip** ends, on each alert widget, the open delivery a page most recently reported
  starting. An earlier started delivery still open is one that finished but whose
  completion has not landed, and is left alone.
- **Clear** ends every open delivery no page has reported starting.

The scene manager closes the chosen deliveries, pushes a `cancel` frame
(`{ instanceId, eventIds }`) to every page of the scene, and marks each alert `skipped`.
It picks and closes every delivery in one synchronous pass before any db write, so two
overlapping requests (a double-clicked Skip) each see the other's effect whole. The page
drops the cancelled deliveries from the widget's queue, takes an alert on screen down at
once, and ignores a cancelled delivery that arrives later.

Limits, as the server sees the pages:

- "Started" and "finished" are the last reports from **any** page of the scene. An OBS
  source and a dashboard preview of the same scene share one set of deliveries, so the
  one further ahead decides what counts as playing.
- An alert started so recently that its start report is still on the wire is not yet
  playing: a Skip in that moment ends nothing on that widget, and a Clear drops it.
- A delivery addressed to an alert widget the scene no longer has (removed after the
  alert was recorded) is neither cancelled nor counted; no page will register it.
- A cancelled delivery is recorded as completed in `scene_event_deliveries`, since that
  is what ends redelivery, so `scene_event_log` shows it as `completed`. The alert's
  row carries `skipped`.

Each lifecycle report names the alert log row of the play it describes (the delivery
carries `rowId` from the published envelope), so two plays of one envelope id, which a
workflow pinning `parameters.id` produces, settle separately. A delivery recorded
before deliveries carried `rowId` reports against the envelope id alone, and the db
proxy moves that envelope's newest row.

Replay reads the row, gives its stored envelope a fresh id, records that as a new row,
and dispatches it with that row's id exactly as `ui.notify.alert` would, so a layout or target that no
longer matches anything is refused with the same reason. The original row is marked
`replayed` only once the replay was queued on at least one scene. A repeat replay of the
same row while one is in flight, or within 30 s of one that succeeded, gets that replay's
answer and plays nothing, so an api retry after a timeout (15 s for replay) cannot play
it twice. A refused replay is not remembered.

#### Reading the alert log and queue

Three reads let a dashboard show alerts without following the `alert.*` callbacks.

`listAlerts({ limit?, offset?, workflowId? })` pages the alert log, newest first: every
alert the engine dispatched, as the row db-proxy keeps for it, each in the snapshot shape
the `alert.*` callbacks carry (`AlertSnapshot`, timestamps RFC 3339 with nine fractional
digits). `limit` is 1 to 500 (default 50), and a value outside that is refused rather than
clamped. `workflowId` narrows the log to the alerts one workflow run fired. `totalCount`
counts every alert the query matches. The log is stored, not held in memory: it survives
restarts, and it reaches back as far as db-proxy's cleanup keeps settled alerts (see
[Analytics: retention](./analytics.md#retention)).

`getAlertOverview(hourStart, windowHours?)` counts the log instead of paging it: totals by
outcome over a window, and one bucket per hour. The window is `windowHours` whole hours (1
to 168, default 24) ending with the hour that starts at `hourStart`, which must be epoch
milliseconds on the hour; anything else is refused rather than clamped. A caller passes the
start of its current hour, so its arguments change once an hour. An alert falls in the hour
the engine recorded it. The answer is `{ hours, since, bucketMs, truncated, totals,
buckets }`, where `since` is the window's first hour, `bucketMs` is one hour, each bucket is
`{ start, total, failed }`, and `truncated` says the window starts before the alert
retention horizon (`EVENT_DETAIL_RETENTION_PERIOD`, a week by default): settled alerts
older than that have been pruned, so the earliest hours count only alerts still on their
way.

`totals` counts each alert once by its outcome:

| Outcome | Statuses |
|---------|----------|
| `completed` | `completed` |
| `failed` | `failed`, `timed_out` |
| `skipped` | `skipped` |
| `replayed` | `replayed`: an operator replayed it, and the replay is its own row |
| `inFlight` | any other status (`sent`, `dispatched`, `playing`, ...) |
| `unconfirmed` | as `inFlight`, but nothing has reported on it for 15 minutes, so no report is coming |

db-proxy groups the window's rows by hour and outcome in SQL
(`AlertService.CountAlertsByHour`) and owns the rule from status to outcome above. The api
supplies the 15-minute bound from its clock.

`getAlertQueue()` answers what is on screen now. The api asks the scene manager with a
`widget.queue.state` request, and it answers from the same open deliveries and page
reports that skip and clear act on:

| Request | Reply |
|---------|-------|
| `widget.queue.state` `{}` | `{ ok, playing, waiting, reason? }` |

`playing` holds the alert each alert widget most recently reported starting (what Skip
would end), and `waiting` the alerts delivered to a widget's queue that no page has
started (what Clear would drop). Each entry is `{ alertId, envelopeId, startedAt? }`:
`alertId` is the alert-log row, or `""` for a delivery recorded before deliveries carried
`rowId`, and `startedAt` is the earliest start any page reported. An alert counts once
however many alert widgets show it, and one playing on one widget while still queued on
another is listed as playing. With no overlay open the answer is
`{ ok: false, playing: [], waiting: [], reason: "no overlay is open" }`, and a scene
manager that does not answer gives `ok: false` with `the scene manager did not answer:
...`, as for the controls. The queue has no paused state: an alert widget plays its queue
whenever a page holding it is open.

## Delivery acknowledgements

Every event bound for a placement is an open delivery on the scene manager until a page
acknowledges it as completed. A page acknowledges in two steps:

- **Delivered** (`POST .../events/{eventId}/delivered`, batched): the event reached the
  placement's queue on the page. A page acknowledges only what reached a queue; an event
  for a placement whose widget has not subscribed yet is left undelivered. The scene
  manager sends undelivered deliveries again every few seconds and stops once one is
  delivered. When a page subscribes to the scene's stream, every open delivery is sent to
  it and counts as undelivered again until that page queues it, since a page that
  reloaded holds nothing it was sent before.
- **Completed** (`POST .../events/{eventId}/completed`): the widget finished the event, or
  the page gave up on it after the subscription's `retryTimeoutMs`. Either way the
  delivery closes; a delivery left open would play again after the next page load.

The scene manager answers an acknowledgement it could not record with `503`, and the page
sends it again with backoff (about four minutes in all); acknowledgements are idempotent.

When the frame of a placement is replaced (a settings or theme change swaps a fresh frame
in), the fresh frame's queue takes over the events not yet dispatched, the old frame
finishes what it is showing, and whatever it never finished is handed to the fresh frame
when it is retired. An alert area is mounted afresh the same way: the new area takes over
the waiting alerts, and the old one starts nothing more.

A skip or clear closes deliveries and tells every open page at once, but that message is
not kept for a page whose stream was down at the time. So after replaying the open
deliveries to a new stream, the scene manager sends the whole open set (event ids by
placement), and the page drops whatever it still holds beyond it, playing or waiting.

A delivery addressed to a placement removed from the scene afterwards would never be
queued by any page. Such deliveries are closed when the scene is saved, and when the
scene manager starts. A placement still in the draft counts as present, since the editor's
preview plays the draft.

## End-to-end flow

```
Widget iframe                                Scene manager (parent)         Streamware server
   |                                            |                              |
   v                                            v                              |
host.reportStatus(key, value)        WidgetBridge.handleMessage               |
   |                                            |                              |
   |------ P1 status.report (postMessage) ---->|                              |
                                                |                              |
                                                |-- P2 send (raw JSON, /o/{token}/events) -->|
                                                                                |
                                                                                v
                                                                     publishWidgetEvent()
                                                                                |
                                                                                v
                                                                     NATS publish "widget.event"
                                                                                |
                                                                                v
                                                                     streamware/src/events/handlers.ts
                                                                       /                  \
                                                                      v                    v
                                                              EventQueueManager      db.upsertWidgetStatus
                                                              .handleStatus              (widget_status)
                                                                      |                    |
                                                                      v                    v
                                                              db.updateAlertLifecycle  db-outbox event
                                                                      |               db.widget_status.updated.{appId}
                                                                      v                    |
                                                              db-outbox event              v
                                                              db.alert.updated.{appId}  api/ projects to webhook
                                                                      |               WIDGET_STATUS_CHANGED
                                                                      v
                                                              api/ projects to webhook
                                                              (ALERT_COMPLETED / FAILED / etc.)
```
