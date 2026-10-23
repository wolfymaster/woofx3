import type { EventSubChannelCheerEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "../../types";
import { publishEvent } from "../publishEvent";

export default function onChannelCheer(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelCheer(ctx.broadcaster.id, async (event: EventSubChannelCheerEvent) => {
    await publishEvent(ctx, () =>
      ctx.events.Twitch().cheer({
        amount: event.bits,
        isAnonymous: event.isAnonymous,
        message: event.message,
        userName: event.userDisplayName,
        userId: event.userId,
      })
    );
  });
}
