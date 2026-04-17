# twitch_platform

Registers Twitch EventSub subscription types as eventbus workflow triggers. Each trigger id is `twitch.<EventSub subscription type>` (for example `twitch.channel.follow`, `twitch.stream.online`), matching the `type` field on events published as `twitch.<subscriptionType>`. Every trigger sets manifest `category` to `platform.twitch` for UI grouping and `RegisterTrigger`.

Source list: [EventSub subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/). Regenerate or extend `module.json` when Twitch adds types.

Install together with modules whose workflows reference these trigger ids (for example `wolfy_profile`).
