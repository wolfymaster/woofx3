# Analytics

::: warning Partly built
**Built:** step 1 — every platform event is written to `user_events` as it
enters the engine (see [The fact log](#the-fact-log)); step 3 — viewer,
follower and subscriber levels are sampled once a minute while live (see
[Gauge samples](#gauge-samples)); step 4 — per-session totals, per-viewer
totals, leaderboards and gauge series as engine RPCs (see [Reading the
log](#reading-the-log)); the engine side of step 5 — a `SESSION_SUMMARY`
webhook for every session that ends (see [Summaries to the
UI](#summaries-to-the-ui)).

**Not built:** the Convex table that stores summaries, and the backfill
(step 6). This is
the design [stream
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

A counter's value is one key in module storage at `state:<canonicalId>`
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
its siblings already delete across the whole `module_storage` table
(`db/app/services/storage_service.go`, acceptable only because they are not
hot-path); a per-viewer key space is how that stops being true.

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
| A per-viewer event table | **Built** | `user_events`, written by `UserEventRecorder` through `UserEventService` |
| Per-minute gauge samples | **Built** | `stream_gauge_samples`, written by `StreamGaugeSampler` through `StreamGaugeService` |
| A per-viewer rollup precedent | **Scaffolded, dead** | `treats` / `treats_summary` view; Twirp generated, no service mounted |

`treats_summary` is a **view** over `treats`, with `TotalPoints` and a
per-type distribution (`db/database/models/treat_summary.go:10-24`). Whatever
happens to treats, that is the shape a leaderboard wants, computed rather than
maintained.

### What was not stored

Until the fact log existed, follows, subs, cheers, raids and gift subs were
published to NATS and discarded. The only places an event from before then
survives are incidental:

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

## The fact log

`user_events` is the log, one row per platform event, never updated
(`db/database/migrate/migrations/*/0048_user_events_fact_log.go`).

| Column | Meaning |
|---|---|
| `event_id`, `source` | The CloudEvent identity. Unique together, so a redelivery is a conflict, not a second row. |
| `event_type`, `platform` | The CloudEvent `type` and `platform` extension. |
| `platform_user_id`, `user_name` | The viewer, as the platform names them. Null when the event is attributable to nobody. |
| `session_id` | The session the event was stamped with. Not a foreign key and not a stable key; resolve it. |
| `amount` | Bits, gifted subs, raiders or channel points. Null when the event carries no quantity. |
| `event_value` | The CloudEvent `data`, whole. |
| `occurred_at` | The CloudEvent `time`. The time axis every reader groups on. |

**One writer, on the bus.** `UserEventRecorder` (`api/src/user-event-recorder.ts`)
subscribes to the platform subjects and calls `UserEventService.RecordUserEvent`.
It sits in the api rather than in each platform integration because the api
already holds the db-proxy client and one subscriber serves every platform; it
is on the ingestion path in the sense that matters — nothing has to react to an
event for it to be recorded. A failed write is retried a few times, which is
safe only because the write is idempotent.

**What is recorded.** Cheer, follow, raid, redemption, sub, gift, resub, and
the gift-paid, prime-paid and pay-it-forward upgrades. Chat is not: it is the
one high-volume subject and no total is built from it. Neither are the
`shared*` events, which happened in another channel during shared chat.
Events the api publishes itself are dashboard simulations and are skipped.

**Anonymous events count, but not for anybody.** An anonymous cheer or gift is
stored with a null viewer, so channel totals include it and no per-viewer total
can credit it to someone — including the account Twitch uses to stand in for
anonymous gifters.

**A gift arrives twice.** Twitch sends a community gift as one
`SubscriptionGift` for the gifter and one gifted `Subscribe` per recipient, and
both are recorded as sent. "Subs gained" counts one or the other, never both.

**Idempotency covers our retries, not Twitch's.** The CloudEvent id is minted
when the event is published, so it dedupes the recorder retrying a write. A
Twitch redelivery arrives with a new CloudEvent id; Twurple drops those by
EventSub message id within one process, which does not survive a restart.

## Gauge samples

`stream_gauge_samples` holds one row per sampled minute of a live segment
(`db/database/migrate/migrations/*/0050_stream_gauge_samples.go`).

| Column | Meaning |
|---|---|
| `segment_id` | The segment the sample was taken in. The stable key: a session's samples are the samples of the segments it owns now. |
| `session_id` | The session that owned the segment when the sample was recorded. Informational, like the stamp on `user_events`. |
| `sampled_at` | The minute the sample stands for, truncated to the minute in UTC. Unique within a segment. |
| `viewer_count` | `GET /helix/streams`. |
| `follower_total` | `GET /helix/channels/followers`, `total`. |
| `subscriber_total`, `subscriber_points` | `GET /helix/subscriptions`, `total` and `points`. |

**A missing row is a minute nobody sampled, never zero.** Each metric is null
on its own when its Helix read failed, and a row with every metric null is
refused, so "we looked and could not tell" never reads as "there were none".

**Sampled in the engine, not by a module.** `StreamGaugeSampler`
(`api/src/stream-gauge-sampler.ts`) ticks five seconds into every minute. It
calls Helix with the broadcaster's token and writes a system table, neither of
which module code may do ([engine integrity](./engine-integrity.md)), so
it is not a module background task the way `timer_expiry` is. It sits in the
api next to `getStreamStatus` and the session resolver, which already hold the
token setting and open and close segments.

**Only while live.** A tick does nothing unless a segment is open, so an
offline session gets no rows rather than a flat line of zeroes, and
`RecordStreamGaugeSample` itself refuses a sample when no segment is open or
the sample predates the open one. A tick also skips the minute when Helix
says the stream is not live, which it does for a minute or two after
`stream.online` arrives: those minutes are left unsampled rather than guessed.

**A 429 is waited out, not dropped.** A rate-limited read is retried after
Twitch's `Ratelimit-Reset`, or with doubling waits when it names none, for up
to 45 seconds into the minute. A metric still limited after that is left null
in that minute's row, with a warning; the others are recorded.

## Reading the log

Five engine RPCs read the log and the samples
(`api/src/routes/analytics.ts`), backed by `UserEventService`'s
`GetStreamSessionEventTotals`, `GetViewerEventTotals`,
`ListViewerLeaderboard` and `ListStreamSessionUserEvents` and by
`StreamGaugeService.ListStreamGaugeSamples`:

| RPC | Answers |
|---|---|
| `getStreamSessionTotals(sessionId)` | Bits, cheers, subs, gifted subs, follows, raids and raiders for a session, plus peak and average viewers from its samples. |
| `getViewerTotals({ platform, platformUserId, sessionId? })` | Bits, cheers, subs gifted and gifts for one viewer, in a session or over their lifetime. |
| `getLeaderboard({ metric, sessionId?, minTotal?, limit? })` | Top cheerers (`bits`) or gifters (`giftedSubs`), keeping viewers at or above `minTotal`. |
| `getStreamSessionGauges(sessionId)` | Every sampled minute of a session, oldest first. |
| `getStreamSessionEvents({ sessionId, limit? })` | The events the session totals count, oldest first, as `cheer`, `follow`, `sub`, `giftedSubs` or `raid` with the viewer's name and amount, for placing them on a timeline. At most `limit` (1-1000, default 500), with `total` saying how many there are in all. |

Each returns `null` for a session that does not exist.

**A session owns a span of time, and its events are the ones in it.** A session
runs from its start until the session that replaced it began, or to now while
it is open. A split closes one session and opens the next at the same instant,
so sessions tile time and every event lands in exactly one. The reads resolve
the session to that window once, from the session record, and select events by
`occurred_at` — a range scan on the index the fact log already has. The stamped
`session_id` is not read at all.

That is the "resolve once, not per row" the stamp requires, and it was chosen
over a materialised canonical column because there is nothing to keep in step:
a split or merge changes the session's bounds and the next read follows. It
also counts events that were published unstamped (before the first
`session.started` reached a process) and offline events between broadcasts,
which belong to the session that was open, as sessions intend. Any future
operation that moves time between sessions must keep their bounds describing
the time each one owns.

The gauge reads resolve through segments instead, because samples are only
ever taken inside one and carry its id.

**What counts as what.**

- *Subs* are subscriptions viewers took out or renewed themselves: new subs
  not paid for by a gift, plus resubs. *Gifted subs* are counted from the
  gifter's side, the gift's `amount`. The gifted `Subscribe` rows are left out
  of subs, so the two add up without counting a gift twice. Telling a gifted
  sub from a paid one reads `isGift` out of the payload JSON; the extraction is
  spelled per dialect and runs only on sub rows inside the window.
- *Peak* and *average viewers* use the minutes that have a viewer count; an
  unsampled minute or a failed read is left out, not counted as zero. Both are
  `null` when no minute was sampled.
- *Session events* are the rows the totals count and nothing else: a gift is
  its gifter's `SubscriptionGift` alone, never its recipients' gifted subs,
  so the list and the totals agree on what happened.
- *Lifetime* is every event recorded, regardless of session, so merges and
  splits cannot change it.

**Anonymous events count for the channel and for nobody.** They carry no
`platform_user_id`, so they are in session totals and never in a viewer's
totals or on a leaderboard. A viewer is `(platform, platform_user_id)`; the
name shown is the one on their most recent event, because names change.

## Summaries to the UI

When a session ends, `SessionSummaryEmitter` (`api/src/session-summary-emitter.ts`)
reads it back and sends one `SESSION_SUMMARY` webhook
(`EngineEventType.SESSION_SUMMARY`, `"session.summary"`) over the same
channel as every other engine callback. It subscribes to `session.ended` on
the bus like any other consumer; the resolver does not call it, so a slow read
cannot hold up the next session being adopted.

The payload is `SessionSummaryEvent` in `shared/clients/typescript/api/webhooks.ts`:

```ts
interface SessionSummaryEvent {
  type: "session.summary";
  sessionId: string;          // the stable key; equals session.id
  schemaVersion: number;      // SESSION_SUMMARY_SCHEMA_VERSION, currently 1
  generatedAt: string;        // ISO 8601; when the engine computed this snapshot
  session: StreamSession;     // closed, with its segments oldest first
  totals: SessionSummaryTotals;
}

// StreamSessionTotals without its sessionId.
type SessionSummaryTotals = {
  bits: number;
  cheers: number;
  subs: number;               // self-paid new subs + resubs; excludes gifted
  giftedSubs: number;         // counted from the gifter's side
  follows: number;
  raids: number;
  raiders: number;
  peakViewers: number | null; // null when no minute was sampled
  averageViewers: number | null;
  viewerSampleMinutes: number;
};

interface StreamSession {
  id: string;
  status: "open" | "closed";  // always "closed" in a summary sent on session.ended
  startedAt: string;          // ISO 8601
  endedAt: string | null;     // ISO 8601; set in a summary sent on session.ended
  segments: { id: string; startedAt: string; endedAt: string | null }[];
}
```

`session` and `totals` are exactly what `getStreamSession(sessionId)` and
`getStreamSessionTotals(sessionId)` return at the moment of sending — the
emitter calls the same functions — so every figure means what [What counts as
what](#reading-the-log) says it means.

**Summaries only.** Nothing in the payload names a viewer. This is the copy of
a stream's history that leaves the streamer's machine for a multi-tenant
store, which is the reason the [PII constraint](#two-constraints-to-design-against)
gives for sending summaries at all. Leaderboards and per-viewer totals stay in
the engine, read over RPC while the engine has them.

**Every delivery is a whole snapshot, and repeats are expected.** A receiver
stores the summary keyed on `sessionId`, replaces a stored one whose
`generatedAt` is older, and ignores one whose `generatedAt` is newer. That
makes a redelivery harmless and lets the engine re-summarise a session whose
bounds moved — a merge, or a late correction — by sending it again:
`SessionSummaryEmitter.summarise(sessionId)` is safe to call for any session at
any time. A receiver that sees a `schemaVersion` it does not know should keep
the row but not interpret fields it does not understand.

**When it arrives.** A session ends on a split, at the next `stream.online`
past the grace window, so a summary can arrive hours or days after the
stream it describes, and a broadcast that ends with a short dropout is never
summarised until the next real one begins. The session currently open has no
summary; "this stream so far" is a live read, not a stored one.

**A session that was never live** still ends and is still summarised: no
segments, every count zero, `peakViewers` and `averageViewers` null,
`viewerSampleMinutes` zero. That is a real answer, not a missing one.

**What can be missed.** The webhook is best-effort, like every engine
callback: a UI that is not registered or not reachable when the session ends
does not get that summary, and nothing retries it. Sessions ended before the
UI started storing summaries have none either. Both are recoverable from the
engine while its database lasts — `listStreamSessions` plus
`getStreamSessionTotals` yield the same two halves the webhook carries.

## Two constraints to design against

**The stamped session id is not a stable key.** Splits move segments between
sessions retroactively, so a reader aggregating events must not group on the
stamp — see [Splits are
retroactive](/services/stream-sessions#splits-are-retroactive-and-events-are-immutable).
The reads above resolve the session to its time window once per query instead.

**Per-viewer rows are personal data.** A leaderboard of who spent what is the
first thing this system will hold that a viewer could reasonably ask to have
deleted. Retention and deletion are a design input here, not an operational
afterthought, and they are the reason step 5 sends summaries rather than
shipping every viewer's activity to a multi-tenant store.

## Gaps that block specific questions

| Question | Blocked by |
|---|---|
| Gifts in the UI's live feed | The UI drops `SubscriptionGift`: no `PlatformEventType` for it (`client/src/lib/platforms/engine-events.ts:5-8`, woofx3-ui). The engine already broadcasts it, and "users who gifted N subs" is answered from the log by `getLeaderboard`. |

The dashboard's "recent" figures read the log too, by time rather than by
session: `UserEventService.ListRecentUserEvents` returns the latest events at
or after a given instant and how many there were. `getDashboard().recentActivity`
is the latest twenty of the last 24 hours, and `getDashboardStats().recentEvents`
is the count for the same span (`api/src/routes/dashboard.ts`). Both are empty
or zero on a quiet day, which is the true answer. `getDashboardStats` has no
account count: the engine is single-tenant and has nothing to count.

## Build order

Each step is independently useful and safe to stop after:

1. **Write the facts** — done. `user_events` carries the session and the
   time axis, and every platform event is written as it arrives. Nothing reads
   it yet; the corpus accumulates from the day it landed.
2. **Expose sessions** — done. `listStreamSessions` / `getStreamSession` on
   the engine surface return sessions with their segments, so the UI can
   enumerate past streams and see when each was actually live.
3. **Sample the gauges** — done. Viewer count per minute, Helix totals on the
   same tick, stored per segment in `stream_gauge_samples`.
4. **Query the log** — done. Per-session totals, per-viewer totals,
   leaderboards and gauge series as engine RPCs, resolving each session to
   its time window once per query.
5. **Summarise to the UI** — the engine half is done: a `SESSION_SUMMARY`
   webhook on `session.ended`, one whole snapshot per session. The Convex
   table behind it lives in the UI repository.
6. **Backfill** what `workflow_executions.trigger_event` and `alerts.payload`
   can supply, once there is something to backfill into.

Step 1 came first because it is the only one that cannot be added
retroactively: a day without it is a day of history that does not exist.
