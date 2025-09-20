import { EventSubChannelSubscriptionGiftEvent, EventSubSubscription } from "@twurple/eventsub-base";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { Context } from "src/types";

export default function onChannelSubscriptionGift(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
    return listener.onChannelSubscriptionGift(ctx.broadcaster.id, async (event: EventSubChannelSubscriptionGiftEvent) => {
        const { gifterId, gifterDisplayName, amount, tier, isAnonymous } = event;
        const [topic, data] = ctx.events.Twitch().subscriptionGift({
            amount,
            gifterId,
            gifterName: gifterDisplayName,
            isAnonymous,
            tier,
        });
        ctx.messageBus.publish(topic, data);
    })
}