# Twitch channel controls

The twitch service (`twitch/`) turns the streamer's Twitch channel into
engine events (EventSub), and is the one place the engine talks to Twitch's
Helix API on the streamer's behalf. Every other engine surface (the chatbot's
built-in commands, a module function's `ctx.twitch`, and a manifest field's
options source) asks it to act by sending a command on the `twitchapi` NATS
subject. It validates the request against Twitch's rules, performs it with the
linked account's token, and answers with the result or an error.

Twitch actions a streamer puts in a workflow come from the Twitch platform
module, whose functions call `ctx.twitch` (see [Modules](#modules)). The
dashboard's Twitch widgets make their Helix calls through the engine's Twitch
methods when the engine advertises them, and straight to Helix otherwise (see
[Dashboard Helix calls](#dashboard-helix-calls)).

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
| `invalid_arguments` | `helix` refused its arguments before calling Twitch: an unknown operation, or a parameter the operation does not declare, is missing, or has the wrong type. |
| `not_linked` | `helix` while no Twitch account is linked. The other commands answer this refusal with no code. |

Only the commands below are served (`TWITCH_API_COMMANDS` in
`twitch/src/lib/twitch.ts`); anything else is answered with
`Unknown command: <name>`.

| Command | Args | Result | Scope |
|---|---|---|---|
| `getStreamInfo` | none | `{ title, categoryId, categoryName, tags, language }` | none |
| `updateStream` | `{ title?, category?, categoryId?, tags? }` | `{ ok, title?, categoryId?, categoryName?, tags? }` | `channel:manage:broadcast` |
| `createMarker` | `{ description? }` | `{ id, createdAt, description, positionSeconds }` | `channel:manage:broadcast` |
| `searchCategories` | `{ query, first? }` | `[{ id, name, boxArtUrl }]` | none |
| `getUser` | `{ userId \| userName }` | `{ userId, login, displayName, description, profileImageUrl, broadcasterType, createdAt, title, categoryId, categoryName, tags, language, isLive, stream }` | none |
| `timeout` | `{ userId \| userName, durationSeconds, reason? }` | `{ ok, userId, durationSeconds }` | `moderator:manage:banned_users` |
| `shoutout` | `{ userId \| userName }` | `{ ok, userId, queued, position?, alreadyQueued? }`; see [Shoutouts are queued](#shoutouts-are-queued) | `moderator:manage:shoutouts` |
| `clip` | none | `{ id, url }` | `clips:edit` |
| `listChannelPointRewards` | none | `[{ value, label, cost, prompt, isEnabled }]` | `channel:read:redemptions` |
| `addChannelModerator` | `{ userId }` | `{ ok, userId }` | `channel:manage:moderators` |
| `getAdSchedule` | none | see [Ad breaks](#twitchapi-ad-commands) | `channel:read:ads` |
| `snoozeNextAd` | none | see [Ad breaks](#twitchapi-ad-commands) | `channel:manage:ads` |
| `helix` | `{ operation, params? }` | `{ ok: true, body }` or `{ ok: false, status, body }`; see [Dashboard Helix calls](#dashboard-helix-calls) | per operation |

### Shoutouts are queued

Twitch allows one shoutout every 2 minutes per channel, and one per target
every 60 minutes. The dashboard's shoutout queue already paces sends to that
limit and retries refusals, so `shoutout` does not call Twitch: it looks the
user up and asks the api service (`engine.shoutout.enqueue`) to queue them on
the dashboard the Twitch link came from (`shoutout.enqueue.requested`). The
reply is `{ ok, userId, queued: true, position, alreadyQueued }`; a user who
is already waiting keeps their place instead of being queued twice. Sending
some shoutouts directly would spend the 2 minutes the queue is counting on.

The engine API's `twitchSendShoutout` (see
[Dashboard Helix calls](#dashboard-helix-calls)) is the other direction: it
is how the dashboard's queue sends the shoutout it has paced, so it calls
Twitch at once and never queues.

Only an engine whose Twitch link is its own, with no dashboard queue, sends
directly (`queued: false`), where a refusal carries `rate_limited`. A
dashboard that cannot be reached, or does not answer within 8 seconds, fails
the request: it is not retried as a direct send, because the dashboard may
have queued it after all.

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

## Chat provider

The twitch service is the engine's Twitch chat provider: the lines the
engine says through the provider subjects go out through it, with the
broadcaster's token, through Helix. It answers two request/reply subjects, with plain JSON (no
CloudEvent envelope). The contract types are in
`shared/common/typescript/cloudevents/Platform/chat.ts` and
`shared/common/golang/cloudevents/platform_chat.go`.

| Subject | Request | Helix operation |
|---|---|---|
| `platform.twitch.chat.send` | `{ message, replyToMessageId? }` | Send Chat Message, as a reply to `replyToMessageId` when given |
| `platform.twitch.chat.announce` | `{ message, color? }` (`primary`, `blue`, `green`, `orange`, `purple`) | Send Chat Announcement |

Both answer:

```jsonc
// Twitch took the request. isSent is false when Twitch dropped the line
// (AutoMod, say), with its reason. An announcement has no messageId.
{ "ok": true, "messageId"?: "<Twitch message id>", "isSent": true, "dropReason"?: "<reason>" }
// The line was not said.
{ "ok": false, "error": { "code": "<code>", "message": "<why>" } }
```

| `code` | When |
|---|---|
| `invalid` | The request breaks the contract (not an object, an empty `message`, an unknown field, a color Twitch lacks), or Twitch refused the line with HTTP 400 or 422 (too long, a reply to an unknown message). |
| `not_linked` | No Twitch account is linked yet. |
| `rate_limited` | Twitch answered HTTP 429. |
| `upstream` | Twitch refused the line for another reason, or did not answer within 8 seconds. After a timeout the line may still have been said. |
| `dropped` | Part of the contract for providers that refuse a line themselves; the twitch service never sends it. A Twitch drop is `ok: true, isSent: false`. |

The `platform.` namespace is reserved for the engine (see
[Reserved subjects](./engine-integrity.md#reserved-subjects)): an uploaded
module may not declare an event under it and a workflow may not publish one,
so neither can make the engine speak on its own account.

### The engine's own lines

A line the engine says comes back on the chat feed as the broadcaster's own
message. So that nothing answers the engine's own words, the twitch service
records every line it sends through Helix, whatever asked for it (the
provider subjects, or the `helix` command behind a dashboard widget's
`twitchSendChatMessage`), and marks the echo on the `user.message` event it
publishes:

- `messageId` is Twitch's id of every chat message.
- `fromEngine` is `true` when the message is the echo of a line the engine
  sent: its id is one Twitch returned for a send, or, when the echo arrives
  before Twitch's answer, it comes from the broadcaster's account with the
  text of a line still waiting for that answer. Each sent line marks one
  echo, so the streamer typing the same words afterwards is read as the
  streamer.

A line Twitch refused or dropped is forgotten at once. The rest are kept for
`woofx3TwitchSelfSentTtlMs` (default 30000) and at most
`woofx3TwitchSelfSentCapacity` (default 256) at a time, oldest forgotten
first. An announcement comes back on the notification feed rather than as a
chat message, so it is not kept.

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
| `shoutout({ userId \| userName })` | `{ ok, userId, queued, position?, alreadyQueued? }` | none |
| `createMarker({ description? })` | `{ id, createdAt, description, positionSeconds }` | none |
| `getUser({ userId \| userName })` | `{ userId, login, displayName, …, categoryName, isLive, stream }` | none |
| `timeout({ userId \| userName, durationSeconds, reason? })` | `{ ok, userId, durationSeconds }` | `twitch.moderation` |
| `updateStream({ title?, category?, categoryId?, tags? })` | `{ ok, title?, categoryId?, categoryName?, tags? }` | `twitch.channel` |

Clips, shoutouts and markers are visible and harmless, and `getUser` reads
only what Twitch shows anyone, so any module may call them. Timing chatters out and changing the title, category or tags act
on the channel and its chatters, so the module has to declare the permission
in its manifest (`"permissions": ["twitch.moderation", "twitch.channel"]`).
Permissions are declared by the module and enforced by the engine, and shown
on the module install page (woofx3-ui feat/module-permissions-review); see
[Module format → Permissions](../barkloader/modules.md#permissions-permissions).
A workflow step or command that names another module's action runs that
module's code with that module's permissions, so an uploaded module doing so
must declare every permission the other module declares, or it does not
install.
An undeclared call throws before anything is sent. Moderator changes, the
ad commands and `helix` are not reachable from modules at all.

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

## Dashboard Helix calls

The dashboard's Twitch widgets read Helix's responses themselves: Twitch's
bodies, statuses and error messages decide what a widget shows. So the engine
offers them the Helix calls themselves rather than reshaped results. Each
engine API method performs one Helix call as the linked broadcaster and
answers with what Twitch answered:

```ts
type TwitchHelixResult =
  | { ok: true; body: unknown } // Helix's JSON body unchanged; null for a 204
  | { ok: false; code: "helix"; error: string; status: number; body: string } // Twitch's error status and body
  | { ok: false; code: "invalid_arguments" | "not_linked" | "unavailable" | "timeout" | "failed"; error: string };
```

A refusal is a result, never a thrown error, because an RPC error carries
only its message. The codes:

| `code` | When |
|---|---|
| `helix` | Twitch answered with an error status. `status` is Twitch's, `body` is Twitch's error body as it sent it (`{"error","status","message"}`), and `error` reads `Twitch answered <status>: <message>`. |
| `invalid_arguments` | A parameter the method does not take, a missing required one, or a value of the wrong type. Nothing was sent to Twitch. |
| `not_linked` | No Twitch account is linked to the engine. |
| `unavailable` | The twitch service is not running. |
| `timeout` | The twitch service did not answer within 10 seconds. Twitch may still have acted. |
| `failed` | Anything else, such as Twitch not being reachable at all. |

Parameters use Helix's own names. The ids that name the broadcaster are
always the linked broadcaster's and are filled in by the engine, so a method
refuses them as parameters: the broadcaster is both `broadcaster_id` and
`moderator_id`, is `user_id` on a stream marker, `sender_id` on a chat
message, and `from_broadcaster_id` on a shoutout. Where the table below
shows a query parameter after `?`, the engine sets it. The target of a ban,
an unban or a lookup is a parameter the caller gives. Only the shape of a
parameter is checked: lengths, ranges and allowed values are Twitch's to
enforce, and its refusal comes back as a `helix` result.

Each method is the api's request to the twitch service's `helix` command,
which performs one operation from `HELIX_OPERATIONS` in
`twitch/src/lib/helix.ts`. Every operation is sent once, reads included, as
the dashboard's own Helix calls are: a 5xx or a failed connection is
answered as it is, never retried, because Twitch may have sent the chat
message or made the clip before failing. The one exception is a 401, which
Twitch answers before acting: the token is renewed and the request sent one
more time. The request is sent with Twurple's `callTwitchApiRaw`, which
makes exactly one request, rather than its API client, whose retries would
break that rule, and uses the same auth provider for its token.

An operation has 8 seconds in all, waiting for the token included, so the
twitch service answers `failed` before the api's 10-second wait runs out and
the caller learns why. Its error says whether a request had been sent, in
which case Twitch may still have acted.

| Method | Helix call | Params | Capability |
|---|---|---|---|
| `twitchGetChannelInformation()` | `GET /channels?broadcaster_id` | none | `twitch.streamInfo` |
| `twitchGetGames(params)` | `GET /games` | `{ id }` | `twitch.streamInfo` |
| `twitchSearchCategories(params)` | `GET /search/categories` | `{ query, first? }` | `twitch.streamInfo` |
| `twitchModifyChannelInformation(params)` | `PATCH /channels?broadcaster_id` | body `{ title?, game_id?, tags? }`; `game_id: ""` clears the category | `twitch.streamInfo` |
| `twitchCreateStreamMarker(params)` | `POST /streams/markers` | body `{ description? }`, sent with `user_id` | `twitch.streamInfo` |
| `twitchGetAdSchedule()` | `GET /channels/ads?broadcaster_id` | none | `twitch.ads` |
| `twitchSnoozeNextAd()` | `POST /channels/ads/schedule/snooze?broadcaster_id` | none | `twitch.ads` |
| `twitchGetUsers(params)` | `GET /users` | `{ id?, login? }` | `twitch.moderation` |
| `twitchGetBlockedTerms(params)` | `GET /moderation/blocked_terms?broadcaster_id&moderator_id` | `{ first?, after? }` | `twitch.moderation` |
| `twitchAddBlockedTerm(params)` | `POST /moderation/blocked_terms?broadcaster_id&moderator_id` | body `{ text }` | `twitch.moderation` |
| `twitchRemoveBlockedTerm(params)` | `DELETE /moderation/blocked_terms?broadcaster_id&moderator_id` | `{ id }` | `twitch.moderation` |
| `twitchBanUser(params)` | `POST /moderation/bans?broadcaster_id&moderator_id` | `{ user_id, duration?, reason? }`, sent as the body's `data`; a `duration` makes it a timeout | `twitch.moderation` |
| `twitchUnbanUser(params)` | `DELETE /moderation/bans?broadcaster_id&moderator_id` | `{ user_id }` | `twitch.moderation` |
| `twitchGetChatSettings()` | `GET /chat/settings?broadcaster_id&moderator_id` | none | `twitch.moderation` |
| `twitchSendChatMessage(params)` | `POST /chat/messages` | body `{ message, pin? }`, sent with `broadcaster_id` and `sender_id`; `pin` needs `twitch.pins` | `twitch.chat` |
| `twitchSendChatAnnouncement(params)` | `POST /chat/announcements?broadcaster_id&moderator_id` | body `{ message, color? }` | `twitch.chat` |
| `twitchSendShoutout(params)` | `POST /chat/shoutouts?from_broadcaster_id&moderator_id` | `{ to_broadcaster_id }` | `twitch.chat` |
| `twitchGetChatters(params)` | `GET /chat/chatters?broadcaster_id&moderator_id` | `{ first?, after? }` | `twitch.chat` |
| `twitchGetChatPins()` | `GET /chat/pins?broadcaster_id&moderator_id` (beta) | none | `twitch.pins` |
| `twitchPinChatMessage(params)` | `PUT /chat/pins?broadcaster_id&moderator_id` (beta) | `{ message_id }` | `twitch.pins` |
| `twitchUnpinChatMessage(params)` | `DELETE /chat/pins?broadcaster_id&moderator_id` (beta) | `{ message_id }` | `twitch.pins` |
| `twitchCreateClip()` | `POST /clips?broadcaster_id` | none | `twitch.clips` |
| `twitchUpdateChatSettings(params)` | `PATCH /chat/settings?broadcaster_id&moderator_id` | body `{ emote_mode?, subscriber_mode?, follower_mode?, follower_mode_duration?, slow_mode?, slow_mode_wait_time? }` | `twitch.moderation` |

The token is the one the twitch service holds: the linked account's, from the
dashboard that linked it (see [Who renews the token](#who-renews-the-token)),
with the scopes that link was granted. The broadcaster is the engine's
broadcaster, which is the linked account unless `woofx3TwitchChannelName`
names another channel; a call for another channel has no token to use and
fails.

## Device login

An engine with no dashboard to run Twitch OAuth for it (an engine in local
mode, under the desktop app) links Twitch itself with Twitch's
[Device Code Grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow).
The streamer is shown a short code and a Twitch page to enter it on; the
engine waits for them to approve and stores the token. Engines advertise it
with the `twitch.deviceLogin` capability.

### The public Twitch app

A device login uses the engine's **public** Twitch app, named by
`WOOFX3_TWITCH_PUBLIC_CLIENT_ID` (`woofx3TwitchPublicClientId` in
`.woofx3.json`). It is a client id and nothing else: a public app has no
secret, so nothing secret ships with an engine that runs on a streamer's own
machine. It is separate from the confidential app
(`WOOFX3_TWITCH_CLIENT_ID` and `WOOFX3_TWITCH_CLIENT_SECRET`), which has a
secret and cannot be used for a device login. The value must be letters and
digits; anything else stops the api at startup. Without it the device login
methods answer `not_configured` and do nothing else.

The woofx3 public Twitch app must be registered in the Twitch developer
console with the **Public** client type. Twitch refreshes a confidential
app's tokens only with its secret, which an engine does not have, so a device
login made with one would stop working when its first token expired.

### The methods

```ts
startTwitchDeviceLogin(scopes?: string[]): Promise<TwitchDeviceLoginStartResult>;
getTwitchDeviceLogin(loginId: string): Promise<TwitchDeviceLoginStateResult>;
cancelTwitchDeviceLogin(loginId: string): Promise<{ cancelled: boolean }>;
```

The types are in `shared/clients/typescript/api/twitch-device-login.ts`; the
logins are `TwitchDeviceLogins` (`api/src/twitch-device-login.ts`).

- `startTwitchDeviceLogin` asks Twitch for a device code and answers
  `{ ok: true, login: { loginId, userCode, verificationUri, expiresAt } }`.
  The client shows `userCode` and `verificationUri`, and nothing more: the
  engine polls Twitch itself. `scopes` defaults to the engine's own set,
  `TWITCH_ENGINE_SCOPES` (`shared/clients/typescript/twitch/scopes.ts`), which
  matches the scopes a dashboard's Twitch connect asks for. A refusal is a
  result, not an error: `not_configured`, `invalid_scopes` (an empty list or
  a name that is not a Twitch scope), or `failed` (Twitch refused or could not
  be reached).
- `getTwitchDeviceLogin` answers the login's `status`: `pending`, `linked`
  (with the linked account's `userId` and `login`), `expired`, `denied` or
  `failed`, with a `reason` for every ending other than `linked`. `not_found`
  means the engine has no login by that id.
- `cancelTwitchDeviceLogin` stops the login and forgets it.

An engine has one Twitch link, so it runs one login at a time: starting a
login replaces the one before it, which stops polling and is forgotten. A
finished login's outcome can be read until the next login starts.

### Polling

The engine polls `POST /oauth2/token` every `interval` seconds Twitch gave.
A `slow_down` answer adds five seconds to the interval for the rest of the
login. While Twitch cannot be reached or answers with a 5xx the login stays
`pending`, its `reason` says why, and the engine retries with a backoff capped
at a minute. The login ends `expired` when Twitch says so or its `expiresAt`
passes, `denied` when the streamer refuses, and `failed` on any other
refusal. Each poll is a timer the login owns: it stops when the login ends,
is cancelled or replaced, or the api shuts down.

### Linking

When Twitch issues the token, the engine validates it (`GET /oauth2/validate`)
to learn the linked user, and refuses one issued to any other app. It then
stores it the way `setTwitchToken` stores a token: the `twitch_token` setting,
then `setting.integration.token.updated`, so a waiting twitch service connects
and a connected one reloads. The stored token has its refresh token and no
`clientId`, so its strategy is `engineRefresh`, and its `publicClientId`
names the public app that refreshes it (see
[Who renews the token](#who-renews-the-token)).

Storing the token is the point of no return: once it has started, cancelling
the login answers `cancelled: false` and the login still ends `linked`. A
login started meanwhile replaces it, but its token still lands and is
announced.

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
| Browser delivery | api (`StreamEventBroadcaster`) | Forwards the three `channel.ad_break.*` events to `subscribeStreamEvents` clients that ask for them, and to every client that names no types |
| Triggers | `woofx3_twitch` platform module (woofx3-modules) | Declares the three events as workflow triggers |
| Dashboard widget | woofx3-ui | Reads the schedule and snoozes from Convex actions, through the engine's `twitchGetAdSchedule` and `twitchSnoozeNextAd` (see [Dashboard Helix calls](#dashboard-helix-calls)) or straight to Helix on an engine without `twitch.ads` |

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
It also reconnects from scratch when the new token is renewed differently
from the one it loaded (see [Who renews the token](#who-renews-the-token)):
a token the api service serves and one the confidential app refreshes need
different auth providers, so a token swap cannot cover the change.

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
- **A token from a device login** (see [Device login](#device-login)) was
  issued to the engine's public Twitch app and carries that app's id as
  `publicClientId`, and its refresh token. A public app has no secret, and
  Twitch makes its refresh tokens single-use: each refresh returns a new one
  and the old one stops working. If two services refreshed the same token,
  the second would spend a refresh token the first had already spent, and the
  link would be lost. So the api service alone refreshes it
  (`TwitchTokenSource.publicToken`), with the client id and no secret, and
  writes the new access and refresh tokens together, as one `twitch_token`
  value, before it hands the access token out. The twitch service and
  woofwoofwoof ask the api service for it on `engine.twitch.token`, exactly as
  for a dashboard's token. When Twitch refuses the refresh token, every ask
  answers "link Twitch again", and the api service does not try that refresh
  token again; the twitch service then cannot connect and reports not ready.
  A refresh that cannot be stored is kept in memory and written again on the
  next ask, because the refresh token in the stored row is already spent.
  Every write of `twitch_token` in the api service (a new link, a refresh,
  unlinking) goes through `TwitchTokenSource`, one at a time. A refresh is
  written only while the row still holds the refresh token it spent; when a
  new link landed meanwhile the refresh is dropped and the new link's token
  is served. An asker that read the row before a refresh finished is served
  that refresh's token rather than starting a second one with the spent
  refresh token.
- **Any other token** is renewed by the engine itself, with its own
  confidential Twitch app (`WOOFX3_TWITCH_CLIENT_ID` and
  `WOOFX3_TWITCH_CLIENT_SECRET`), for an engine run without a dashboard. The
  auth provider refreshes in the background and
  writes each refresh back to `twitch_token`. It does not do so when the
  stored token has changed since it was loaded (different refresh token, or a
  later obtainment time): that is a relink the service has not applied yet,
  and writing a refresh of the old token over it would silently undo the
  relink and its scopes.

### Where the token is kept

The `twitch_token` setting holds a credential: a device login's refresh token
stays valid until it is used. db-proxy seals it at rest with the same
AES-256-GCM key as `secret` module settings (`WOOFX3_SECRETS_KEY`), bound to
the setting's key, and opens it on read, so every service reads and writes it
in plain text through the ordinary settings RPCs. The sealed keys are listed
in one place in db-proxy (`SealedSettingKeys`). A value stored in plain text
before its key was sealed is sealed when db-proxy starts, before it serves
requests; a sealed value that does not open (the secrets key changed) is
refused rather than served, and linking Twitch again replaces it.

### Events

All three carry `platform: "twitch"`, and all three are forwarded to browser
clients by `subscribeStreamEvents`, to clients that ask for them or name no
types.

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
