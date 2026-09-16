# Stream sessions

::: warning Design, not behaviour
Nothing on this page is implemented. It describes an agreed design so the pieces
can be built against one shape. Every "does" below should be read as "will do".
:::

A **stream session** identifies a broadcast and everything that happened during
it. It is a *logical* span, not a physical one: a session may cover several
`stream.online` → `stream.offline` cycles, because a stream can end by accident,
end briefly, or be deliberately treated as continuous with the one before it.

Its purpose is to answer three questions that nothing can answer today:

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

A session owns an ordered list of **segments**, each one an online or offline
span. Segments are what make the logical/physical distinction concrete, and they
are what splitting and merging actually operate on.

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

One component owns the policy. Its inputs are the stream lifecycle events and
the clock; its outputs are the current session and two events. Everything else
in the system consumes those outputs and knows nothing about grace windows.

```
currentSession() -> sessionId
```

It is **durable**. A pending decision held only in memory dies with the process,
and a restart mid-gap would otherwise silently start a new session or lose one.
Sessions and their segments persist in db-proxy; the engine keeps a cached
accessor in the shape of `ensureApplicationId` (`api/src/routes/context.ts:161`),
which is the established pattern for a cached scope id.

### Lifecycle events

| Subject | Fired when | Meaning for consumers |
|---|---|---|
| `session.started` | the resolver opens a new session | A new broadcast has logically begun. |
| `session.ended` | the resolver closes one | The previous broadcast is over. Ephemeral state scoped to it should be dropped. |

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

Every event factory — Twitch, Chat, Module, Obs, Command — routes through the
same `Event()` in `shared/common/typescript/cloudevents/BaseEvent.ts`, which
already defaults `specversion`, `time`, `id` and `source`. The session is
defaulted there, not in each factory's `encodeEvent`.

This is deliberately *unlike* `platform`, which is stamped by the Twitch factory
only (`Twitch/index.ts:112-118`) and is therefore absent from every other
family. Repeating that pattern would produce a session id on Twitch events and
silently nothing elsewhere.

`Event()` is a pure function with no ambient context, so each publishing process
must be told the current session — a module-level holder fed by a
`session.started` / `session.ended` subscription, wired once in the shared
runtime. Every service that publishes needs that wiring; a process that lacks it
would emit unstamped events, which is the same invisible gap in a new place. The
holder should fail loudly rather than emit without a session.

Two mirrors carry the field independently and are easy to forget:

- **Go** — the `Event` struct and `TriggerFields` in
  `workflow/internal/types/types.go:133-159`. That helper exists so trigger
  conditions and step expressions cannot drift, so one edit exposes
  `${trigger.sessionId}` to both.
- **Rust** — `barkloader/lib_sandbox/src/runtime/storage_event.rs:30-42`
  hand-builds its envelope and bypasses the TypeScript factories entirely.

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

## What this does not give you

**Aggregates still need somewhere to count.** Nothing in the system aggregates
anything today: no totals of chats, subs or cheers exist. `widget_status` holds
a last-reported value per key and explicitly discards history
(`db/database/models/widget_status.go:14-17`); `alert.CountByApplicationID` is
unbounded; the workflow engine's only aggregation lives inside a single waiting
execution and dies with it.

A session id makes per-stream totals *possible* and cheap to query. It does not
make them exist.

**The rules engine is unaffected.** `treats/` contains a README and no
implementation, so there are no facts to retract at a session boundary. If facts
are built later, the boundary is a natural lifecycle hook.

## Build order

Each step is independently useful and safe to stop after:

1. **Resolver and tables.** Nothing consumes the session yet, so this carries no
   risk and can be observed before anything depends on it.
2. **Central stamping** — TypeScript, then the Go and Rust mirrors.
3. **Storage rename and a clear RPC** called on `session.ended`.
4. **The Convex field and the two UI call sites.**
