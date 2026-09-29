# Twitch channel

The twitch service turns the streamer's Twitch channel into engine events
(EventSub) and answers engine requests that need the streamer's token
(Helix). This page covers the parts of that surface that carry more behavior
than "Twitch sent X, the engine publishes X".

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

The auth provider refreshes tokens in the background and writes each refresh
back to `twitch_token`. It does not do so when the stored token has changed
since it was loaded (different refresh token, or a later obtainment time):
that is a relink the service has not applied yet, and writing a refresh of
the old token over it would silently undo the relink and its scopes.

### Events

All three carry `platform: "twitch"`, and all three are forwarded to browser
clients by `subscribeStreamEvents`.

#### `channel.ad_break.upcoming`

```json
{ "nextAdAt": "2026-09-28T18:10:00.000Z", "secondsUntil": 60, "durationSeconds": 90 }
```

Twitch has no EventSub topic for an ad that is about to run, so the twitch
service makes one. `AdBreakScheduler` reads the ad schedule from Helix once a
minute while the stream is live and arms a timer for each configured lead
time before `nextAdAt`. Offline, it does not call Twitch at all.

- **Live state** comes from the service's own `stream.online` and
  `stream.offline` subscriptions. EventSub does not replay an online event
  from before the service connected, so at connect it also asks Helix once
  whether the stream is live; an EventSub event that arrives first wins.
- **Lead times** come from `WOOFX3_TWITCH_AD_BREAK_LEAD_SECONDS`
  (`twitchAdBreakLeadSeconds` in `.woofx3.json`): a number or a
  comma-separated list such as `120,60`. The default is `60`. Anything other
  than positive whole seconds fails the twitch service at startup.
- **Once per ad, per lead time.** An announcement is keyed by the ad's
  `nextAdAt`. Snoozing moves `nextAdAt`, so a snoozed ad is announced again
  at its new time.
- **Late discovery.** If the ad is first seen inside a lead window (the stream
  just went live, or the schedule changed), the passed lead times collapse
  into one announcement right away, and `secondsUntil` is the real time
  left rather than the configured lead.
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

### `twitchapi` commands

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

The error reply on `twitchapi` carries a `code` next to the message when the
failure is one a caller can act on: `missing_scope`, `unauthorized` or
`rate_limited` (anything else is `failed`). The scheduler reads the same codes
to tell "relink" from "wait".

These commands are not in the module sandbox. They are deliberately absent from the module
sandbox's Twitch extension (`barkloader/lib_sandbox/src/extensions/twitch.rs`):
whether to delay an ad is the streamer's call, not a module's
([engine integrity](/services/engine-integrity)).

### Triggers

Workflow triggers for Twitch events are declared by the `woofx3_twitch`
platform module, which lives in the woofx3-modules repository
(`modules/platform/twitch/manifest.json`), not here. Its entries for
`channel.ad_break.upcoming`, `channel.ad_break.begin` and
`channel.ad_break.end` are what make the events selectable in the UI; the
events are on the bus either way.
