# Twitch channel controls

The twitch service (`twitch/`) is the one place the engine talks to Twitch's
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
message. The one code is `rate_limited`: `shoutout` refused by Twitch's
shoutout limit (one every 2 minutes, one per channel every 60 minutes).

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
An undeclared call throws before anything is sent. Moderator changes are not
reachable from modules at all.

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
