import type { EventSubChannelRedemptionAddEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "../../types";
import { publishEvent } from "../publishEvent";

export default function onChannelRedemptionAdd(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelRedemptionAdd(ctx.broadcaster.id, async (event: EventSubChannelRedemptionAddEvent) => {
    await publishEvent(ctx, () =>
      ctx.events.Twitch().redeem({
        redeemId: event.id,
        rewardId: event.rewardId,
        rewardTitle: event.rewardTitle,
        rewardCost: event.rewardCost,
        userId: event.userId,
        userName: event.userDisplayName,
        message: event.input || undefined,
      })
    );
  });
}
