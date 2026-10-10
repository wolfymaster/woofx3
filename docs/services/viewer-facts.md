# Viewer facts

::: warning Partly built
**Built:** fact definitions stored as data and validated against the `emits`
of the triggers they read (`ViewerFactService` in the db proxy), per-viewer
values for every aggregate below in lifetime and session windows, the
projector in the workflow service that counts every bus event a definition
matches before workflows see it, [segments](#segments) and their
[enter/leave events](#segment-edge-events), and
[`${viewer.*}`](#facts-in-workflows-viewer) in workflow conditions and
templates.

**Not built:** `facts` and `segments` sections in module manifests, built-in
and platform facts, backfill from `user_events`, presence and watch time, and
any UI. Facts and segments can only be saved through the
`UpsertFactDefinition` and `UpsertSegmentDefinition` RPCs.
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
        "trigger": "woofx3_twitch:trigger:user_message",
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
pattern that must compile. An unknown operator, or a value its operator cannot
use, is refused at save; the operator list is shared with the workflow
service (`shared/common/golang/conditions`), so the db proxy saves no
operator or value that the workflow service would refuse.

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
| `invalid` | A source no longer fits its trigger's `emits` (a path was removed, a type changed, the subject lost its identity annotation), the value type of a `last` fact changed, the trigger's event pattern has a `>` that is not its last token, or the trigger receives [segment edge events](#segment-edge-events). | No |

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
values that already include it, which is how `${viewer.*}` sees the
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
  (default 6 hours) and pruned `FACT_DEDUPE_PRUNE_BATCH_SIZE` rows at a time
  (default 1000). Publishers must keep `(source, id)` unique per event: the
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
values. Saving an identical definition writes nothing. A revision also
[refills](#silent-changes) the segments that read the fact, in the same
transaction.

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
definition deletes its values. A fact a segment reads cannot be deleted: the
delete fails with `failed_precondition`, naming the segments.

## Reading values

`GetViewerFacts(platform, subject_id)` returns one viewer's lifetime values
and their values in the current stream session, with that session's id and
the viewer's most recently seen display name. A fact the viewer has no value
for is absent, and so is a fact that is not `active`, since its stored value
has stopped counting.

## Segments

A **segment** is a named condition over a viewer's facts: "has gifted 100
subs", "chatted this stream", "not seen for 30 days". The db proxy keeps each
segment's members current as facts change, and announces every viewer who
[enters or leaves](#segment-edge-events) one.

```json
{
  "id": "user:segment:big_gifters",
  "name": "Big gifters",
  "when": { "fact": "user:fact:gifted_subs", "op": "gte", "value": 100 }
}
```

`UpsertSegmentDefinition` takes `when` as a JSON string.

| Field | Meaning |
|---|---|
| `id` | Canonical segment id, `{owner}:segment:{slug}`: `user:segment:<slug>` for one saved from the UI, `<moduleId>:segment:<slug>` for one a module declares. At most 255 characters. |
| `name` | Required. |
| `description` | Optional. |
| `when` | The [condition tree](#the-when-tree) a viewer's facts must satisfy. |

Ownership works as it does for facts: saving over an id held by a different
creator is refused. A change to `when` is a new revision and
[refills](#silent-changes) the membership; a change to the name or
description alone keeps it. Saving an identical segment writes nothing.

### The `when` tree

`when` has the shape of the [`where` tree](#the-where-tree), but an atom reads
one of the viewer's facts instead of a path of the event:

```json
{ "all": [ ...nodes ] }
{ "any": [ ...nodes ] }
{ "not": node }
{ "fact": "user:fact:gifted_subs", "op": "gte", "value": 100 }
```

Unknown keys are refused, each node is exactly one kind, `all` and `any` must
not be empty, and every fact an atom names must exist, in any status; a save
naming a fact that does not exist fails with `not_found`.

| `op` | `value` | Fact kinds | True when the viewer's value |
|---|---|---|---|
| `eq`, `ne` | A number or a string, matching the fact's kind | any | equals, or differs from, `value` |
| `gt`, `gte`, `lt`, `lte` | A number | `number`, `timestamp` | compares so with `value` |
| `exists`, `not_exists` | none | any | is present, or missing |
| `within` | A duration | `timestamp` | is at most the duration before now |
| `older_than` | A duration | `timestamp` | is more than the duration before now |

The operators have no aliases. A timestamp is epoch milliseconds, so `gt`
against one takes milliseconds. A duration is a positive Go duration string:
`"90m"`, `"36h"`, and `"720h"` for 30 days, since there is no day unit. "Now"
is the time of the event being applied, or the save time when a segment is
[filled](#silent-changes).

A fact the viewer has no value for, such as a session fact they have not
touched this stream, is **missing**. Only `not_exists` and `ne` are true for a
missing value, so `{ "not": { "fact": "user:fact:gifted_subs", "op": "gte",
"value": 100 } }` holds for a viewer who never gifted.

### Windows

A segment that reads any session fact is a **session segment**
(`window_kind` `session`): its membership belongs to the current stream
session, and its session facts read their value in that session. A new session
starts it empty. The previous session's members are dropped without a `left`
event, so going live does not announce every viewer at once. Any other segment
is a `lifetime` segment. The window follows the facts a segment reads, so a
fact revision that changes a fact's window moves it too.

### When membership changes

Membership is evaluated only inside `ApplyFactDeltas`, in the transaction that
folds an event's deltas: for each viewer whose values changed, and for each
segment reading a fact that changed. Nothing is evaluated on a clock.

- **A segment without `within` or `older_than`** compares the condition after
  the event with the stored membership. The viewer enters when the condition
  holds and they are not a member, and leaves when it fails and they are. A
  viewer enters once, however many later events keep them in.
- **A time-relative segment** (one with a `within` or `older_than` atom,
  listed with `time_relative` true) can turn true or false with time alone, so
  its stored membership may be stale. It compares the condition before the
  event's changes with the condition after them, both at the event's time, and
  announces the difference. That is what announces `left` from "last chatted
  more than 30 days ago" when the viewer returns. The stored membership is
  kept in step, but is only as current as the viewer's last change.

A time-relative segment has one quirk. Before a viewer's first counted event
they have no values, so a time-relative segment that holds for a viewer with
no values announces `left` on that first event, although the viewer was never
a member. For example, "never chatted, or last chatted more than 30 days ago":

```json
{
  "any": [
    { "fact": "user:fact:last_chat", "op": "not_exists" },
    { "fact": "user:fact:last_chat", "op": "older_than", "value": "720h" }
  ]
}
```

This announces `left` for every first-time chatter as well as every returning
one.

A session segment moves only for an event of the current stream session: the
session that owns the later of now and the event's time, so an event stamped
slightly ahead of the db proxy's clock at a session start still counts. A late
event, or one replayed by a backfill, that belongs to an earlier session
neither changes membership nor announces anything. That protection needs
[stream sessions](/services/stream-sessions). With only the `sessionId` stamped
on events, every event counts as current, so a late event moves membership
like any other and can announce a second `entered`. A session segment is
skipped for an event no session resolves for.

### Silent changes

Changes that are not something a viewer did move membership without
announcing anything. Announcing them would run every workflow on the segment
for every viewer at once.

- **Creating a segment, or changing its `when`**, fills its membership in the
  same transaction, at the save time, for every viewer with a value of any fact
  it reads. A viewer with no value of any of them is never filled in, even
  when the condition (a `not_exists`) holds for them.
- **A fact revision**, which deletes the fact's values, refills every segment
  reading the fact in the same transaction.
- **A silent apply** (`silent`, the backfill path) updates membership and
  publishes nothing.
- **Deleting a segment** deletes its members.

### Frozen segments

A segment is **frozen** while a fact it reads is not `active`, or while its
condition no longer fits the kinds of its facts. Applies and fills leave a
frozen segment's membership as it is and announce nothing, until everything it
reads is active again. Evaluating it would move every viewer whose value the
inactive fact hides, so a module upgrade that drops a trigger for a moment
would announce a storm of `left` events, and another of `entered` when the
trigger returns.

A frozen segment misses the applies that happen while it is frozen, so it is
marked stale when a fill or refill skips it. Saving a segment while a fact it
reads is not active succeeds, but reports that its members were not filled.
After every trigger registration, removal or archive, the db proxy reconciles
segments: it marks every frozen segment stale, and refills each stale segment
whose facts are all active again silently, in its own transaction, then
unmarks it. A thawed segment therefore announces nothing for what changed
while it was frozen.

`ListSegmentDefinitions` re-checks every segment, with the facts it reads,
its window, `time_relative` and its revision. Its status is:

| Status | When |
|---|---|
| `active` | The condition fits the facts it reads, and its membership is kept. |
| `frozen` | It is marked stale: a fact it reads is not `active`, so its membership is not kept. It is refilled once every fact it reads is active again. |
| `invalid` | The condition no longer fits a fact's value kind: a fact it reads was saved again with another kind, such as a `last` fact over a field that changed type. `reason` says which. |

### Reading membership

`GetViewerSegments(platform, subject_id)` returns the segments a viewer is in
now: lifetime segments, and session segments entered in the current session,
each with when the viewer entered. A time-relative membership is as of the
viewer's last change.

## Segment edge events

| Subject and type | Published when |
|---|---|
| `viewer.segment.entered` | A viewer's facts start to satisfy a segment. |
| `viewer.segment.left` | A viewer's facts stop satisfying a segment. |

The db proxy writes an edge to its outbox in the transaction that changed the
viewer's facts, so an edge is published exactly when the membership change
commits. The NATS subject equals the CloudEvent type, since workflow triggers
match on type, and the source is `db-proxy`. The `platform` extension carries
the viewer's platform, and `sessionid` the stream session when one is known.
Extension names are lowercase, as CloudEvents requires, so a consumer reading
the envelope must use `sessionid`, not the `sessionId` TypeScript publishers
write; the same value is also in the data as `sessionId`.
These are distinct from the segment lifecycle events,
`db.viewer.segment.upserted.system` and `db.viewer.segment.deleted.system`.

```json
{
  "segmentId": "user:segment:big_gifters",
  "platform": "twitch",
  "viewerId": "141981764",
  "viewerName": "alice",
  "sessionId": "2b5c7f0e-0d8f-4f8e-9c1a-6a3d2f1e4b7c",
  "facts": {
    "user": {
      "gifted_subs": { "before": 95, "after": 100 }
    }
  },
  "cause": { "source": "twitch", "eventId": "8f14e45f-ceea-467f-a0e6-4f2b6d1c2a90" }
}
```

| Field | Meaning |
|---|---|
| `segmentId` | The segment's canonical id. |
| `platform`, `viewerId` | The viewer. |
| `viewerName` | The display name the moving event carried, or empty. |
| `sessionId` | The stream session of the moving event, for lifetime segments too, or empty when none resolves. |
| `facts` | Every fact the segment reads, as `{ before, after }` around the event, nested by owner and slug: `{owner}:fact:{slug}` is at `facts.{owner}.{slug}`, the same path `${viewer.*}` uses. A fact the event did not change has `before` equal to `after`. Timestamps are epoch milliseconds, and a missing value is `null`. A fact id not of the canonical shape is left out. |
| `cause` | The CloudEvent `source` and `eventId` of the event that moved the viewer. |

An expression cannot name a key containing `:`, which is why `facts` is
nested: a workflow reads `${trigger.data.facts.user.gifted_subs.before}`.

### Only the engine publishes them

- `viewer.` is a reserved engine event namespace: a workflow's
  [`publish_event`](/workflow/tasks#publish-event) step cannot publish one.
- An uploaded module cannot declare a trigger on a `viewer.` event, so its
  webhook handler cannot forge one. Only the bundled `woofx3` module can.
- A fact cannot count them. A fact source whose trigger's event starts with
  `viewer.`, or whose wildcards match an edge's subject (`>`, `*.segment.*`),
  is refused at save and lists as `invalid`. Otherwise an edge would move a
  fact, which would move segments, which would publish edges.

### Segment triggers

The bundled `woofx3` module declares a trigger for each edge:

| Trigger | Event | Sentence |
|---|---|---|
| `woofx3:trigger:viewer_segment_entered` | `viewer.segment.entered` | a viewer enters {segment} |
| `woofx3:trigger:viewer_segment_left` | `viewer.segment.left` | a viewer leaves {segment} |

The optional `segment` field takes a full segment id, such as
`user:segment:big_gifters`, and matches it against `segmentId`; left as "any
segment", the trigger fires for every segment. Both emit the payload fields
above, with `viewerId` annotated as the viewer's identity and `viewerName` as
its display name, so `${viewer.*}` reads the facts of the viewer who moved. As
a workflow trigger:

```json
{
  "$ref": "woofx3:trigger:viewer_segment_entered",
  "type": "event",
  "event": "viewer.segment.entered",
  "conditions": [
    { "field": "${trigger.data.segmentId}", "operator": "eq", "value": "user:segment:big_gifters" }
  ]
}
```

## Facts in workflows: `${viewer.*}`

Trigger conditions, step conditions and step parameters can read the facts of
the viewer the triggering event is about:

| Path | Value |
|---|---|
| `${viewer.id}` | The viewer's id on their platform. |
| `${viewer.platform}` | The viewer's platform. |
| `${viewer.name}` | The display name the db proxy last saw for the viewer, or else the event's own display name field. |
| `${viewer.<owner>.<slug>}` | The value of the fact `<owner>:fact:<slug>`: `${viewer.user.apple_mentions}` reads `user:fact:apple_mentions`, `${viewer.woofx3_twitch.messages}` reads `woofx3_twitch:fact:messages`. |

A session fact reads its value in the current stream session. A timestamp is
epoch milliseconds. A fact the viewer has no value for, or one that is not
`active`, is missing, and a missing value is `null`: in a condition it
satisfies only `eq null`, `ne`, `in` a list holding `null`, `not_in` and
`not_exists` (see [Operators](/workflow/schema#operators)), and in a template
it renders as empty.

`id`, `platform` and `name` are reserved: a fact whose owner is one of them
cannot be read under `${viewer.*}`, and is logged once. A step whose id is
`viewer` shadows the source.

### Which viewer

The viewer is named by the workflow's own trigger. The engine looks up the
registered triggers whose event pattern equals the workflow's `event`, and
reads the emits field they annotate `"identity": "viewer"` (see [Identity
fields](/barkloader/modules#identity-fields)). It must be a single `string`
field, and every trigger registered with that pattern must name the same one.
Otherwise the event names no viewer, and every `${viewer.*}` path, `id`
included, is missing. That is the case for:

- an `array` identity, or several identity fields;
- no registered trigger with the pattern, or triggers that disagree (logged
  once per pattern);
- an anonymous event (its `anonymousWhen` field is true), or an event without
  a platform;
- a workflow whose `event` is a wildcard pattern (`viewer.segment.*`,
  `channel.*`): no registered trigger has that exact pattern;
- a workflow no event triggers.

A `not_exists` condition therefore holds for every event of a trigger that
names no viewer.

### Freshness

- **The triggering event is included.** The projector applies an event's
  deltas before the event reaches workflows, unless the write fails or times
  out (see [Where events are counted](#where-events-are-counted)).
- **Read once, only when asked.** The facts are read on the first reference to
  `${viewer.`, and that read serves the trigger conditions and steps of every
  workflow the event starts through the same trigger. An event no expression
  asks about costs no read.
- **Fresh after a pause.** A run that resumes after a `wait` or a
  sub-workflow reads the facts again.
- **Replays read current facts.** The values a run read are not recorded, so a
  replay reads them as they are when it runs.

### When the facts cannot be read

The read has a 1 second timeout and its own circuit breaker.

- **In a trigger condition, it fails closed.** If the facts cannot be read
  (the trigger catalog has not loaded at start-up, the read failed or timed
  out, or reads are paused), the condition fails with an error and the run
  does not start. Otherwise a "first-time chatter" condition on `not_exists`
  would fire for every viewer during an outage.
- **In the steps of a run already started**, the facts read as missing and
  the run logs it once. `${viewer.id}`, `${viewer.platform}`, and a
  `${viewer.name}` the event carries still resolve.

## Examples

The examples read the triggers of the Twitch module, `woofx3_twitch`, which
marks the viewer each trigger is about from version 0.13.0:

| Triggers | Viewer field |
|---|---|
| `channel_follow`, `channel_subscribe`, `channel_shared_subscribe`, `channel_cheer`, `channelpoints_redeem` | `userId` |
| `user_message`, and the chat notices (`channel_resub`, `channel_gift_paid_upgrade`, `channel_watch_streak` and the rest) | `chatterId` |
| `channel_subscription_gift`, `channel_shared_subscription_gift` | `gifterId` |
| `channel_raid`, `channel_shared_raid` | `fromBroadcasterUserId` |

Cheers, gifts and the chat notices name nobody when the viewer is anonymous.

### Counting a word

Every chat message containing the word "apple", as a word in any case, per
viewer and over their lifetime:

```json
{
  "sources": [
    {
      "trigger": "woofx3_twitch:trigger:user_message",
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
      "trigger": "woofx3_twitch:trigger:channel_cheer",
      "subject": "userId",
      "value": "amount"
    }
  ],
  "aggregate": { "fn": "sum" }
}
```

The cheer trigger annotates `userId` as the viewer, with `anonymousWhen`
`isAnonymous`, so anonymous cheers count for nobody. `amount` is a `number`
field, which `sum` requires. Adding the chat message's `amount` as a
second source would count each cheer twice, since a cheer also arrives as a
chat message.

### Welcoming a first-time chatter


A lifetime `count` of chat messages, `user:fact:messages`:

```json
{
  "sources": [
    { "trigger": "woofx3_twitch:trigger:user_message", "subject": "chatterId" }
  ],
  "aggregate": { "fn": "count" }
}
```

and a workflow on chat messages that runs when the count is 1:

```json
{
  "trigger": {
    "$ref": "woofx3_twitch:trigger:user_message",
    "type": "event",
    "event": "user.message",
    "conditions": [
      { "field": "${viewer.user.messages}", "operator": "eq", "value": 1 }
    ]
  },
  "tasks": [
    {
      "id": "welcome",
      "type": "action",
      "action": "chat.reply",
      "parameters": { "message": "Welcome to the stream, ${viewer.name}!" }
    }
  ]
}
```

The count already includes the message that triggered the workflow, so a
first message reads 1, and `not_exists` would never hold. The fact counts from
when it was created, so a regular whose earlier messages predate it is welcomed
once too.

### Welcoming back after 30 days

A lifetime `last_at` over chat messages, `user:fact:last_chat`, read by a
time-relative segment, `user:segment:away_30_days`:

```json
{ "fact": "user:fact:last_chat", "op": "older_than", "value": "720h" }
```

A viewer drifts into the segment while away, and nothing is announced, since
none of their facts changes. When they chat again, their `last_chat` was 40
days old before the message and is new after it, so the segment announces
`left`. A workflow on "a viewer leaves `user:segment:away_30_days`" welcomes
them back:

```json
{
  "trigger": {
    "$ref": "woofx3:trigger:viewer_segment_left",
    "type": "event",
    "event": "viewer.segment.left",
    "conditions": [
      { "field": "${trigger.data.segmentId}", "operator": "eq", "value": "user:segment:away_30_days" }
    ]
  },
  "tasks": [
    {
      "id": "welcome-back",
      "type": "action",
      "action": "chat.reply",
      "parameters": { "message": "Welcome back, ${trigger.data.viewerName}!" }
    }
  ]
}
```

A first-time chatter has no `last_chat` before their message, and
`older_than` is false for a missing value, so they are not welcomed back. Add a
`not_exists` branch only if they should be: see the [quirk](#when-membership-changes).

### Gift milestone

A lifetime `sum` of gifted subs, `user:fact:gifted_subs`:

```json
{
  "sources": [
    {
      "trigger": "woofx3_twitch:trigger:channel_subscription_gift",
      "subject": "gifterId",
      "value": "amount"
    }
  ],
  "aggregate": { "fn": "sum" }
}
```

read by `user:segment:gifted_100`:

```json
{ "fact": "user:fact:gifted_subs", "op": "gte", "value": 100 }
```

A workflow on "a viewer enters `user:segment:gifted_100`" runs once per
viewer, on the gift that takes them to 100 or past it; later gifts keep them in
without announcing anything. Viewers already past 100 when the segment is
created are filled in silently. Anonymous gifts count for nobody, since the
gift trigger's `anonymousWhen` is `isAnonymous`.

With several milestones, one gift bomb can cross more than one. With segments
`user:segment:gifted_10`, `user:segment:gifted_50` and
`user:segment:gifted_100` over the same fact, a viewer at 5 who gifts 100
enters all three on one event, and each edge carries the same
`facts.user.gifted_subs` of `{ "before": 5, "after": 105 }`. One workflow on
"a viewer enters any segment" celebrates only the highest milestone crossed,
by running only for the edge whose segment the `after` value picks:

```json
{
  "trigger": {
    "$ref": "woofx3:trigger:viewer_segment_entered",
    "type": "event",
    "event": "viewer.segment.entered",
    "conditions": [
      {
        "field": "${trigger.data.facts.user.gifted_subs.after >= 100 ? 'user:segment:gifted_100' : trigger.data.facts.user.gifted_subs.after >= 50 ? 'user:segment:gifted_50' : 'user:segment:gifted_10'}",
        "operator": "eq",
        "value": "${trigger.data.segmentId}"
      }
    ]
  },
  "tasks": [
    {
      "id": "celebrate",
      "type": "action",
      "action": "chat.reply",
      "parameters": {
        "message": "${trigger.data.viewerName} has gifted ${trigger.data.facts.user.gifted_subs.after} subs!"
      }
    }
  ]
}
```

Only segments that were crossed announce an edge, so the highest milestone at
or below `after` is the highest one crossed. An edge of any other segment
never matches, since its id is none of the three.

### Limiting a reward per stream

A **session** `count` of one channel point reward's redemptions,
`user:fact:hydrate_redeems`:

```json
{
  "sources": [
    {
      "trigger": "woofx3_twitch:trigger:channelpoints_redeem",
      "subject": "userId",
      "where": { "path": "rewardId", "op": "eq", "value": "<reward id>" }
    }
  ],
  "aggregate": { "fn": "count" }
}
```

and a workflow on that reward that runs for a viewer's first three redemptions
each stream:

```json
{
  "trigger": {
    "$ref": "woofx3_twitch:trigger:channelpoints_redeem",
    "type": "event",
    "event": "channelpoints.redeem",
    "conditions": [
      { "field": "${trigger.data.rewardId}", "operator": "eq", "value": "<reward id>" },
      { "field": "${viewer.user.hydrate_redeems}", "operator": "lte", "value": 3 }
    ]
  },
  "tasks": [
    {
      "id": "hydrate",
      "type": "action",
      "action": "chat.reply",
      "parameters": { "message": "Drink some water, ${viewer.name}!" }
    }
  ]
}
```

The count includes the redemption that triggered the workflow, so the fourth
reads 4 and the workflow does not run; a second workflow with `gt 3` can say
so in chat. A redemption no stream session resolves for is not counted, its
value is missing, and `lte` is false for it.
