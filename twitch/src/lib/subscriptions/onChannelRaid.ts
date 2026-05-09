import type { EventSubChannelRaidEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";

export default function onChannelRaid(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelRaidTo(ctx.broadcaster.id, async (event: EventSubChannelRaidEvent) => {
    const { raidingBroadcasterId, raidingBroadcasterDisplayName, viewers } = event;
    const [topic, data] = ctx.events.Twitch().raid({
      fromBroadcasterUserId: raidingBroadcasterId,
      fromBroadcasterUserName: raidingBroadcasterDisplayName,
      viewers,
    });
    ctx.messageBus.publish(topic, data);
  });
}
