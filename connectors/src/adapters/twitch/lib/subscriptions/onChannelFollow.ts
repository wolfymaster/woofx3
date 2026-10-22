import type { EventSubChannelFollowEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "../../types";
import { publishEvent } from "../publishEvent";

export default function onChannelFollow(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelFollow(ctx.broadcaster.id, ctx.broadcaster.id, async (event: EventSubChannelFollowEvent) => {
    const { userDisplayName, userId } = event;
    const [topic, data] = ctx.events.Twitch().follow({
      userId,
      userName: userDisplayName,
    });
    await publishEvent(ctx, [topic, data]);
  });
}
