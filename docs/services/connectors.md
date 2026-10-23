# Connectors host

`connectors` is the Bun service that holds the engine's connections to
third-party platforms and local apps. Each connection is an **adapter**. The
**host** is the always-on part around them: it reads whether each adapter is
linked and enabled, runs the adapter only while it should run, and answers the
request subjects adapters serve even while they are down.

It ships with one adapter, `twitch` (see [The Twitch adapter](#the-twitch-adapter)),
and runs in every packaged engine (`build/config/services.json`), where the
orchestrator checks its `/health` before reporting the engine ready.

```
           setting.integration.*.updated
api ──────────────────────────────────────▶ settings watcher ──▶ supervisor ──▶ adapter start/stop
                                                  │                    │
                                       db-proxy ◀─┘ (link readers)     ▼
caller ── request (e.g. twitchapi) ──▶ served subjects ──▶ adapter handler, or an "unavailable" reply
```

Code lives in `connectors/src/host/`; `server.ts` only wires it to the shared
runtime (see [Runtime](./runtime.md)). The host also serves the
[platform gateway](./platform-gateway.md) (`connectors/src/gateway/`), the
engine's platform-neutral way to post, announce and pin, which fans each
request out to the platform adapters' egress handlers, and the
[chat command dispatcher](#chat-command-dispatcher), which runs chat commands
for every platform.

## Linked and enabled

An adapter decides whether it should run from a **link state**,
`{connected, enabled}`, which a **link reader** builds from engine settings.
Every adapter id (`ADAPTER_IDS` in `host/adapter-ids.ts`) must have a reader in
`LINK_READERS`; a missing one stops startup.

Adapter ids are separate from integration ids. An integration
(`@woofx3/common/integrations/integration-settings`) is an account the api
stores a credential for; an adapter is anything the host runs, and a local
adapter needs no integration.

For Twitch:

| Setting | Meaning |
|---|---|
| `twitch_token` holds a value | connected |
| `integration.twitch.enabled` is `"true"` or `"false"` | enabled is that value |
| `integration.twitch.enabled` is missing | enabled follows connected (logged once at info) |
| `integration.twitch.enabled` is anything else | enabled follows connected (logged once per value at warn) |

The api writes both rows when Twitch is linked or unlinked, then publishes
`setting.integration.enabled.updated` and `setting.integration.token.updated`
(see [Twitch channel controls](./twitch-channel.md)).

### When links are read

The settings watcher reads every link when the host starts, re-reads the
adapters an event names when either settings event arrives, and reads every
link again on the backstop interval (`WOOFX3_CONNECTORS_RECONCILE_INTERVAL_MS`)
in case an event was missed. Reads run one pass at a time; events that arrive
during a pass merge into the next one, so an older read never overrides a newer
one. A read that fails, or takes longer than
`WOOFX3_CONNECTORS_DB_PROXY_TIMEOUT_MS`, keeps the adapter on its last link
state and logs a warning.

## Adapter states

The supervisor reconciles each adapter's desired state with what is running.
Transitions for one adapter never overlap, so an adapter is never started twice
or stopped in the middle of a start.

| State | Meaning |
|---|---|
| `stopped` | Not desired, or not yet started. |
| `starting` | `start` is running. |
| `connected` | `start` resolved; the adapter is running. |
| `degraded` | A start failed or the running adapter reported a fault. It is retried at `retryAt`. |
| `parked` | It failed too often; it stays down until a settings event names it. |
| `stopping` | `stop` and the closing of its bus subscriptions are running. |

- **Start and stop.** A link state the adapter wants starts it; one it does not
  want aborts a start in progress or stops it. Giving up the start, `stop` and
  the close of its subscriptions share one `WOOFX3_CONNECTORS_STOP_DEADLINE_MS`,
  counted from the abort or the stop; past it the adapter is marked `stopped`
  anyway and an error is logged. Turning an adapter off also clears its failure
  history and backoff.
- **Retries.** Retries use capped exponential backoff with full jitter
  (`createBackoff` from the shared runtime), from
  `WOOFX3_CONNECTORS_BACKOFF_BASE_MS` up to `WOOFX3_CONNECTORS_BACKOFF_MAX_MS`.
  The backoff resets once the adapter connects. A settings event for the
  adapter skips a pending retry wait.
- **Parking.** `WOOFX3_CONNECTORS_PARK_AFTER_FAILURES` failures within
  `WOOFX3_CONNECTORS_PARK_WINDOW_MS` park the adapter. Only a settings event
  that names it (linking, relinking, enabling) unparks it; the backstop pass
  does not.
- **Faults.** A running adapter that loses its connection calls
  `reportFault(reason)`. The host stops it and retries it like a failed start.
  A fault reported by an earlier run is ignored.
- **A throwing `desired`.** The adapter is treated as not desired and an error
  is logged.

## Served subjects

An adapter lists the request/reply subjects it answers in its manifest's
`serves`. The host, not the adapter, subscribes to each of them once, for the
life of the process, so a caller always gets exactly one reply. A manifest
whose `subscribes` covers one of its own served subjects is refused at startup.

| Adapter state | Reply |
|---|---|
| `connected` | The adapter's `handle`. |
| `stopped`, `parked` | `unavailableReply` at once. |
| `starting`, `degraded`, `stopping` | Held until the adapter connects (then `handle`), settles `stopped` or `parked` (then `unavailableReply` at once), or the subject's budget runs out (then `unavailableReply` with reason `starting`). |

`unavailableReply` gets the reason and the adapter's last link state, so a reply
can tell "nothing is linked" apart from "linked but turned off". A `handle` that
throws counts against the adapter (`servedErrors`) and gets the
`unavailableReply` for `stopped`.

Each served subject declares its own `budgetMs`, set below the timeout its
callers use, so a held request is answered before the caller gives up. There is
no host-wide budget.

### Subjects that answer in every state

A served subject can set `availability: "always"` (the default is
`"whenRunning"`, the table above). The host then calls its `handle` whatever the
adapter's state, without holding the request, so a request is never lost while
the adapter is stopped, parked or restarting. A `handle` that throws still
counts as a served error and gets `unavailableReply` with reason `stopped`,
whatever the adapter's real state: the reasons describe the adapter's lifecycle,
and there is none for a failed handler.

State such a subject must keep lives in the adapter module's host state. A
registry entry loads an `AdapterModule`:

```ts
{
  hostState(): S,            // optional; runs once at host startup
  create(hostState: S): Adapter,
}
```

The host keeps the host state for the life of the process and passes it to
`create` and to every `handle` as `ctx.hostState`. It survives adapter stops
and restarts, so anything written while the adapter was down is there when it
starts again. A module without `hostState` gets `undefined`.

### Serving a subject from host code

Every request the host answers goes through one helper,
`HostRequests.serveRequest(scope, spec)` in `host/host-requests.ts`:

```ts
await requests.serveRequest<Req, Rep>(scope, {
  subject: "some.subject",
  budgetMs: 4_500,               // below the callers' timeout
  replyMode: "cloudevent",       // or "raw"
  replyType: "some.subject.result",
  parse: (raw) => /* parsed(value) or parseFailed("why") */,
  handle: async (req, { deadline, signal, arrivedAt }) => /* reply */,
  errorReply: (code, message) => /* reply for "invalid", "internal" or "expired" */,
});
```

- A message without a reply inbox is counted as `no_inbox`, logged and never
  handled, so a stray publish has no effect.
- A request that does not parse gets `errorReply("invalid", ...)`. A parser or
  handler that throws gets `errorReply("internal", ...)` and is logged.
- The deadline is arrival plus `budgetMs`, and `signal` aborts at it. Arrival is
  when the message comes off the bus, so time spent queued behind busy handlers
  counts. A request still queued at its deadline gets `errorReply("expired", ...)`
  without being handled; served subjects answer it as unavailable with reason
  `starting`.
- In `raw` mode the reply bytes go out unchanged. In `cloudevent` mode the reply
  is the `data` of a CloudEvent with a fresh `id`, the `replyType`, source
  `connectors` and the current `time`.
- Each subject keeps `received`, `replied`, `invalid`, `internal`, `expired`
  and `no_inbox` counts, shown in `/health`. Serving a subject twice is an error.

## The scoped bus

The host owns the one bus connection. Each adapter run gets a `ScopedBus` that
allows only the subjects in its manifest (`publishes`, `subscribes`,
`requests`; NATS `*` and `>` wildcards work) and refuses anything else with an
error naming the adapter and the subject. The host's own subscriptions use a
separate `host` scope.

Each subscription runs at most `WOOFX3_CONNECTORS_ADAPTER_CONCURRENCY` handlers
at once and queues up to `WOOFX3_CONNECTORS_ADAPTER_QUEUE_CAP` more; messages
beyond that are dropped, counted, and logged once per overload. A handler that
throws is logged and counted and does not end the subscription. When an adapter
stops, every subscription it made is closed and its running handlers are
awaited.

## The Twitch adapter

`connectors/src/adapters/twitch/` holds the engine's Twitch integration:
EventSub turned into bus events, and the `twitchapi` commands answered through
Helix (see [Twitch channel controls](./twitch-channel.md)). `adapter.ts` wraps
it for the host:

- **When it runs.** While Twitch is linked and enabled (`desired` is
  `connected && enabled`). Unlinking or disabling stops it, and linking or
  enabling starts it, with no restart.
- **Start.** Each start builds a fresh `TwitchApplication` from the adapter's
  scoped bus, the host's db-proxy client and the Twitch settings. It listens
  for `setting.integration.token.updated` (a relink while running swaps the
  token in place), then connects. A start that finds no token stored after all
  rejects, so the adapter goes `degraded` and is retried. When the host aborts
  a start, the connect gives up at its next step (reading the token, looking
  up the broadcaster, or waiting for EventSub to confirm) and closes whatever
  it had built.
- **Unlink.** An unlink clears the token and publishes the same
  `setting.integration.token.updated` as a relink. The running adapter ignores
  an update that leaves no token stored (debug log) and keeps its connection
  until the host reads the link as disconnected and stops it.
- **Token renewal.** Who renews the stored token depends on where it came
  from (`selectStrategy` and `publicClientIdOf` in
  `shared/clients/typescript/twitch/token-strategy.ts` decide, for every
  service alike):

  | Token from | Renewed by | How the adapter gets a new one |
  |---|---|---|
  | A dashboard's Twitch app | The dashboard, which keeps the refresh token and app secret | Asks the api service on `engine.twitch.token` |
  | The engine's public Twitch app (a device login) | The api service alone, since its refresh tokens are single-use | Asks the api service on `engine.twitch.token` |
  | The engine's confidential app (`WOOFX3_TWITCH_CLIENT_ID` and `_SECRET`) | Each service holding the token, with the app's credentials | Refreshes it and writes it back to `twitch_token`, unless a relink replaced the stored token meanwhile |

  A renewal that fails (Twitch refuses the refresh, or the api service is
  unreachable or refuses) is logged and reported as a fault, reason
  `Twitch token renewal failed (<provider>): <error>`: the adapter goes
  `degraded`, its restart reads the stored token afresh, and repeated failures
  park it until Twitch is relinked or re-enabled. The reason shows under the
  adapter's status in `/health`. A failure from a connection already closed
  (by stop or a relink) is ignored.
- **Stop.** Aborts a connect or relink still in progress, stops the ad
  heads-up scheduler, disconnects EventSub, closes the Twitch client, and
  waits for event publishes still in flight, all within the host's stop
  deadline. Nothing from a stopped run survives into the next start, so
  enable, disable and re-enable cycles leave one EventSub connection. A
  publish the bus refuses is logged with its subject and dropped. The host
  then closes the adapter's subscriptions.
- **Manifest.** Publishes every Twitch event subject
  (`@woofx3/common/cloudevents/Twitch/events`), subscribes to
  `setting.integration.token.updated`, requests `engine.twitch.token` and
  `engine.shoutout.enqueue` from the api, and serves `twitchapi` with a
  9_000 ms budget (`TWITCHAPI_SERVED_BUDGET_MS`): below the 10_000 ms the
  api, the sandbox's `ctx.twitch` and the chat dispatcher's built-in commands wait,
  and above a Helix call's own 8_000 ms deadline. A served `helix` call gets
  the smaller of that deadline and the time left in the budget.
- **While it is down**, the host answers every `twitchapi` command with a
  `twitchapi.error` coded `not_linked` when no account is linked, else
  `integration_unavailable` (turned off, still connecting, or parked). The api
  reports the second as `unavailable`.
- **`/health` detail.** `broadcasterId` and `eventSub`
  `{established, expected, ready}`: how many EventSub subscriptions Twitch has
  confirmed. A subscription Twitch refused delivers no events at all, so a
  shortfall here is worth investigating even while the adapter is `connected`.

### Chat egress

The Twitch adapter performs the [platform gateway](./platform-gateway.md)'s
chat actions (`egress.ts`), each as one Helix call made as the broadcaster
through the same `helix` path the dashboard uses:

| Action | Helix call | Delivered when |
|---|---|---|
| `chat.send` | Send Chat Message, with `reply_parent_message_id` from `replyToMessageId` | Twitch posts the line; the outcome carries its `messageId`. A line Twitch did not post (AutoMod, a blocked term, a chat mode) is `dropped` with Twitch's reason. |
| `chat.announce` | Send Chat Announcement | Twitch answers 2xx (it sends 204). `options.twitch` is `{ color? }`, one of `primary`, `blue`, `green`, `orange` or `purple`; `primary` when absent. Any other key or colour fails the request for Twitch as `invalid`. |
| `chat.pin` | Pin Chat Message for `{ messageId }`; Send Chat Message then Pin Chat Message for `{ message, durationSeconds? }`, with `durationSeconds` as `duration` | Twitch pins the line. A line posted but not pinned is `failed` with the message "posted but not pinned: ..." and still carries its `messageId`, so a caller can pin it again instead of posting it twice. |

Every line goes through `guardChatLine`: a line that starts with the command
prefix (`!`, from `connectors/src/chat/command-prefix.ts`) gets a zero-width
space in front, so the engine's own line, which comes back on the chat feed as
the broadcaster's, never runs a command. The legacy `twitchapi` `helix` chat
operations get the same guard, since both paths build the request in one place.

Twitch's error statuses map to failure codes in one table:

| Helix status | Failure code |
|---|---|
| 400, 422 | `invalid` |
| 401, 403 | `forbidden` |
| 429 | `rate_limited` |
| anything else | `upstream` |

A call that gets no answer is `unconfirmed` if the request had left for
Twitch (Twitch may have acted, so it is never resent), else `failed`/`upstream`
"did not reach Twitch before the deadline". Each call gets the smaller of
Helix's 8 s deadline and the time left in the gateway's budget.

All gateway chat writes wait their turn in one send queue, which runs them one at a time
in arrival order, so gateway lines reach chat in the order they were sent. The queue
lives as long as the adapter, so its order holds across a restart. A write
still waiting when its request's deadline passes is dropped without being
sent. Once `WOOFX3_TWITCH_SEND_QUEUE_CAP` writes are waiting, the next is
`failed`/`rate_limited` at once. Nothing is retried, a 429 included. A write
whose turn comes while the adapter is stopped or reconnecting after a relink
is `unavailable` with `stopped` or `starting`.

### Own lines on the chat feed

The engine speaks with the broadcaster's token, so every line it says comes
back on EventSub's chat feed as the broadcaster's. The adapter tells those
lines apart from the streamer typing and marks them on the `user.message`
event (`lib/self-sent.ts`):

- Every Send Chat Message call is recorded just before the request leaves,
  whether it comes from the platform gateway or the legacy `twitchapi`
  `helix` command, along with the gateway request's `workflowChain` when
  there is one. Twitch's answer settles the record: a posted line is kept
  under its message id, and a refused or dropped line is forgotten. A call
  with no answer keeps the record, because Twitch may have posted the line.
- A chat message is the engine's when its id matches a recorded line. An echo
  that arrives before Twitch has answered the send matches by its text
  instead, ignoring whitespace and the guard's zero-width space, and only
  when the broadcaster sent it. A command the engine said behind the guard is
  not matched by an echo that starts with a bare `!`, since that is the
  streamer running the command. Each record answers for one echo only, so the
  streamer typing the same words afterwards is still the streamer.
- A matched message is published with `fromEngine: true`, and its CloudEvent
  carries the sending run's `workflowChain`, which is how the workflow loop
  guard sees a workflow answering its own line. Every other message has
  `fromEngine: false` and no chain. Lines sent through the legacy `twitchapi`
  command are marked `fromEngine` but never carry a chain.

Records expire after `WOOFX3_TWITCH_SELF_SENT_TTL_MS`, and at most
`WOOFX3_TWITCH_SELF_SENT_CAPACITY` are held, the oldest forgotten first. They
live as long as the adapter, so a line said just before a restart is still
known when it echoes after it; `/health` shows how many are waiting as
`ownLinesAwaitingEcho`. Announcements are not recorded: Twitch hands them
back as chat notifications, not chat messages.

connectors pins its `@twurple/*` packages to the release
`shared/clients/typescript/twitch` resolves. TypeScript only treats the two
copies' classes as one type when name and version match, so upgrade both
lockfiles together.

### The stream session

Every event is stamped with the current stream session, which is held per
process. The host, not each adapter run, subscribes to `session.started` for
the life of the process, so an adapter that starts after a session change
still stamps the current session.

## Chat command dispatcher

`connectors/src/chat/` holds the platform-neutral chat command dispatcher: it
reads every platform's chat lines, runs the commands they name, and replies
through the [platform gateway](./platform-gateway.md) to the platform each
line came from. The host runs it (`connectors/src/host/chat-service.ts`) in a
bus scope of its own that holds `CHAT_DISPATCHER_GRANTS` and nothing more. It
starts once the platform gateway answers, because its replies go through the
gateway, and before the first link settings are read. If the first command
listing fails, the host does not start. No other
service runs chat commands: the standalone woofwoofwoof service is gone, and the
dispatcher announces `chat.command.<slug>` with the event `source`
`connectors`.

Each `user.message` goes through these steps in order:

1. **Trust.** A line the engine said itself (`fromEngine: true`, see
   [Own lines on the chat feed](#own-lines-on-the-chat-feed)) is dropped. A
   line with no known `platform` attribute or no speaker id is refused. A
   line is trusted only when its CloudEvent `source` is its platform
   adapter's (`twitch` for Twitch), and a trusted line with no speaker login
   is refused. An untrusted line, such as one the api's event simulator
   published, still runs commands, but its badges count as
   unknown: they never satisfy a role, and it writes no groups. A line said
   in a partner channel during a shared chat session never counts as the
   broadcaster or a moderator, and writes no groups either.
2. **Groups.** A trusted line from the channel itself updates the built-in
   derived groups (subscriber, vip, moderator, broadcaster, the tiers,
   follower), writing only what changed since that viewer's last line.
3. **Match.** `!name rest` names a command. Built-in commands win over a
   stored command with the same name, and a built-in can be limited to some
   platforms.
4. **Authorise.** A public command runs for anyone. A command that allows
   roles runs for a speaker the platform reported in one. Anyone else needs
   a grant on `command/<name>`. A refused speaker is told so. The grant is
   looked up by the login the line names, and an untrusted line's login is
   whatever its publisher wrote, so anything that can publish on the bus can
   run a command granted to a login it names. Bus publishers are not yet
   authenticated per identity; until they are, a grant is only as strong as
   the bus's own access control.
5. **Cooldown.** The cooldown is per command. A line inside it is dropped
   completely and is not announced.
6. **Handler.** The invocation is announced on `chat.command.<slug>`
   (source `connectors`, `platform` set to the line's platform), and then the
   command runs: a stored command runs its workflow or its actions.

A non-empty reply is a `chat.send` to the `origin` target. For a trusted line
it is threaded under that line. Its idempotency key is
`dispatcher:<line id>:<command name>`, where the line id is the platform's id
for the message, or the CloudEvent id for an untrusted line, and it is
`requestedBy` `dispatcher`. A reply longer than 500 characters is cut.
Nothing is retried; an undelivered reply is logged.

**Who a viewer is.** In-memory state is keyed by the platform and that
platform's user id, never by a display name. The memory of written groups
is keyed this way, and the permission cache by that, the login and whether
the line was trusted, so two accounts that show the same name never share a
decision and an untrusted line never fills in one a trusted line reads.
Permission and group rows in db-proxy are keyed by the speaker's login,
lowercased. That is what the database keys on
today.

**Stored commands** are read from db-proxy, the owner of the data.
`command.created`, `command.updated` and `command.deleted` only trigger a
reload, and the snapshot they carry is never applied. Reloads wait
`WOOFX3_CONNECTORS_DISPATCHER_RELOAD_DEBOUNCE_MS` for more events. Then one
listing is read and applied by command id, so a renamed command stops
answering to its old name. Reloads run one at a time, in order. A failed
reload keeps the last good table, and a backstop reloads every
`WOOFX3_CONNECTORS_DISPATCHER_RELOAD_BACKSTOP_MS` even with no event. A
command's cooldown keeps running when the command is reloaded. Starting the
dispatcher fails if its first listing fails.

**Built-in commands** (`connectors/src/chat/builtins.ts`) are handed to the
dispatcher as its `builtins`. Each runs only for a line from the platform
itself: a simulated line is ignored and logged.

| Command | Platforms | Who | What it does |
|---|---|---|---|
| `!grantcommands <login>` | all | a grant on the command | Gives the login the moderator role on every command. |
| `!revokecommands <login>` | all | a grant on the command | Takes it back. |
| `!vanish` | Twitch | a grant on the command | Times the speaker out for 1 to 600 seconds. A broadcaster or moderator is spared. |
| `!title <text>` | Twitch | broadcaster, moderator, or a grant | Sets the stream title. |
| `!category <name>` | Twitch | broadcaster, moderator, or a grant | Sets the stream category. |
| `!marker [text]` | Twitch | broadcaster, moderator, or a grant | Places a stream marker and says its position. |

The login of a grant command must match `^[a-z0-9_]{1,25}$` after the `@` is
dropped and case is folded; anything else gets a usage line and changes
nothing. The Twitch commands call the Twitch adapter on the `twitchapi`
subject and wait `WOOFX3_CONNECTORS_DISPATCHER_TWITCH_API_TIMEOUT_MS`. A
failure becomes a chat line: no answer in time is reported as unknown (Twitch
may still apply the change), a Twitch adapter that is off or not linked says
so, and any other refusal gives Twitch's reason. `CHAT_DISPATCHER_GRANTS`
includes `twitchapi` among its requests.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `WOOFX3_CONNECTORS_PORT` | `9102` | Loopback port of `/health`. Worktree slots use their base port + 6. |
| `WOOFX3_CONNECTORS_RECONCILE_INTERVAL_MS` | `60000` | Backstop: every link is read this often. |
| `WOOFX3_CONNECTORS_BACKOFF_BASE_MS` | `1000` | First retry ceiling. |
| `WOOFX3_CONNECTORS_BACKOFF_MAX_MS` | `300000` | Retry ceiling cap. |
| `WOOFX3_CONNECTORS_PARK_AFTER_FAILURES` | `5` | Failures that park an adapter... |
| `WOOFX3_CONNECTORS_PARK_WINDOW_MS` | `600000` | ...within this window. |
| `WOOFX3_CONNECTORS_STOP_DEADLINE_MS` | `10000` | How long one adapter's stop may take, abort and bus close included. |
| `WOOFX3_CONNECTORS_DB_PROXY_TIMEOUT_MS` | `2000` | Every db-proxy call (the startup ping, each link read) is aborted after this. |
| `WOOFX3_CONNECTORS_ADAPTER_CONCURRENCY` | `16` | Handlers one subscription runs at once. |
| `WOOFX3_CONNECTORS_ADAPTER_QUEUE_CAP` | `256` | Messages one subscription queues behind them. |
| `WOOFX3_CONNECTORS_SHUTDOWN_DEADLINE_MS` | `15000` | Whole-process shutdown before exit code 1. Must exceed the db-proxy timeout plus the larger of the stop deadline and the longest served budget, the platform gateway's included. |

The platform gateway's own settings (`WOOFX3_CONNECTORS_GATEWAY_*`) are listed
in [Platform gateway contract](./platform-gateway.md#configuration-and-health).

The Twitch adapter reads:

| Variable | Default | Meaning |
|---|---|---|
| `WOOFX3_TWITCH_CHANNEL_NAME` | none | The channel to watch; without it, the account that linked Twitch. |
| `WOOFX3_TWITCH_CLIENT_ID`, `WOOFX3_TWITCH_CLIENT_SECRET` | none | The engine's own Twitch app, which refreshes the token itself. Used only when both are set. |
| `WOOFX3_TWITCH_REDIRECT_URL` | `http://localhost` | That app's redirect URL. |
| `WOOFX3_TWITCH_MEMBERSHIP_ENRICHMENT_ENABLED` | `true` | Look up follower status and subscription tier for chatters. |
| `WOOFX3_TWITCH_MEMBERSHIP_TTL_MS` | `600000` | How long a looked-up answer is kept. |
| `WOOFX3_TWITCH_MEMBERSHIP_DEADLINE_MS` | `250` | How long a chat message waits on a lookup before it is published without it. |
| `WOOFX3_TWITCH_SEND_QUEUE_CAP` | `100` | How many platform gateway chat writes may wait behind the one being sent; one more is refused as rate limited. |
| `WOOFX3_TWITCH_SELF_SENT_CAPACITY` | `256` | How many of the engine's own chat lines are remembered while their echo is awaited. |
| `WOOFX3_TWITCH_SELF_SENT_TTL_MS` | `30000` | How long one of the engine's own lines waits for its echo before it is forgotten. |

The chat command dispatcher reads:

| Variable | Default | Meaning |
|---|---|---|
| `WOOFX3_CONNECTORS_DISPATCHER_AUTH_CACHE_CAPACITY` | `2048` | Permission decisions remembered, per viewer, login, trust and command. |
| `WOOFX3_CONNECTORS_DISPATCHER_AUTH_CACHE_TTL_MS` | `5000` | How stale a remembered decision may be after a grant changes. |
| `WOOFX3_CONNECTORS_DISPATCHER_GROUP_LAST_SEEN_CAPACITY` | `4096` | Viewers whose last written group membership is remembered; a forgotten viewer is rewritten on their next line. |
| `WOOFX3_CONNECTORS_DISPATCHER_GROUP_CATALOG_TTL_MS` | `300000` | How long the built-in group catalog is used before it is read again. |
| `WOOFX3_CONNECTORS_DISPATCHER_RELOAD_DEBOUNCE_MS` | `250` | How long a command event waits for more before the commands reload. |
| `WOOFX3_CONNECTORS_DISPATCHER_RELOAD_BACKSTOP_MS` | `300000` | How often the commands reload with no event. |
| `WOOFX3_CONNECTORS_DISPATCHER_TWITCH_API_TIMEOUT_MS` | `10000` | How long a built-in Twitch command waits for the Twitch adapter's answer. Must exceed the adapter's 9000 ms served budget, or slow calls are reported as unknown. |

The host also reads the bus settings (`WOOFX3_MESSAGEBUS_URL`, `_JWT`, `_NKEY`,
`_TOKEN`), `WOOFX3_DATABASE_PROXY_URL` and `WOOFX3_DB_PROXY_TOKEN`, the
service token db-proxy requires (it must pass the shared secret rule). Every
db-proxy call connectors makes carries it, the adapters' included. Invalid
values stop the process at startup with every bad key named.

## Health

`GET http://127.0.0.1:<WOOFX3_CONNECTORS_PORT>/health` answers `200` while the
bus is connected and the reconcile loop is running (its last pass is at most
two backstop intervals old), and `503` otherwise. An adapter's state never
makes it fail: a parked adapter is reported, and restarting the host would not
fix what parked it.

```json
{
  "status": "ok",
  "bus": { "connected": true },
  "loop": { "alive": true, "lastPassAt": "2026-10-21T12:00:00.000Z" },
  "adapters": [
    {
      "id": "twitch",
      "state": "parked",
      "reason": "could not connect",
      "since": null,
      "retryAt": null,
      "changedAt": "2026-10-21T11:58:00.000Z",
      "link": { "connected": true, "enabled": true },
      "counts": { "starts": 5, "failures": 5, "faults": 0, "servedErrors": 0, "stopTimeouts": 0 },
      "bus": { "refusals": 0, "subscriptions": {} },
      "detail": { "broadcasterId": null, "eventSub": null }
    }
  ],
  "counters": {
    "chat": {
      "commands": { "storedCommands": 12, "builtins": 6, "lastReloadAt": 1792670400000, "reloadFailures": 0 },
      "lines": { "refused": 0, "from_engine": 4, "no_command": 310, "denied": 1, "cooling_down": 2, "failed": 0, "ran": 9 },
      "replies": { "delivered": 10, "failed": 1 },
      "bus": { "refusals": 0, "subscriptions": {} }
    },
    "hostRequests": { "twitchapi": { "received": 3, "replied": 3, "invalid": 0, "internal": 0, "expired": 0, "no_inbox": 0 } },
    "hostBus": { "refusals": 0, "subscriptions": {} },
    "gateway": {
      "outcomes": { "twitch": { "chat.send": { "delivered": 12, "unavailable": 1 } } },
      "idempotency": { "replayed": 0, "coalesced": 0, "mismatched": 0, "held": 13 }
    }
  }
}
```

`counters.chat` is the chat dispatcher: how many stored and built-in commands
are loaded, when the table last loaded (clock milliseconds) and how many
reloads failed, how each chat line ended, how many replies the platform gateway
delivered and how many it did not (no answer, an unreadable answer or a refusal;
the reason is in the log), and the dispatcher's own bus scope. A reply that
fails never makes `/health` fail.

`detail` is whatever the adapter's optional `detail()` returns, for facts worth
seeing at a glance, and `null` when it has none or it throws (the throw is logged
once). The host replaces the value of any key whose name contains `password`,
`token`, `ticket` or `credential` (any case, at any depth) with `"[redacted]"`.
Adapters must still keep secrets out of `detail()`.

Any other path or method answers `404` with
`{"error": {"code": "not_found", "message": "..."}}`.

## Shutdown

SIGTERM, SIGINT and SIGBREAK (Windows) start one graceful shutdown through the
shared `installShutdown`: the health server closes, and the watcher stops once
any read in flight ends (at most the db-proxy timeout). Then, together, the
chat dispatcher stops reading lines, every adapter is stopped in parallel under
its stop deadline and the host's subscriptions close; held requests are
answered as their adapters stop. The dispatcher waits for lines still being
handled, and the close waits at most the larger of the stop deadline, the longest
served budget, the platform gateway reply timeout and the Twitch API timeout. The host refuses to start when the shutdown deadline does not cover
both steps. A second signal, or `WOOFX3_CONNECTORS_SHUTDOWN_DEADLINE_MS`
elapsing, exits with code 1.
