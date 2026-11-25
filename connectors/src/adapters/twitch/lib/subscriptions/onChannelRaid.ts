import type { EventSubChannelRaidEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import { publishEvent } from "../../../shared/publish-event";
import type { Context } from "../../types";

export default function onChannelRaid(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelRaidTo(ctx.broadcaster.id, async (event: EventSubChannelRaidEvent) => {
    await publishEvent(ctx, () =>
      ctx.events.Platform("twitch").raid({
        fromBroadcasterUserId: event.raidingBroadcasterId,
        fromBroadcasterUserName: event.raidingBroadcasterDisplayName,
        viewers: event.viewers,
      })
    );
  });
}
