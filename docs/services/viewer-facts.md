# Viewer facts

::: warning Partly built
**Built:** fact definitions stored as data and validated against the `emits`
of the triggers they read (`ViewerFactService` in the db proxy), per-viewer
values for every aggregate below in lifetime and session windows, and the
projector in the workflow service that counts every bus event a definition
matches before workflows see it.

**Not built:** segments and their enter/leave events, `${viewer.*}` in
workflow conditions and templates, a `facts` section in module manifests,
built-in facts, backfill from `user_events`, presence and watch time, and any
UI. A definition can only be saved through the `UpsertFactDefinition` RPC.
:::

A **viewer fact** is a running per-viewer value folded from trigger events:
how many times a viewer said "apple", how many bits they have cheered, when
they last chatted, how many streams in a row they showed up for. A fact is
defined as data, so adding one needs no migration and no code: every fact's
values share one table, `fact_values`, keyed by
`(fact_id, platform, subject_id, window_key)`.

Only the db proxy reads or writes fact storage. The workflow service evaluates
definitions against events and sends the db proxy deltas; the db proxy folds
them.

## A fact definition

```json
{
  "id": "user:fact:apple_mentions",
  "name": "Apple mentions",
  "window": "lifetime",
  "definition": {
    "sources": [
      {
        "trigger": "twitch_platform:trigger:user_message",
        "subject": "chatterId",
        "where": { "path": "message", "op": "regex", "value": "(?i)\\bapple\\b" }
      }
    ],
    "aggregate": { "fn": "count" }
  }
}
```

The RPC takes the body (`definition`) as a JSON string and the window as
`window_kind`; the outer object above is only how this page shows them
together.

| Field | Meaning |
|---|---|
| `id` | Canonical fact id, e.g. `user:fact:<slug>`. At most 255 characters. |
| `sources` | One or more trigger sources. The aggregate runs across all of them. |
| `sources[].trigger` | Canonical trigger id, `{moduleId}:trigger:{manifestId}`. |
| `sources[].subject` | Emits path of the field naming the viewer. It must be an [identity field](/barkloader/modules#identity-fields). |
| `sources[].where` | Optional [condition tree](#the-where-tree) an event must satisfy. Without one, every event of the trigger counts. |
| `sources[].value` | Emits path of the value the aggregate reads. Required by `sum`, `min`, `max` and `last`; refused by every other aggregate. |
| `aggregate.fn` | How matching events fold into one value; see [Aggregates](#aggregates). |
| `window` | `lifetime` (one value per viewer) or `session` (one value per viewer per [stream session](/services/stream-sessions)). |

Unknown keys are refused, so a misspelt key fails the save instead of being
dropped. Every path a source reads (`subject`, `where`, `value`) must be a
field the trigger declares in `emits`.

When several sources of one definition match the same event for the same
viewer, the event counts once, through the first matching source in
declaration order.

## Aggregates

| `fn` | Value field | Stored | Folds |
|---|---|---|---|
| `count` | none | number | Adds 1 per matching event. |
| `sum` | `number` | number | Adds the value. |
| `min` | `number` | number | Keeps the smallest value seen. |
| `max` | `number` | number | Keeps the largest value seen. |
| `last` | `number` or `string` | number or string | Keeps the most recent value. Every source's value field must have the same type. |
| `first_at` | none | timestamp | The earliest event time, in epoch milliseconds. |
| `last_at` | none | timestamp | The latest event time, in epoch milliseconds. |
| `sessions` | none | number | The number of distinct stream sessions with at least one matching event. |
| `session_streak` | none | number | The number of consecutive sessions with a matching event. |

`sessions` and `session_streak` need the `lifetime` window: within one session
either is always 1.

A streak counts sessions that went live. A session that never went live
(offline chat between streams) neither extends nor breaks one. A streak is not
reset when a stream ends; it is reset to 1 on the viewer's next matching event
after they missed a live session.

An event with no value at the source's `value` path is skipped for that
source. A value of the wrong type (text where `sum` expects a number) is
logged once per definition revision and source, and the event's other deltas
still apply.

## The `where` tree

`where` is a condition tree, not an expression string, so a builder can edit
it and the db proxy can check every path it reads. Each node is exactly one of:

```json
{ "all": [ ...nodes ] }
{ "any": [ ...nodes ] }
{ "not": node }
{ "path": "message", "op": "contains", "value": "apple" }
```

An empty `all` or `any` is refused. To count every event, leave `where` out.

The operators are the workflow condition operators: `eq`, `ne`, `gt`, `gte`,
`lt`, `lte`, `contains`, `starts_with`, `ends_with`, `in`, `not_in`, `exists`,
`not_exists`, `regex` and `between`, with their usual aliases (`==`, `!=`,
`>`, `>=`, `<`, `<=`, `equals`, `not_equals`, `matches`, `range`). `in` and
`not_in` take a list, `between` takes `[min, max]`, and `regex` takes a
pattern that must compile.

- **Values are literal.** `${...}` in a value is compared as text, never
  resolved.
- **A missing path reads as null.** Null only satisfies `not_exists`, `ne`,
  `not_in`, and `eq` or `in` against null. Every other operator is false, so
  `{ "path": "x", "op": "contains", "value": "nil" }` never matches a missing
  `x`.
- **Text operators compare text.** `contains`, `starts_with`, `ends_with` and
  `regex` read the value as text. `contains` on a list therefore searches its
  printed form, not its elements; use `in` to test membership.
- **Text matching is case-sensitive.** Use a `regex` with `(?i)` for a
  case-insensitive match.

## Identity and fan-out

A fact's subject comes from an emits field annotated `"identity": "viewer"`;
see [Identity fields](/barkloader/modules#identity-fields) for the
annotation, `anonymousWhen` and `displayName`. A trigger that annotates no
field cannot feed a fact.

- **One viewer.** A `string` identity field names one viewer. Its
  `displayName`, when declared, is stored with the value as the viewer's most
  recently seen name.
- **Fan-out.** An `array` identity field is a list of string ids, and the event
  counts once for each distinct id in it. Empty and null entries are skipped.
  A list carries no display names.
- **Anonymous events.** When the identity's `anonymousWhen` field is true, the
  whole event is skipped, including every id of an array identity.
- An event without a platform, or without an id at the identity path, is about
  no viewer and counts toward nothing.

A viewer is `(platform, subject_id)`, with ids up to 100 characters.

## Validation and status

A definition is validated at save, and again every time definitions are
listed, since a module upgrade can change what a trigger emits after a
definition was saved against it. Each definition carries a status:

| Status | When | Counted |
|---|---|---|
| `active` | Every source's trigger is registered and the source fits its `emits`. | Yes |
| `unresolved` | A source names a trigger that is not registered: its module is not installed yet, or its trigger was archived. | No |
| `invalid` | A source no longer fits its trigger's `emits` (a path was removed, a type changed, the subject lost its identity annotation), or the value type of a `last` fact changed. | No |

At save, an invalid definition is refused. An unresolved one is accepted only
from a module (`created_by_type` `MODULE`), since a module may declare a fact
over a trigger of a module installed after it; a definition saved from the UI
over a missing trigger would count nothing, so it is refused. An unresolved
definition turns active as soon as its trigger registers.

The workflow service logs a definition that is not counting once per change
of revision, status or reason.

## Where events are counted

```
trigger event on the bus
  -> workflow service: validate the CloudEvent, drop a repeated delivery
  -> fact projector: match definitions, build one batch of deltas
  -> ApplyFactDeltas (db proxy, one transaction)
  -> workflow engine: match and run workflows
```

The projector subscribes to every event pattern an active definition's
triggers publish on, through the same registrar the workflows use. It runs
**before** workflows for the same event, so a workflow the event starts reads
values that already include it. That is what will let `${viewer.*}` see the
triggering event.

- **One call per event.** Every delta an event causes, across every definition
  and every viewer, goes to the db proxy in one `ApplyFactDeltas` call. An event
  that matches no definition makes no call.
- **Bounded.** The call has a 1 second timeout. A failure is logged and the
  event still reaches the workflow engine: a slow db proxy may cost an event
  its fact deltas, never its workflows. After 5 consecutive timeouts or
  transport errors, fact writes pause for 30 seconds (logged once when they
  pause and once when they resume), so a stalled db proxy does not delay every
  workflow that shares the event's subscription.
- **Idempotent.** The db proxy records each applied event by
  `(source, event id)` in the same transaction as the values, so a redelivered
  event is applied once. The record is kept for `FACT_DEDUPE_RETENTION_PERIOD`
  (default 6 hours). Publishers must keep `(source, id)` unique per event: the
  workflow service also drops a delivery whose pair it has recently seen.
- **Not counted while loading.** Events that arrive before the first list of
  definitions succeeds (at startup, or while the db proxy is unreachable) are
  not counted.
- **Not counted:** events with CloudEvents source `api` (dashboard simulations)
  and dry runs, since neither is something a viewer did.
- **Definition changes** reach the projector through the `db.viewer.fact.>` and
  `db.module.trigger.>` lifecycle events, and through a re-list every 5
  minutes as a safety net.

### Session windows

The session a delta belongs to is resolved in the db proxy from the event's
time: the stream session with the latest start at or before it. The
`sessionId` stamped on the event is used only when no session had started by
then.

Session splits are decided after the fact (see [Stream
sessions](/services/stream-sessions#splits-are-retroactive-and-events-are-immutable)).
An event in the first moments after going live may be credited to the previous
session until the split commits.

### Ordering

Events can arrive out of order. A late event never moves a value backwards:
`first_at` and `last_at` keep the earliest and latest times, `last` keeps the
value of the latest event, and an event from an earlier session neither counts
a session again nor breaks a streak.

### Deltas that do not apply

Each delta names the definition revision it was computed against. A delta that
cannot apply is set aside on its own and the rest of the event's deltas apply.
The response counts each kind:

| Count | Delta |
|---|---|
| `dropped` | Computed against a stale revision, or for a deleted definition. |
| `invalid` | Does not fit its definition: wrong aggregate, missing or extra input, a non-finite number, a value of the wrong kind, or a repeat of a fact and viewer already in the same event (the first is kept). |
| `skipped` | Needs a session window, but no stream session resolves for the event's time. |

## Changing a definition

Saving a definition with a different body or window is a new revision: the
revision increments, every stored value of the fact is deleted in the same
transaction, and `counting_since` restarts, so a value is only ever folded
under one definition. A change to the name or description alone keeps the
values. Saving an identical definition writes nothing.

`counting_since` is what the UI shows as "counting since". Chat is not logged,
so a fact over chat counts from when it was created (or last revised) and
cannot be backfilled. Money and membership events are kept in `user_events`
(see [Analytics](/services/analytics#the-fact-log)); `backfilled_through` is
reserved for a backfill from that log.

## Who owns a definition

A definition records who declared it: `USER` for one saved from the UI,
`MODULE` (with the module as `created_by_ref`) for one a module declares.
Saving over an id held by a different creator is refused. Deleting is not
restricted by creator, so the UI can delete a module's fact; deleting a
definition deletes its values.

## Reading values

`GetViewerFacts(platform, subject_id)` returns one viewer's lifetime values
and their values in the current stream session, with that session's id and
the viewer's most recently seen display name. A fact the viewer has no value
for is absent.

## Examples

### Counting a word

Every chat message containing the word "apple", as a word in any case, per
viewer and over their lifetime:

```json
{
  "sources": [
    {
      "trigger": "twitch_platform:trigger:user_message",
      "subject": "chatterId",
      "where": {
        "all": [
          { "path": "message", "op": "regex", "value": "(?i)\\bapple\\b" },
          { "not": { "path": "message", "op": "starts_with", "value": "!" } }
        ]
      }
    }
  ],
  "aggregate": { "fn": "count" }
}
```

Saved with `window_kind` `lifetime`. The `not` leaves out chat commands. A
message that says "apple" three times counts once: `count` counts events, not
occurrences. With `window_kind` `session` the same body counts apples per
stream.

### Total bits

Every bit a viewer has cheered, ignoring anonymous cheers:

```json
{
  "sources": [
    {
      "trigger": "twitch_platform:trigger:channel_cheer",
      "subject": "userId",
      "value": "amount"
    }
  ],
  "aggregate": { "fn": "sum" }
}
```

This needs the trigger's `userId` field to be annotated
`"identity": "viewer"` with `"anonymousWhen": "isAnonymous"`, as in the
[Identity fields](/barkloader/modules#identity-fields) example. `amount` is a
`number` field, which `sum` requires. Adding the chat message's `amount` as a
second source would count each cheer twice, since a cheer also arrives as a
chat message.
