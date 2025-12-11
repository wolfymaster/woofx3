import { EventSubChannelCheerEvent, EventSubSubscription } from "@twurple/eventsub-base";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { Context } from "src/types";

export default function onChannelCheer(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
    return listener.onChannelCheer(ctx.broadcaster.id, async (event: EventSubChannelCheerEvent) => {
        const { message, bits, isAnonymous, userDisplayName, userId } = event;
        const [topic, data] = ctx.events.Twitch().cheer({
            amount: bits,
            isAnonymous,
            message,
            userName: userDisplayName,
            userId
        });
        ctx.messageBus.publish(topic, data);
    })
}