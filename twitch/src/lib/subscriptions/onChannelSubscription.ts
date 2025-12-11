import { EventSubChannelSubscriptionEvent, EventSubSubscription } from "@twurple/eventsub-base";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { Context } from "src/types";

export default function onChannelSubscription(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
    return listener.onChannelSubscription(ctx.broadcaster.id, async (event: EventSubChannelSubscriptionEvent) => {
        const { userId, userDisplayName, isGift, tier } = event;
        const [topic, data] = ctx.events.Twitch().subscribe({
            isGift,
            tier,
            userId,
            userName: userDisplayName,
        });
        ctx.messageBus.publish(topic, data);
    })
}