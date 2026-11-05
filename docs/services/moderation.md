# Chat moderation

Bot-style chat filters on top of each platform's own moderation: links with an
allowlist and `!permit`, capital letters, repetition, symbols and banned
phrases, each with its own actions and exemptions. It runs in the connectors
host, so a hosted engine and a desktop engine moderate the same way, and the
dashboard only edits its config.

Everything in this page is platform-neutral. Filters, config and the service
live in `connectors/src/moderation/` and `@woofx3/api/moderation-config`
(`shared/clients/typescript/api/moderation-*.ts`), and never name a platform;
`connectors/src/moderation/platform-neutral.test.ts` fails if they do. What a
platform can do, and its own limits, live in its adapter's egress.

## Config

Stored as JSON in the engine setting `moderation.config`, versioned (`version:
1`). `parseModerationConfig` in `@woofx3/api/moderation-config` is the one
parser: the api runs it on save, the connectors host on load, and the
dashboard as the streamer edits.

| Field | Meaning |
|---|---|
| `enabled` | The master switch. Off by default. |
| `dryRun` | Evaluate and record every hit, act on none. |
| `exempt` | `moderators`, `vips`, `subscribers` (all on by default) and `allowLogins`. The broadcaster is always exempt. |
| `rules` | At most one per filter id: `enabled`, `actions`, optional `exempt` replacing the config-wide fields it names, and the filter's `params`. |

Actions are `delete`, `warn` (with a `reason` shown to the chatter), `timeout`
(with `durationSeconds`) and `ban`: at least one, each kind once, never both
timeout and ban. Every limit is a named entry of `MODERATION_LIMITS`, and every
filter's defaults are in `DEFAULT_FILTER_PARAMS`. A new rule acts by deleting
only.

| Filter | Params | Hits when |
|---|---|---|
| `banned_phrases` | `phrases: { pattern, wholeWord }[]` | Any phrase matches; see below. |
| `links` | `allowDomains`, `permitSeconds` | A link points outside the allowed domains and their subdomains, and the chatter has no permit. |
| `repetition` | `windowSeconds`, `maxRepeats`, `minLength` | The chatter said the same line, ignoring case and spacing, more than `maxRepeats` times in the window. |
| `caps` | `minLength`, `maxPercent` | Capital letters make up more than `maxPercent` of the cased letters, from `minLength` letters on. |
| `symbols` | `minLength`, `maxPercent` | Punctuation and symbols make up more than `maxPercent` of the characters, emoji not counted. |

Caps and symbols skip @mentions and leave paid lines (cheers) alone.

### Banned-phrase patterns

`@woofx3/api/moderation-pattern` compiles a small grammar, never a regular
expression: literals, `?` (one non-space character), `*` (any run of non-space
characters), `[ab]` and `[^a-c]` classes, and `\b` word boundaries. `( ) | + {
} ^ $` are refused rather than read literally, with a hint to escape them.
Matching advances a set of positions once per character, so the cost is at
most text length times pattern length whatever the input; a line is scanned in
its first `maxScanChars` characters. Pattern and text are both normalised
first: Unicode NFKC, lower case, and format characters such as zero-width
spaces removed.

## Running on chat

`ModerationService` watches every line the chat dispatcher reads. A line is
moderated only when moderation is on and the line is trusted (from the
platform's own adapter), from this channel rather than a shared-chat partner,
and carries the platform's message id. Rules run in the order of `FILTER_IDS`
(cheap and most severe first) and the first hit wins, so a line gets one rule's
actions at most. Each line uses the config as it was when the line arrived.

A hit's actions run in order (delete, warn, then timeout or ban), each as a
platform gateway request to the line's own platform: `chat.delete`,
`moderation.warn`, `moderation.timeout` and `moderation.ban` (see
[Platform gateway contract](./platform-gateway.md)). Each step stands alone, so
a failed warn neither undoes the delete nor stops the timeout. The idempotency
key `moderation:<messageId>:<action>` makes a redelivered line act once.

- A chatter is warned at most once per `warnCooldownSeconds`.
- A timeout or ban never reaches the broadcaster, a moderator, a VIP, or a
  chatter whose role the platform did not report, whatever the exemptions say.
- A warn is dropped when an earlier step found the platform rate limiting.
- A step refused as `forbidden`, usually a scope the link lacks, is logged once
  until the step succeeds again. There is no fallback, such as a chat message
  in place of a platform warning.

Moderation is not pre-display: a line is removed about a second after it shows.

Each moderated line is published as `moderation.action.taken`
(`ModerationActionTaken`: filter, reason, chatter, the first
`recordedTextChars` characters, each step's outcome and `dryRun`). The api's
event log records it whatever the streamer's event selection.

## Permits

`!permit <login>` (broadcaster and moderators) lets a viewer post links for the
links rule's `permitSeconds`. Permits are held in memory, keyed by platform and
login, and end with a restart.

## API

Behind the `moderation.config` [engine capability](./engine-capabilities.md):

| Method | Does |
|---|---|
| `getModerationConfig()` | The stored config, or the default (off) when none is stored or it no longer parses. |
| `setModerationConfig(config)` | Parses, stores and publishes `moderation.config.updated`, which the connectors host reloads on. Rejects with the first problem. |
| `listModerationActions(limit?)` | The latest `moderation.action.taken` events from the event log, newest first; 50 by default, at most 100. |

## Twitch

The Twitch adapter performs the four actions with the broadcaster's token; see
[Chat egress](./connectors.md#chat-egress). Delete needs
`moderator:manage:chat_messages`, timeout and ban `moderator:manage:banned_users`,
and warn `moderator:manage:warnings`, which links made before it was requested
lack until the streamer reconnects Twitch.
