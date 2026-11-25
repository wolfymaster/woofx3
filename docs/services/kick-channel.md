# Kick

The Kick adapter of the connectors service (`connectors/src/adapters/kick/`,
called the adapter below) turns Kick webhook deliveries into engine events and
is the one place the engine talks to Kick's public API (`api.kick.com`) on the
streamer's behalf. It runs beside the Twitch and OBS adapters under the same
host lifecycle, scoped bus, live-status board and platform gateway.

## Linking and the token

Kick requires the app's client secret for the code exchange and for every
refresh, and has no public client, so no engine can renew a Kick token by
itself with the shared woofx3 app. The dashboard owns the Kick app, the secret
and the refresh token:

| Step | Who | How |
|---|---|---|
| Link | dashboard | OAuth with PKCE, then `setKickToken(grant)` over the engine RPC. The api stores it as `kick_token` with the session's client id, sets `integration.kick.enabled`, and publishes `setting.integration.token.updated` with `integration: "kick"`. |
| Use | connectors | The adapter asks the api on `engine.kick.token` (`{ force?: boolean }`) and keeps the token until 60 s before it expires. A 401 from Kick asks again with `force`. |
| Renew | api | `KickTokenSource` sends the `kick.token.requested` engine request to the dashboard that linked the account, which refreshes with the secret and answers `{ token }`, or `{ token: null, reason }` with `not_linked` or `relink_required`. Concurrent callers share one renewal; a refusal marks `authFailedAt` on `getKickLink`. |
| Unlink | dashboard | `deleteKickToken()` clears the row and turns the integration off. |

`getKickLink()` describes the link without its token. The adapter runs while
`kick_token` holds a value and `integration.kick.enabled` is not `false`
(`kickLinkReader`). Engines advertise all of this as the `integrations.kick`
capability.

Kick user ids are integers on the wire and decimal strings everywhere in
woofx3, converted once in the REST client.

## Webhook ingress

Kick delivers events only by webhook, to one URL per app. Every delivery,
from Kick itself or from a relay, enters the engine at `POST /webhooks/kick` on
the api with Kick's headers (`Kick-Event-Message-Id`,
`Kick-Event-Subscription-Id`, `Kick-Event-Signature`,
`Kick-Event-Message-Timestamp`, `Kick-Event-Type`, `Kick-Event-Version`) and
the raw body. The api caps the body at 256 KiB (413 above) and hands both,
untouched, to the adapter on `engine.kick.webhook`
(`shared/common/typescript/cloudevents/Kick/webhook.ts`). The adapter verifies
the signature itself, so nothing that forwarded the delivery is trusted.

| Step | Outcome |
|---|---|
| Headers missing or not a delivery | 400 `malformed` |
| RSA PKCS#1 v1.5 SHA-256 signature over `${messageId}.${timestamp}.${body}` does not verify | 401 `bad_signature` |
| No public key could be fetched | 503 `unavailable` |
| Timestamp more than an hour from the clock, either way | 401 `stale` |
| Message id already published | 200 `duplicate` |
| `broadcaster.user_id` is not the linked channel | 200 `ignored` (never an error: Kick unsubscribes an app from events it keeps failing) |
| Unknown event type or version | 200 `ignored` |
| Body not the event's shape | 400 `malformed` |
| An event could not be published | 500 `publish_failed`; the delivery is not remembered, so Kick's retry publishes once |
| Every event published | 200 `published` |
| Adapter stopped, starting or parked | 503 `unavailable`, answered by the host |

The public key comes from `GET /public/v1/public-key` and is cached; Kick
rotates it without a key id, so a failed check fetches it again, at most once a
minute. Delivered ids and published redemptions live in the adapter's host
state, which outlives adapter restarts but not a process restart.

On a hosted engine the shared woofx3 Kick app's webhook URL is a dashboard
route that maps the delivery's broadcaster to the engine and forwards the
bytes unchanged. Without that relay, or a public URL of its own, an engine
receives no Kick events.

## Event subscriptions

The adapter creates its subscriptions with the streamer's token
(`events:subscribe`); Kick pins the delivery URL per app, so the engine needs no
URL of its own. Kick unsubscribes an app from an event after about a day of
failed deliveries, so `SubscriptionReconciler` lists the subscriptions at
start, after a relink to the same channel and every 15 minutes, creates the
missing ones and deletes duplicates of one event and version, keeping the
oldest. A pass that could not reach Kick retries with a capped, jittered
backoff. Each event's state is in `/health` under the adapter's
`subscriptions`, so a missing scope is visible while the adapter stays
connected.

## Events

Every event is stamped `platform: "kick"` and `source: "kick"`.

| Kick event (version 1) | woofx3 event | Notes |
|---|---|---|
| `chat.message.sent` | `user.message` | `[emote:<id>:<name>]` tokens become `<name>`; membership from badge types `broadcaster`, `moderator`, `subscriber`, `vip`; no follower or tier; `amount` 0; `chatterLogin` is the channel slug |
| `channel.followed` | `channel.follow` | |
| `channel.subscription.new` | `channel.subscribe` | tier `1000`: Kick has one subscription level |
| `channel.subscription.renewal` | `channel.resub` | `cumulativeMonths` is Kick's `duration`; no message, streak or Prime |
| `channel.subscription.gifts` | `channel.subscriptionGift` when there are two or more giftees, plus one `channel.subscribe` per giftee | an anonymous gifter has empty id and name |
| `channel.reward.redemption.updated` | `channelpoints.redeem` | the first time a redemption is seen pending or accepted; later updates and rejections publish nothing |
| `livestream.status.updated` | `stream.online` or `stream.offline` | also the live-status board |
| `kicks.gifted` | `channel.kicks` | KICKs are not bits; see the stream contract |

## The `kickapi` subject

Module code reaches Kick through `ctx.kick`, which sends `{ command, args }` on
`kickapi` and gets the same reply envelope as `twitchapi`
(`kickapi.<command>.result` or `kickapi.error` with an optional `code`:
`invalid_arguments`, `unauthorized`, `missing_scope`, `rate_limited`,
`not_linked`, `integration_unavailable`).

| Command | Args | Permission |
|---|---|---|
| `getUser` | `{ userId }` or `{ userName }` (the channel slug) | none |
| `listRewards` | none; answers picker options `[{ value, label }]` | none |
| `updateStream` | `{ title?, category?, tags? }`; the category is Kick's closest name match, at most 10 tags | `kick.channel` |
| `timeout` | `{ userId \| userName, durationSeconds, reason? }`; rounded up to whole minutes, at most 7 days, never the broadcaster; answers the applied `durationSeconds` | `kick.moderation` |

## Chat and moderation through the gateway

| Gateway action | Kick |
|---|---|
| `chat.send` | `POST /public/v1/chat` as the broadcaster, refused above 2048 UTF-8 bytes; the line's webhook echo publishes with `fromEngine: true` and the sending workflow's chain |
| `chat.delete` | `DELETE /public/v1/chat/{id}`; 404 is `invalid` |
| `moderation.timeout`, `moderation.ban` | `POST /public/v1/moderation/bans`; the viewer must be a numeric Kick id |
| `chat.announce`, `chat.pin`, `moderation.warn` | unsupported: Kick has none |

Kick's 400 and 422 are `invalid`, 401 and 403 `forbidden`, 429 `rate_limited`,
anything else `upstream`; no answer after the request left is `unconfirmed`.

Chat permissions and derived groups for Kick chatters are keyed `kick:<slug>`;
see [Connectors](./connectors.md#chat-command-dispatcher).

## Limits

- Webhooks only, and one URL per app: no Kick event reaches an engine without a public URL or the dashboard relay. Local (desktop) engines get no Kick.
- Kick caps `chat.message.sent` at 1,000 subscriptions per unverified app.
- Kick documents no rate limits and no retry schedule; delivery is reported lossy.
- No raids, hype trains, shared chat, announcements, clips, markers, shoutouts, polls or ad schedule exist on Kick.
- A delivery retried across an engine restart can publish twice: the delivery memory is per process.
