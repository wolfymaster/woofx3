import type { EventSubChannelCheerEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "../../types";
import { publishEvent } from "../publishEvent";

export default function onChannelCheer(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelCheer(ctx.broadcaster.id, async (event: EventSubChannelCheerEvent) => {
    const { message, bits, isAnonymous, userDisplayName, userId } = event;
    const [topic, data] = ctx.events.Twitch().cheer({
      amount: bits,
      isAnonymous,
      message,
      userName: userDisplayName,
      userId,
    });
    await publishEvent(ctx, [topic, data]);
  });
}
