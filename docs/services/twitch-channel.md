# Twitch channel

The twitch service turns the streamer's Twitch channel into engine events
(EventSub) and answers engine requests that need the streamer's token
(Helix). This page covers the parts of that surface that carry more behavior
than "Twitch sent X, the engine publishes X".

## Ad breaks

Mid-roll ads are the break viewers notice most. The engine gives a creator
three things around them: a warning before an ad starts, events when it
starts and ends, and a way to push the next one back.

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
- `getAdSchedule` and `snoozeNextAd` reject with a message ending
  "reconnect Twitch to allow ad controls".
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

Twitch has no EventSub topic for an ad that is about to run, so the api makes
one. While a stream segment is open, `AdBreakScheduler`
(`api/src/ad-break-scheduler.ts`) reads the ad schedule once a minute through
the twitch service and arms a timer for each configured lead time before
`nextAdAt`. With no segment open it does not call Twitch at all.

- **Lead times** come from `WOOFX3_AD_BREAK_LEAD_SECONDS` (`adBreakLeadSeconds`
  in `.woofx3.json`): a number or a comma-separated list such as `120,60`.
  The default is `60`. Anything other than positive whole seconds fails the
  api at startup.
- **Once per ad, per lead time.** An announcement is keyed by the ad's
  `nextAdAt`. Snoozing moves `nextAdAt`, so a snoozed ad is announced again
  at its new time.
- **Late discovery.** If the ad is first seen inside a lead window (the stream
  just went live, or the schedule changed), the passed lead times collapse
  into one announcement right away, and `secondsUntil` is the real time
  left rather than the configured lead.
- **Backoff.** A missing scope pauses reads for 15 minutes, an invalid token
  or an unlinked account for 5, and a rate limit for 2 minutes, doubling on
  each consecutive 429 up to 30. Each failure kind is logged when it first
  appears, not on every poll.

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

### RPCs

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

Both go api -> `twitchapi` NATS request -> Helix (`GET /channels/ads`,
`POST /channels/ads/schedule/snooze`). A snooze pushes the next ad back five
minutes; Twitch refuses one when none is available or no ad is scheduled,
and the RPC rejects with Twitch's reason.

The error reply on `twitchapi` carries a `code` next to the message when the
failure is one a caller can act on: `missing_scope`, `unauthorized` or
`rate_limited` (anything else is `failed`). The api keeps that code on the
error it throws, which is how the scheduler tells "relink" from "wait".

These commands are engine-only. They are deliberately absent from the module
sandbox's Twitch extension (`barkloader/lib_sandbox/src/extensions/twitch.rs`):
whether to delay an ad is the streamer's call, not a module's
([engine integrity](/services/engine-integrity)).

### Triggers

Workflow triggers for Twitch events are declared by the `woofx3_twitch`
platform module, which lives in the woofx3-modules repository
(`modules/platform/twitch/manifest.json`), not here. Until that manifest
declares the three ad-break events, workflows cannot select them in the UI,
though the events are already on the bus. The entries it needs follow the
shape of its existing triggers:

```json
[
  {
    "id": "channel_ad_break_upcoming",
    "name": "Ad break upcoming",
    "description": "An ad break is scheduled soon. Published by the engine from the ad schedule, at the configured lead times.",
    "type": "eventbus",
    "event": "channel.ad_break.upcoming",
    "sentence": "An ad break is about to start",
    "taxonomy": ["platform.twitch", "stream.ads"],
    "emits": {
      "fields": [
        { "path": "nextAdAt", "type": "string", "description": "When the ad is scheduled (ISO-8601)." },
        { "path": "secondsUntil", "type": "number", "description": "Seconds until the ad starts.", "example": 60 },
        { "path": "durationSeconds", "type": "number", "description": "Length of the break.", "example": 90 }
      ]
    }
  },
  {
    "id": "channel_ad_break_begin",
    "name": "Ad break started",
    "description": "Twitch EventSub: channel.ad_break.begin",
    "type": "eventbus",
    "event": "channel.ad_break.begin",
    "sentence": "An ad break starts",
    "taxonomy": ["platform.twitch", "stream.ads"],
    "emits": {
      "fields": [
        { "path": "durationSeconds", "type": "number", "description": "Length of the break.", "example": 90 },
        { "path": "isAutomatic", "type": "boolean", "description": "False when the ad was started by hand." },
        { "path": "startedAt", "type": "string" },
        { "path": "endsAt", "type": "string", "description": "When the break is expected to end." }
      ]
    }
  },
  {
    "id": "channel_ad_break_end",
    "name": "Ad break ended",
    "description": "Published when an ad break is due to end. Twitch sends no end event; the engine times it from the start event.",
    "type": "eventbus",
    "event": "channel.ad_break.end",
    "sentence": "An ad break ends",
    "taxonomy": ["platform.twitch", "stream.ads"],
    "emits": {
      "fields": [
        { "path": "durationSeconds", "type": "number", "example": 90 },
        { "path": "isAutomatic", "type": "boolean" },
        { "path": "startedAt", "type": "string" },
        { "path": "endedAt", "type": "string" }
      ]
    }
  }
]
```
