# Twitch channel controls

The twitch service (`twitch/`) is the one place the engine talks to Twitch's
Helix API on the streamer's behalf. Every other surface — the UI through the
engine API, the chatbot's built-in commands, a workflow action, a module's
`ctx.twitch` — asks it to act by sending a command on the `twitchapi` NATS
subject. It validates the request against Twitch's rules, performs it with the
linked account's token, and answers with the result or an error.

## The `twitchapi` subject

A request is `{ command, args }`, sent either bare or as the `data` of a
CloudEvent; both are read. A sender that uses NATS request/reply gets a
CloudEvent back:

```jsonc
// success
{ "type": "twitchapi.<command>.result", "source": "twitchapi", "data": <result> }
// refusal: invalid input, Twitch not linked, unknown command, or Twitch's own error
{ "type": "twitchapi.error", "source": "twitchapi", "data": { "error": "<message>" } }
```

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

- **Title:** not blank, at most 140 characters.
- **Tags:** at most 10; each 1 to 25 characters of letters and numbers (any
  script), no spaces or punctuation; no tag twice, ignoring case. An empty list
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
  weeks). The broadcaster cannot be timed out.
- **Category search:** `query` is required; `first` is 1 to 100, default 10.

## Engine API

The UI reaches these through `Woofx3EngineApi`
(`shared/clients/typescript/api/api.ts`). Each is a NATS request to
`twitchapi` with a 10 second timeout, and rejects with the twitch service's
message; when the twitch service is not running it rejects with
`The Twitch service is not running`.

| RPC | Command |
|---|---|
| `getStreamInfo(): TwitchStreamInfo` | `getStreamInfo` |
| `updateStreamInfo(input: UpdateStreamInfoInput): UpdateStreamInfoResult` | `updateStream` |
| `createStreamMarker(input?: { description? }): TwitchStreamMarker` | `createMarker` |
| `searchTwitchCategories(input: { query, first? }): TwitchCategory[]` | `searchCategories` |

`getStreamStatus()` is separate: it reads whether the stream is live, its
uptime and viewer count, where `getStreamInfo()` reads the channel settings
that apply whether or not it is live.

## Chatbot built-ins

woofwoofwoof registers these commands itself. Each waits for the twitch
service's answer and says the outcome in chat.

| Command | Does |
|---|---|
| `!title <text>` | Sets the stream title. |
| `!category <name>` | Sets the category, resolved as above: `!category just chatting`. |
| `!marker [description]` | Places a stream marker and says where it landed (`h:mm:ss`). |
| `!vanish` | Times the chatter who sent it out for up to 10 minutes. |

`!title`, `!category` and `!marker` are open to the **broadcaster and the
channel's moderators**, read from the membership Twitch reports on the chat
message, so they work on a fresh engine with no grants configured. Anyone else
goes through the command permission model like any restricted command: a grant
on `command/title` (or `command/*`) lets that chatter in too. See
[Chat commands & groups](./commands-ui.md). `!vanish` has no role exemption and
is only ever reached through a grant.
