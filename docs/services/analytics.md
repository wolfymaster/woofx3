# Analytics

::: warning Not built
Nothing in this document exists yet. No code aggregates anything today, and no
table holds a stream event. This is the design [stream
sessions](/services/stream-sessions#analytics-is-a-separate-subsystem) defers
to, written down so the first person to need a total does not invent a
different one.
:::

**Analytics answers questions about a broadcast that no single value can hold**
— how many bits this stream, who gifted the most subs, what the viewer count
did over the last two hours. It is the subsystem that turns the events the
engine already receives into numbers somebody can read.

It is deliberately *not* the counter resource. A counter is a register; this is
a fact table. The distinction is the whole design, so it comes first.

## Why counters are not the answer

A counter's value is one key in BadgerDB at `state:<canonicalId>`
(`modules/woofx3/functions/counter.js:87`), holding `{ value, reached }`. That
shape is right for what a counter is for — a number workflows and chat commands
read and write, and that `goal.reached` fires on. It is wrong for analytics for
four separate reasons, none of which is fixable by trying harder.

**No time axis.** A register holds the current number. Nothing records what it
was an hour ago, so "subs over time" has no source to read. The only timestamps
a counter keeps are first-crossings in the `reached` map, one per configured
goal, and `counterReset` wipes even those (`counter.js:65-68`).

**No entity axis.** "Users who gifted five subs" needs a number *per viewer*.
Expressed in counters that is one key per viewer per metric — unbounded
cardinality in a key/value store with no query API. `ClearSessionScoped` and
its siblings already do a full per-application Badger scan
(`db/app/services/storage_service.go:246-247`, acceptable only because they are
not hot-path); a per-viewer key space is how that stops being true.

**Increments are destructive.** A counter cannot be recomputed. The stream
event fan-out is explicitly not gapless — core NATS, no JetStream, no replay
buffer (`shared/clients/typescript/api/stream-events.ts:10-14`) — so a dropped
event makes the number permanently and silently wrong, with nothing to
reconcile against. A fact log missing a row can be backfilled; a register that
missed an increment cannot be distinguished from one that did not.

**"This stream" and "forever" cannot both be safe.** A counter's `lifetime`
setting is `forever` or `session`, so holding both totals means two counters
incremented by the same workflow. There is no transaction spanning two keys —
`counter.js:11-15` says so explicitly, which is why a counter writes its value
and its `reached` record in a single `compareAndSet`. Two counters have no such
guarantee, so one failed write diverges them for good.

There is a fifth problem specific to `lifetime: session`, and it is the one
most likely to be mistaken for a bug. A session ends on a **split**, at the
next `stream.online` past the grace window (`DEFAULT_SESSION_GRACE_MS`, ten
minutes, `api/src/stream-session-policy.ts`) — never at `stream.offline`. So a
session-scoped counter holds last broadcast's number for the entire gap between
streams and clears when the next one begins. That is correct for ephemeral
state, which is what the setting is for. It is not what a tile reading "subs
this stream" should do.

None of this argues for changing counters. It argues that totals are a
different subsystem, which is what this document is.

## Two shapes, not one

The queries Analytics is expected to answer divide cleanly, and conflating them
produces numbers that are quietly wrong rather than obviously missing.

**Counted events** accumulate from an append-only log. Bits, gift subs, subs
gained, raids, per-viewer totals. The payloads already carry what is needed:
`Cheer` has `userId` and `amount`, `SubscriptionGift` has `gifterId`, `amount`
and `tier` (`shared/common/typescript/cloudevents/Twitch/events.ts`).

**Observed levels** are gauges, and only sampling can produce them. Viewer
count and follower count are levels, not sums:

- Twitch emits no unfollow event, so follows cannot be netted into a follower
  count. A log of follows tells you gross arrivals, never the standing total.
- `stream.online` carries no viewer count at all — the payload comment says
  title, game and viewers all need a follow-up Helix lookup.

A design that only builds the event log will ship "followers over time" as a
running sum of follows, which drifts upward forever and never matches Twitch.

## What exists to build on

More than it looks like, which is why this is worth writing down before
someone starts from nothing.

| Piece | State | Where |
|---|---|---|
| Session partition key on every event | **Built** | `sessionId` CloudEvents extension, stamped centrally in `BaseEvent.ts` |
| Session records and segments | **Built** | `stream_sessions`, `stream_session_segments`; `StreamSessionService` |
| Every platform event reaching the engine | **Built** | `twitch/src/lib/twitchEventBus.ts`, 10 EventSub subscriptions |
| Fan-out including gift subs | **Built** | `api/src/stream-event-broadcaster.ts` |
| A per-viewer event table | **Scaffolded, dead** | `user_events` — model, both migration chains, zero writers |
| A per-viewer rollup precedent | **Scaffolded, dead** | `treats` / `treats_summary` view; Twirp generated, no service mounted |

Two of those deserve care. `user_events` is
`{userid, application_id, eventtype, eventvalue jsonb, createdat}` with indexes
on userid, appid and eventtype (`db/database/models/user_event.go`). It has no
`session_id` column and no index on `createdat`, so it cannot answer either
half of "per stream, over time" as it stands. It is a good starting shape, not
a ready one.

And `treats_summary` is a **view** over `treats`, with `TotalPoints` and a
per-type distribution (`db/database/models/treat_summary.go:10-24`). Whatever
happens to treats, that is the shape a leaderboard wants, computed rather than
maintained.

### What is not stored

Follows, subs, cheers, raids and gift subs are published to NATS and discarded.
`twitch/src/` contains no database call. The only places an event survives are
incidental:

- `workflow_executions.trigger_event` holds the originating CloudEvent verbatim
  (`db/database/models/workflow_execution.go:38-41`) — but only when a workflow
  fired, never for dashboard-triggered runs (`workflow/run_recorder.go:20-21`),
  and best-effort by design: "a failed write costs history, not correctness"
  (`run_recorder.go:36-39`).
- `alerts.payload` carries `{id, parameters, event}`, so the source event
  survives inside any alert that fired.

Both are biased samples — they contain the events that happened to trigger
something. They are worth a one-off backfill when Analytics turns on. They are
not a foundation.

## The design

**The engine owns the facts. The UI owns the read model.**

The engine is the only process that can guarantee the record, because it is the
process receiving the events. Everything downstream of the fan-out is lossy by
construction, so a fact written anywhere else is a fact that can be missing
without anyone knowing.

1. **Persist each platform event** to `user_events`, adding `session_id` and an
   index on `createdat`. Write it where the event enters the engine, not where
   it is consumed, so a fact does not depend on a workflow existing.
2. **Sample the gauges.** One row per minute per session for viewer count, and
   the Helix follower and subscriber totals. The engine already polls stream
   status; this records what that poll currently throws away.
3. **Summarise per session.** On `session.ended`, roll the session's facts into
   a small set of totals and push them to the UI over the existing webhook
   channel.
4. **The UI stores summaries, not events.** One row per session per metric.
   That keeps Convex small, gives the dashboard reactive cross-stream history,
   and survives an engine reinstall — which raw facts on the streamer's own
   machine do not.
5. **Live "this stream so far" stays in memory**, as it is today. It is a
   display of the last few minutes, not a record, and giving it durability buys
   nothing.

Counters stay exactly as they are. If a goal bar wants "total bits this
stream", it should read a value *derived* from the log, so a missed event can
be repaired instead of being baked in.

### Do not buy a time-series database

A busy stream produces on the order of a thousand to ten thousand events.
Postgres and SQLite both handle that without noticing, and so does Convex with
an index. ClickHouse, Timescale and Prometheus solve a problem this system does
not have — and the engine cannot depend on a third-party service anyway
(`CLAUDE.md`), so the only admissible answer inside the engine is the database
it already runs.

### Let Twitch answer what Twitch knows

The UI already holds `bits:read`, `channel:read:subscriptions` and
`moderator:read:followers`, and calls none of the endpoints they unlock. Helix
gives the current follower total, the subscriber total and sub points, and its
own bits leaderboard — and will be *more* accurate than a local sum, because it
accounts for refunds, churn and expirations.

Use Helix for standing totals. Use the fact log for what Helix will not give:
attribution to a session, and the time axis.

## Two constraints to design against

**The stamped session id is not a stable key.** Splits move segments between
sessions retroactively, so a reader aggregating events must resolve the stamp
through the session record to a canonical id — see [Splits are
retroactive](/services/stream-sessions#splits-are-retroactive-and-events-are-immutable).
Doing that per row will not scale. Resolve once per segment, or materialise a
canonical id beside the stamped one.

**Per-viewer rows are personal data.** A leaderboard of who spent what is the
first thing this system will hold that a viewer could reasonably ask to have
deleted. Retention and deletion are a design input here, not an operational
afterthought, and they are the reason step 4 sends summaries rather than
shipping every viewer's activity to a multi-tenant store.

## Gaps that block specific questions

| Question | Blocked by |
|---|---|
| Users who gifted N subs | The UI drops `SubscriptionGift`: no `PlatformEventType` for it (`client/src/lib/platforms/engine-events.ts:5-8`, woofx3-ui). The engine already broadcasts it. |
| Anything per stream | No session RPC on the engine's public surface. `ListStreamSessions` and `GetStreamSession` exist in `db/proto/v1/stream_session.proto:33-34` but `api/` never exposes them, so the UI cannot enumerate past sessions. |
| Viewers over time | Nothing records a viewer count. Every poll overwrites the last. |

Two smaller things sit in the same area and will be mistaken for Analytics bugs
once it exists: `getDashboardStats()` returns hardcoded values for
`activeAccounts` and `recentEvents` (`api/src/routes/dashboard-stats.ts:3-31`),
and `getDashboard().recentActivity` is always `[]` (`routes/dashboard.ts:50`).

## Build order

Each step is independently useful and safe to stop after:

1. **Write the facts** — `session_id` and a `createdat` index on `user_events`,
   and a writer on the ingestion path. Nothing reads it yet; the corpus starts
   accumulating from the day it lands, and cannot be recovered for any day
   before.
2. **Expose sessions** — `ListStreamSessions` / `GetStreamSession` on the
   `RPC_METHODS` allowlist (`api/src/api-session.ts:103-193`). Without this
   there is no way to ask about a past stream.
3. **Sample the gauges** — viewer count per minute, Helix totals on the same
   tick.
4. **Query the log** — per-session totals and per-viewer leaderboards as engine
   RPCs, with canonical session resolution done once per segment.
5. **Summarise to the UI** — a `SESSION_SUMMARY` webhook on `session.ended`,
   and the Convex table behind it.
6. **Backfill** what `workflow_executions.trigger_event` and `alerts.payload`
   can supply, once there is something to backfill into.

Step 1 is the one with a deadline. Every day it is not done is a day of history
that does not exist, and unlike the others it cannot be added retroactively.
