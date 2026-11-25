import type { EventSubChannelCheerEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import { publishEvent } from "../../../shared/publish-event";
import type { Context } from "../../types";

export default function onChannelCheer(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelCheer(ctx.broadcaster.id, async (event: EventSubChannelCheerEvent) => {
    await publishEvent(ctx, () =>
      ctx.events.Platform("twitch").cheer({
        amount: event.bits,
        isAnonymous: event.isAnonymous,
        message: event.message,
        userName: event.userDisplayName,
        userId: event.userId,
      })
    );
  });
}
