import type { EventSubChannelRedemptionAddEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";

export default function onChannelRedemptionAdd(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
    return listener.onChannelRedemptionAdd(ctx.broadcaster.id, async (event: EventSubChannelRedemptionAddEvent) => {
        const { id, userId, userDisplayName, input, rewardId, rewardTitle } = event;
        const [topic, data] = ctx.events.Twitch().redeem({
            redeemId: id,
            rewardId,
            rewardTitle,
            userId,
            userName: userDisplayName,
            message: input || undefined,
        });
        ctx.messageBus.publish(topic, data);
    });
}
