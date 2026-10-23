import type { EventSubChannelRaidEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "../../types";
import { publishEvent } from "../publishEvent";

export default function onChannelRaid(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelRaidTo(ctx.broadcaster.id, async (event: EventSubChannelRaidEvent) => {
    await publishEvent(ctx, () =>
      ctx.events.Twitch().raid({
        fromBroadcasterUserId: event.raidingBroadcasterId,
        fromBroadcasterUserName: event.raidingBroadcasterDisplayName,
        viewers: event.viewers,
      })
    );
  });
}
