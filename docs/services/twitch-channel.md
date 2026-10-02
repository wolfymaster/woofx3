# Twitch channel controls

The twitch service (`twitch/`) turns the streamer's Twitch channel into
engine events (EventSub), and is the one place the engine talks to Twitch's
Helix API on the streamer's behalf. Every other engine surface (the chatbot's
built-in commands, a module function's `ctx.twitch`, and a manifest field's
options source) asks it to act by sending a command on the `twitchapi` NATS
subject. It validates the request against Twitch's rules, performs it with the
linked account's token, and answers with the result or an error.

The generic engine API has no Twitch methods. Twitch actions a streamer puts
in a workflow come from the Twitch platform module, whose functions call
`ctx.twitch` (see [Modules](#modules)), and the UI's dashboard widgets talk
to Helix themselves.

## The `twitchapi` subject

A request is `{ command, args }`, sent either bare or as the `data` of a
CloudEvent; both are read. A sender that uses NATS request/reply gets a
CloudEvent back:

```jsonc
// success
{ "type": "twitchapi.<command>.result", "source": "twitchapi", "data": <result> }
// refusal: invalid input, Twitch not linked, unknown command, or Twitch's own error
{ "type": "twitchapi.error", "source": "twitchapi", "data": { "error": "<message>", "code"?: "<code>" } }
```

`code` is present only on a refusal a caller may act on without reading the
message:

| `code` | When |
|---|---|
| `rate_limited` | `shoutout` refused by Twitch's shoutout limit (one every 2 minutes, one per channel every 60 minutes), or an ad command refused with HTTP 429. |
| `missing_scope` | An ad command whose scope the link does not carry. Relinking Twitch fixes it. |
| `unauthorized` | An ad command whose token Twitch refused. |

Only the commands below are served (`TWITCH_API_COMMANDS` in
`twitch/src/lib/twitch.ts`); anything else is answered with
`Unknown command: <name>`.

| Command | Args | Result | Scope |
|---|---|---|---|
| `getStreamInfo` | none | `{ title, categoryId, categoryName, tags, language }` | none |
| `updateStream` | `{ title?, category?, categoryId?, tags? }` | `{ ok, title?, categoryId?, categoryName?, tags? }` | `channel:manage:broadcast` |
| `createMarker` | `{ description? }` | `{ id, createdAt, description, positionSeconds }` | `channel:manage:broadcast` |
| `searchCategories` | `{ query, first? }` | `[{ id, name, boxArtUrl }]` | none |
| `timeout` | `{ userId \| userName, durationSeconds, reason? }` | `{ ok, userId, durationSeconds }` | `moderator:manage:banned_users` |
| `shoutout` | `{ userId \| userName }` | `{ ok, userId }` | `moderator:manage:shoutouts` |
| `clip` | none | `{ id, url }` | `clips:edit` |
| `listChannelPointRewards` | none | `[{ value, label, cost, prompt, isEnabled }]` | `channel:read:redemptions` |
| `addChannelModerator` | `{ userId }` | `{ ok, userId }` | `channel:manage:moderators` |
| `getAdSchedule` | none | see [Ad breaks](#twitchapi-ad-commands) | `channel:read:ads` |
| `snoozeNextAd` | none | see [Ad breaks](#twitchapi-ad-commands) | `channel:manage:ads` |

### Rules checked before calling Twitch

A request that breaks one of these fails with a message naming the rule, and
nothing is sent to Twitch. `updateStream` checks every field before sending,
so a bad tag never lets the title through on its own.

- **Title:** a string, not blank, at most 140 characters. Lengths here are
  counted in characters, so an emoji counts once.
- **Tags:** at most 10; each 1 to 25 characters of letters and numbers (any
  script, combining marks included), no spaces or punctuation; no tag twice, ignoring case. An empty list
  removes every tag.
- **Category:** `category` is free text, resolved through Twitch's category
  search: the result whose name matches exactly, ignoring case, else the most
  relevant one. `categoryId` is used as given, and `""` clears the category.
  The two cannot be sent together.
- **At least one** of title, category, categoryId or tags.
- **Marker description:** at most 140 characters. Twitch only places a marker
  on a live stream; while offline the request fails with
  `the channel is not live`.
- **Timeout:** `durationSeconds` is a whole number from 1 to 1209600 (two
  weeks). `reason` is at most 500 characters. The broadcaster cannot be timed
  out.
- **Category search:** `query` is required; `first` is 1 to 100, default 10.

## Field options

A manifest field can list options from the twitch service with an
[`internal` source](../barkloader/modules.md#dynamic-source-select-fields-source-kind),
as `channelpoints.redeem`'s reward picker does with
`listChannelPointRewards`. The descriptor's `payload` is static: it is sent
as written, and nothing the streamer types reaches it. That rules out
search-as-you-type over `searchCategories`, so a module action that sets the
category takes a free-text field and passes it to `updateStream` as
`category`, which resolves it through the category search as described
above. `searchCategories` stays a command for the services that resolve text
themselves.

## Chatbot built-ins

woofwoofwoof registers these commands itself. Each waits for the twitch
service's answer and says the outcome in chat. When nothing answers in time
the reply says the outcome is unknown, not that it failed: the change may
still land.

| Command | Does |
|---|---|
| `!title <text>` | Sets the stream title. |
| `!category <name>` | Sets the category, resolved as above: `!category just chatting`. |
| `!marker [description]` | Places a stream marker and says where it landed (`h:mm:ss`). |
| `!vanish` | Times the chatter who sent it out, by their Twitch id, for up to 10 minutes. The broadcaster and moderators, whom Twitch will not time out, get a reply instead. |

`!title`, `!category` and `!marker` are open to the **broadcaster and the
channel's moderators**, read from the membership Twitch reports on the chat
message, so they work on a fresh engine with no grants configured. That is
wider than Twitch's own rule, which lets the broadcaster and channel
editors change the title and category: editor status is not on a chat
message, so moderators are the closest trusted role chat can see, and the
change is made with the broadcaster's token. A message relayed from a partner
channel during shared chat never counts as the broadcaster or a moderator
here, whatever its badges say in that channel. Anyone else
goes through the command permission model like any restricted command: a grant
on `command/title` (or `command/*`) lets that chatter in too. See
[Chat commands & groups](./commands-ui.md). `!vanish` has no role exemption and
is only ever reached through a grant.

## Modules

A module function reaches the twitch service through `ctx.twitch`
(`barkloader/lib_sandbox/src/extensions/twitch.rs`). Each call is a request
on `twitchapi` made while the function runs: it waits up to 10 seconds, and
never past the time the function's caller gives it (30 seconds at most), and
returns the command's result, or throws. A function may make at most 10
`ctx.twitch` calls per run, and at most 32 requests wait on the twitch service
at once across the engine, since each one holds a sandbox thread.

| Call | Returns | Manifest permission |
|---|---|---|
| `clip()` | `{ id, url }` | none |
| `shoutout({ userId \| userName })` | `{ ok, userId }` | none |
| `createMarker({ description? })` | `{ id, createdAt, description, positionSeconds }` | none |
| `timeout({ userId \| userName, durationSeconds, reason? })` | `{ ok, userId, durationSeconds }` | `twitch.moderation` |
| `updateStream({ title?, category?, categoryId?, tags? })` | `{ ok, title?, categoryId?, categoryName?, tags? }` | `twitch.channel` |

Clips, shoutouts and markers are visible and harmless, so any module may
call them. Timing chatters out and changing the title, category or tags act
on the channel and its chatters, so the module has to declare the permission
in its manifest (`"permissions": ["twitch.moderation", "twitch.channel"]`).
Permissions are declared by the module and enforced by the engine, and shown
on the module install page (woofx3-ui feat/module-permissions-review); see
[Module format → Permissions](../barkloader/modules.md#permissions-permissions).
A workflow step or command that names another module's action runs that
module's code with that module's permissions, so an uploaded module doing so
must declare every permission the other module declares, or it does not
install.
An undeclared call throws before anything is sent. Moderator changes and the
ad commands are not reachable from modules at all.

A failed call throws an `Error` (Lua: raises a table `{ message, code? }`)
with the twitch service's own message, so the rules above reach the module
unchanged. `code` is:

| `code` | When |
|---|---|
| `permission_denied` | The manifest does not declare the permission the call needs. Nothing was sent. |
| `timeout` | The function's run is out of time, or the twitch service did not answer within 10 seconds. The action may still have happened. |
| `call_limit` | The run already made 10 `ctx.twitch` calls. Nothing was sent. |
| `busy` | 32 twitch requests were already waiting and none finished within 2 seconds. Nothing was sent. |
| `unavailable` | The twitch service is not running. |
| `request_failed` | The request could not be sent or the reply could not be read. |
| absent | The twitch service refused: invalid input, Twitch not linked yet, or Twitch's own error. Its refusals carry a message only. |

A platform module exposes these to workflows as actions backed by functions,
the same way `twitch.shoutout` is. See
[Engine integrity](./engine-integrity.md).

## Ad breaks

Mid-roll ads are the break viewers notice most. The engine gives a creator
three things around them: a warning before an ad starts, events when it
starts and ends, and a way to push the next one back.

### Who does what

Everything Twitch-specific about ads lives in the twitch service. The generic
engine only carries the resulting events.

| Piece | Where | What it does |
|-------|-------|--------------|
| Heads-up scheduler | twitch service (`twitch/src/lib/adBreakScheduler.ts`) | Polls the Helix ad schedule while the stream is live and publishes `channel.ad_break.upcoming` |
| Begin / end events | twitch service (`twitch/src/lib/subscriptions/onChannelAdBreakBegin.ts`) | Publishes `channel.ad_break.begin` from EventSub and synthesizes `channel.ad_break.end` |
| `getAdSchedule` / `snoozeNextAd` | twitch service, `twitchapi` commands (`twitch/src/lib/twitch.ts`) | Helix reads and snoozes on request over NATS |
| Browser delivery | api (`StreamEventBroadcaster`) | Forwards the three `channel.ad_break.*` events to `subscribeStreamEvents` clients, as it does every other platform stream event |
| Triggers | `woofx3_twitch` platform module (woofx3-modules) | Declares the three events as workflow triggers |
| Dashboard widget | woofx3-ui | Reads the schedule and snoozes through Helix from Convex actions, like its other Twitch widgets |

The api exposes no ad RPC: an engine API method named after one platform's
feature would leak that platform into the generic surface every client sees.

### Scopes

Ad features need two scopes a Twitch link may not carry:

| Scope | Needed for |
|-------|------------|
| `channel:read:ads` | `channel.ad_break.begin` / `.end`, `channel.ad_break.upcoming`, `getAdSchedule` |
| `channel:manage:ads` | `snoozeNextAd` |

Both are **optional**. A link without them loses the ad features and nothing
else:

- The `channel.ad_break.begin` EventSub subscription is attempted at connect
  like every other, but it is outside the readiness set. The twitch service
  reports ready once every *required* subscription is confirmed; a refused ad
  subscription logs one warning naming the scope and is otherwise ignored.
  Treating it as required would hold the service unready, and restart it,
  over something only relinking Twitch in the UI can fix.
- The `getAdSchedule` and `snoozeNextAd` commands reply with an error whose
  message ends "reconnect Twitch to allow ad controls".
- The heads-up scheduler backs off (below) and logs once.

### Relinking to grant a scope

"Reconnect Twitch" takes effect without a restart. The UI's relink writes the
new token to the `twitch_token` setting and publishes
`setting.integration.token.updated`. A connected twitch service then:

1. hands the new token to its running auth provider (`TwitchClient.reloadToken`),
   so Helix calls such as `snoozeNextAd` use the new scopes at once;
2. requests every EventSub subscription again (`TwitchEventBus.resubscribe`),
   which is the only retry an optional subscription refused for a missing
   scope gets. Readiness drops only until Twitch confirms the new batch.

If the relink is to a different Twitch account and no channel is configured,
the broadcaster itself changes, so the service reconnects from scratch.

### Who renews the token

Renewing a Twitch token takes the Twitch app's client secret. Which component
holds it decides how the token is renewed:

- **A token from a dashboard** carries the app's `clientId` and no refresh
  token. The dashboard (woofx3-ui) owns the app, its secret and the refresh
  token, and an engine never receives them, because an engine may be
  self-hosted. `setTwitchToken` stores the token with the engine client id of
  the dashboard that sent it. When it is about to expire, or Twitch refuses
  it, the api service sends that dashboard a `twitch.token.requested` request
  (`TwitchTokenSource`, `api/src/twitch-token-source.ts`) and stores the
  access token it answers with. The twitch service and woofwoofwoof ask the
  api service on the `engine.twitch.token` NATS subject
  (`DashboardAuthProvider`, `shared/clients/typescript/twitch`), and need no
  Twitch app credentials of their own.
- **Any other token** is renewed by the engine itself, with its own Twitch app
  (`WOOFX3_TWITCH_CLIENT_ID` and `WOOFX3_TWITCH_CLIENT_SECRET`), for an engine
  run without a dashboard. The auth provider refreshes in the background and
  writes each refresh back to `twitch_token`. It does not do so when the
  stored token has changed since it was loaded (different refresh token, or a
  later obtainment time): that is a relink the service has not applied yet,
  and writing a refresh of the old token over it would silently undo the
  relink and its scopes.

### Events

All three carry `platform: "twitch"`, and all three are forwarded to browser
clients by `subscribeStreamEvents`.

#### `channel.ad_break.upcoming`

```json
{ "nextAdAt": "2026-09-28T18:10:00.000Z", "secondsUntil": 60, "durationSeconds": 90 }
```

Twitch has no EventSub topic for an ad that is about to run, so the twitch
service makes one. `AdBreakScheduler` reads the ad schedule from Helix once a
minute while the stream is live and arms a timer for the lead time before
`nextAdAt`. Offline, it does not call Twitch at all.

- **Live state** comes from the service's own `stream.online` and
  `stream.offline` subscriptions. EventSub does not replay an online event
  from before the service connected, so at connect it also asks Helix once
  whether the stream is live; an EventSub event that arrives first wins.
- **Lead time** is the Twitch module's `adBreakLeadSeconds` setting
  (`woofx3_twitch`), set on the module's page. It is read with each schedule
  read, so a change applies within a minute. The default is `60`, which also
  applies when the module is not installed, the value is not positive whole
  seconds (logged as a warning), or db-proxy cannot be read.
- **Once per ad.** An announcement is keyed by the ad's `nextAdAt`, so
  changing the lead time after an ad was announced does not announce it
  again. Snoozing moves `nextAdAt`, so a snoozed ad is announced again at its
  new time.
- **Late discovery.** If the ad is first seen inside the lead window (the
  stream just went live, or the schedule changed), it is announced right
  away, and `secondsUntil` is the real time left rather than the lead time.
- **Backoff.** A missing scope pauses reads for 15 minutes, an invalid token
  for 5, and a rate limit for 2 minutes, doubling on each consecutive 429 up
  to 30. Each failure kind is logged when it first appears, not on every poll.
- **Single instance.** Which ads were announced is kept in memory, so the
  scheduler assumes one twitch service per engine. A restart inside a lead
  window announces that ad again.

#### `channel.ad_break.begin`

```json
{
  "durationSeconds": 90,
  "isAutomatic": true,
  "startedAt": "2026-09-28T18:10:00.000Z",
  "endsAt": "2026-09-28T18:11:30.000Z"
}
```

From the EventSub `channel.ad_break.begin` topic. `isAutomatic` is false when
the broadcaster or an editor started the ad by hand.

#### `channel.ad_break.end`

```json
{
  "durationSeconds": 90,
  "isAutomatic": true,
  "startedAt": "2026-09-28T18:10:00.000Z",
  "endedAt": "2026-09-28T18:11:30.000Z"
}
```

**Synthesized.** Twitch sends no event when an ad break ends. The twitch
service publishes this `durationSeconds` after the begin event, so `endedAt`
is when the break was due to end, not an observation that it did. A workflow
that switches to an "ad" scene on begin can switch back on this. If a new
break begins while an end is still pending, that end is published at once,
before the new begin, so every begin is paired with exactly one end. EventSub
delivers at least once, so a begin with the same start time as the pending
break is treated as a redelivery and ignored. A twitch service restart or
disconnect during a break drops the pending end.

### `twitchapi` ad commands

```ts
getAdSchedule(): Promise<{
  nextAdAt: string | null;       // ISO-8601
  lastAdAt: string | null;
  durationSeconds: number;       // length of the next break
  prerollFreeSeconds: number;
  snoozeCount: number;           // snoozes available now
  snoozeRefreshAt: string | null; // when the next snooze is granted
  serverNow: string;             // engine clock when it answered
}>;

snoozeNextAd(): Promise<{
  snoozeCount: number;
  snoozeRefreshAt: string | null;
  nextAdAt: string | null;
  serverNow: string;
}>;
```

Every time is ISO-8601 or null. Helix has sent these fields as RFC3339
strings, as Unix seconds (number or numeric string), and as `""` when nothing
is scheduled or the channel is offline; `normalizeHelixTime`
(`twitch/src/lib/twitch.ts`) maps all of them, and anything unreadable
becomes null rather than failing the call. `serverNow` lets a countdown
correct for the difference between the browser's clock and the engine's.

Both are commands on the `twitchapi` NATS request subject, answered from
Helix (`GET /channels/ads`, `POST /channels/ads/schedule/snooze`). A snooze
pushes the next ad back five minutes; Twitch refuses one when none is
available or no ad is scheduled, and the error reply carries Twitch's reason.
The scheduler calls `getAdSchedule` in process rather than over NATS.

A refusal carries `missing_scope`, `unauthorized` or `rate_limited` as its
`code` (see [the `twitchapi` subject](#the-twitchapi-subject)); any other
failure carries none. The scheduler reads the same codes in process to tell
"relink" from "wait".

These commands are deliberately absent from the module sandbox's Twitch
extension (`barkloader/lib_sandbox/src/extensions/twitch.rs`): whether to
delay an ad is the streamer's call, not a module's
([engine integrity](./engine-integrity.md)).

### Triggers

Workflow triggers for Twitch events are declared by the `woofx3_twitch`
platform module, which lives in the woofx3-modules repository
(`modules/platform/twitch/manifest.json`), not here. Its entries for
`channel.ad_break.upcoming`, `channel.ad_break.begin` and
`channel.ad_break.end` are what make the events selectable in the UI; the
events are on the bus either way.
