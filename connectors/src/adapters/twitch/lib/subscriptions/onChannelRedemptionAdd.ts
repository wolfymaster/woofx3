import type { EventSubChannelRedemptionAddEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import { publishEvent } from "../../../shared/publish-event";
import type { Context } from "../../types";

export default function onChannelRedemptionAdd(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelRedemptionAdd(ctx.broadcaster.id, async (event: EventSubChannelRedemptionAddEvent) => {
    await publishEvent(ctx, () =>
      ctx.events.Platform("twitch").redeem({
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
