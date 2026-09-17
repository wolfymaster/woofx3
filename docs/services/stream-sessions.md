# Stream sessions

::: warning Partly built
**Built:** the extend-or-split policy, the resolver that applies it, the
`stream_sessions` / `stream_session_segments` tables behind
`StreamSessionService`, central stamping in all three languages, and the
`session.started` subscription in every process that publishes — so events now
carry a session id end to end.

**Not built:** "Clearing ephemeral storage" and "Reaching the UI" below are
still design.
:::

A **stream session** identifies a broadcast and everything that happened during
it. It is a *logical* span, not a physical one: a session may cover several
`stream.online` → `stream.offline` cycles, because a stream can end by accident,
end briefly, or be deliberately treated as continuous with the one before it.

Its purpose is to answer three questions:

- **Which broadcast did this event belong to?** — so totals like "chats this
  stream" or "subs this stream" are a group-by rather than a guess.
- **When does ephemeral state stop being relevant?** — so module storage, UI
  feeds and counters clear at the right moment, and *only* at the right moment.
- **Are we still in the same broadcast as a minute ago?** — so a thirty-second
  dropout does not read as a new stream.

## The model

**A session is always present.** There is no gap between sessions and no state
in which the current session is unknown. `stream.online` and `stream.offline`
are *inputs to a decision*, not boundaries in themselves: going live asks
whether to extend the open session or start a new one, and going offline simply
closes a segment within whichever session is open. A session may therefore be
entirely offline.

This matters more than it sounds. Because there is always an answer:

- no event ever carries a null session, so offline chat still counts toward the
  channel's totals;
- `isLive` and the session are orthogonal — a consumer that wants uptime asks
  about the broadcast, one that wants "since this stream began" asks about the
  session;
- there is no bootstrap special case. A fresh engine with no stream history
  opens a session immediately.

### Segments

A session owns an ordered list of **segments**, each one an *online* span: the
stream went live, then it went down. Offline is the gap between segments rather
than a segment of its own.

That is what makes "a session with no segments" mean precisely "a session that
has never been live" — a state the extend-or-split decision treats differently
from "went offline a long time ago", and which therefore must not be represented
by a zero timestamp anywhere along the path.

Segments are what make the logical/physical distinction concrete, and they are
what splitting and merging actually operate on.

### Splits are retroactive, and events are immutable

If the rule is "back within N minutes means the same session", then at the
moment a stream ends we do not yet know which session the *next* events belong
to — but events keep arriving while offline and must be stamped immediately.

So events are stamped optimistically with the open session, and a later split
moves a **segment** to a different session. No event is ever rewritten.

The consequence is a rule every consumer must respect:

> The session id on an event identifies the session that owned its segment *at
> the time of stamping*. It is not a stable key. Reads resolve it through the
> session record to a canonical id.

Merging two sessions is the same operation in the other direction, which is why
"combine data across several streams" needs no separate mechanism.

## Identity

The id is an opaque string. Nothing outside the resolver may parse it, derive
meaning from its shape, or depend on how it is generated — those rules are
deliberately undecided, and the design must not care when they are.

## The resolver

One component owns this: `StreamSessionResolver`
(`api/src/stream-session-resolver.ts`). Its inputs are the stream lifecycle
events and the clock; its outputs are the current session and two events.
Everything else in the system consumes those outputs and knows nothing about
grace windows.

The rule is separate again, in `api/src/stream-session-policy.ts`, so it can
change without touching either persistence or the bus. The resolver is the only
thing that joins the two.

The extend-or-split decision happens at `stream.online` and nowhere else.
Because a session is always present and only ends when a new one replaces it,
nothing is ever pending: there is no scheduled close to fire and no in-flight
decision for a restart to lose.

It is still **durable**, but for a simpler reason than a timer would need. What
has to survive a restart is the session row and the end of its last segment,
because that is the input the next decision reads. Both live in db-proxy behind
`StreamSessionService`.

Two partial unique indexes hold the invariants the rest of the design leans on:
at most one open session per application, and at most one open segment. They sit
in the schema rather than in resolver code because a concurrent second writer
should fail a write, not silently corrupt the history every future aggregate
will be computed from. A duplicate `stream.online` is the ordinary case — Twitch
redelivers notifications — and two open segments would give "when did the stream
last go down" two answers.

`EnsureCurrentStreamSession` returns the open session and both decision inputs
in one call, opening a session when none is open. That is what makes "a session
is always present" true rather than aspirational, and it gives the invariant one
owner instead of every caller.

The cost of deciding only on the way up is that a session's end is recognised
when the next broadcast begins, not when the last one stopped — so anything
keyed on `session.ended`, clearing included, lags until then.

### Lifecycle events

| Subject | Fired when | Meaning for consumers |
|---|---|---|
| `session.started` | a new session opens, and again when the resolver starts | The session to stamp is now this one. |
| `session.ended` | the resolver closes one | The previous broadcast is over. Ephemeral state scoped to it should be dropped. |

`session.started` states the current session rather than marking a boundary. The
resolver re-announces on startup so a process that restarted learns the session
immediately, instead of publishing unstamped until the next broadcast — which on
a quiet day is hours. Receiving the same id twice is expected; handling it must
be idempotent.

Neither event is itself session-stamped. An event that announces a session must
not also claim to have happened during one, so the resolver passes an explicit
`sessionId: undefined` to override the ambient holder. Undefined drops out at
serialization, leaving the attribute absent rather than null.

`session.ended` fires on a **split** — not on `stream.offline`. It may arrive
long after a stream ended, and for a brief dropout it never arrives at all.
Anything that clears state must listen for this and not for the stream going
down, or a reconnect will wipe exactly the state this concept exists to
preserve.

## Stamping

The session id travels as a CloudEvents extension attribute, beside `platform`.
Aggregates then become a group-by instead of a join, and no consumer has to ask
a resolver what session it is in.

### It is stamped centrally

Every event factory — Alert, Chat, Command, Module, Obs, Slobs and Twitch —
routes through the same `Event()` in
`shared/common/typescript/cloudevents/BaseEvent.ts`, which already defaults
`specversion`, `time`, `id` and `source`. The session is defaulted there, not in
each factory's `encodeEvent`.

This is deliberately *unlike* `platform`, which is stamped by the Twitch factory
only (`Twitch/index.ts:112-118`) and is therefore absent from every other
family. Repeating that pattern would produce a session id on Twitch events and
silently nothing elsewhere.

`Event()` is a pure function with no ambient context, so each publishing process
must be told the current session — a module-level holder fed from the bus by
`subscribeToSessionUpdates` (`cloudevents/session-subscriber.ts`), and by
`services::session` on the Rust side. Every service that publishes needs that
wiring; a process that lacks it emits unstamped events, which is the same
invisible gap in a new place.

The subscription is to `session.started` **only**. `session.ended` means a
finished session's state should be dropped, not that a publisher should forget
what to stamp: the resolver emits `ended` immediately followed by `started` for
the successor, so clearing on `ended` would publish unstamped events in the gap
between the two messages. A session is always present, so the holder should
never empty once filled.

All four publishing processes subscribe — `twitch/`, `woofwoofwoof/` and
`barkloader/` from the bus, and `api/` from the resolver directly, since it is
the process emitting the announcement.

The holder therefore warns once per gap instead of passing silently. It does not
throw: `Event()` sits on every publish path in every service, and events are
legitimately published before the first `session.started` arrives, so a startup
race would become a dead service rather than a missing attribute. The warning
targets the case worth finding — a process nobody ever wired up.

Two mirrors carry the field independently and are easy to forget:

- **Go** — the `Event` struct and `TriggerFields` in
  `workflow/internal/types/types.go:133-159`. That helper exists so trigger
  conditions and step expressions cannot drift, so one edit exposes
  `${trigger.sessionId}` to both.
- **Rust** — `shared/common/rust/cloudevents`, the Rust half of the same
  library. Rust publishers previously hand-built a `json!` literal per call
  site, which had already produced two different `specversion` values; they now
  route through `BaseEvent::new` for the same reason the TypeScript ones route
  through `Event()`.

  `heartbeat.rs` stays outside it deliberately. A readiness ping fires whether
  or not anyone is broadcasting, so a session id on one would mean nothing, and
  its shape is pinned against the Go `NewHeartbeatEvent` that consumers parse.

There is no `BaseEvent` struct on the Go side; the de facto envelope is the
`Event` struct above. There is also no TypeScript decode function — every
consumer hand-rolls `msg.json()` with a `ce.data ?? ce` fallback — so nothing
validates the attribute on the way in.

## Clearing ephemeral storage

The machinery already exists and has never been connected.

`db/proto/v1/storage.proto:36` defines `clear_on_stream_end`, persisted and
round-tripped through `storage_service.go`, **read by nothing**. Alongside it,
`ClearNamespace`, `ClearExpired` and `ClearAllForApplication` have no callers
anywhere in the repository. What is missing is the signal, not the mechanism.

`session.ended` is that signal. The field should be renamed
`clear_on_session_end`: nothing reads it, so the rename is safe — the wire
protocol only cares about the field number — and leaving it named for stream end
would describe the opposite of when it fires.

Modules cannot clear their own storage and should not be able to: the sandbox
exposes only `get` and `set`
(`barkloader/lib_sandbox/src/host/mod.rs:15-18`). Clearing is the engine's job,
which is the [engine integrity](./engine-integrity.md) rule working as intended
— a module declares that a key is session-scoped, and the engine acts on it.

### Two defects in the same code path

Both are live today and both sit in the key format this work touches:

- No writer populates `namespace`, `expires_at` or `clear_on_stream_end`.
  `barkloader/lib_module/src/db_proxy.rs:1867-1873` sends only `key`, `value`
  and `application_id`, so all three metadata fields are permanently empty.
- The storage key is `<application_id>\x00<key>`
  (`db/app/services/storage_service.go:40-42`) with **no module segment**, so
  two modules writing `"count"` collide.

## Reaching the UI

The engine owns the boundary; Convex receives it. `instanceLiveState` gains one
optional `sessionId`, written by the three paths that already maintain that row:
`onStreamOnline` and `onStreamOffline` (`convex/http.ts:974`, `:987`) and
`recordPoll` (`convex/streamStatus.ts:26`), all in the woofx3-ui repository.

`instanceLiveState` is a latest-value row. A reader can observe that the session
*changed* but never that one *ended*, so anything that must react to an ending
needs the bus event rather than the row.

Two existing consumers are hand-rolling this concept against the wrong key and
should move to the session:

- `stream-stats.tsx:51-54` resets its tallies when `startedAt` changes. A
  dropout gives a new `startedAt`, so the tallies wipe mid-stream.
- `convex/pins.ts:118` decides whether a stored Twitch message id is still
  pinnable by comparing against the broadcast start, when what it means is
  "same session".

Uptime readers — `broadcast-shell.tsx:141`, `stream-status.tsx:21`,
`stream-stats.tsx:85` — stay on `startedAt`. Uptime genuinely means the physical
broadcast.

## Analytics is a separate subsystem

Nothing in the system aggregates anything today: no totals of chats, subs or
cheers exist. `widget_status` holds a last-reported value per key and explicitly
discards history (`db/database/models/widget_status.go:14-17`);
`alert.CountByApplicationID` is unbounded; the workflow engine's only
aggregation lives inside a single waiting execution and dies with it.

Producing aggregate values from events and stream statistics is **Analytics**, a
subsystem still to be built. Sessions are not that subsystem and do not
partially implement it — a session id makes per-stream totals *possible* and
cheap to query, it does not make them exist.

What sessions give Analytics is the partition key. "Total chats" is meaningless
without a definition of which chats, and that definition has to exist *at the
moment each event is published*, because a boundary nobody recorded cannot be
reconstructed afterwards — the timestamps alone cannot tell a deliberate break
from an accidental one. Building sessions first means events are correctly
attributed from the day the stamp lands, and Analytics inherits a corpus it can
group rather than one it must guess at.

One property to design against when that work starts: the id on an event is not
a stable key (see [Splits are retroactive](#splits-are-retroactive-and-events-are-immutable)),
so aggregation resolves it to a canonical session. Doing that per row does not
scale to the volumes Analytics will read. The likely shapes are resolving once
per segment rather than per event, or materialising a canonical id alongside the
stamped one — either is cheap to add later, and neither is worth building before
there is something counting.

**The rules engine is unaffected.** `treats/` contains a README and no
implementation, so there are no facts to retract at a session boundary. If facts
are built later, the boundary is a natural lifecycle hook.

## Build order

Each step is independently useful and safe to stop after:

1. **Resolver and tables** — done.
2. **Central stamping**, TypeScript plus the Go and Rust mirrors — done.
3. **Feed the holders** — done. Every publishing process subscribes to
   `session.started` and sets its language's holder, which is what turned steps
   1 and 2 into observable behaviour.
4. **Storage rename and a clear RPC** called on `session.ended`.
5. **The Convex field and the two UI call sites.**
