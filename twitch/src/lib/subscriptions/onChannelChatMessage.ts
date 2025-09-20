import { EventSubChannelChatMessageEvent, EventSubSubscription } from "@twurple/eventsub-base";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { Context } from "src/types";

export default function onChannelChatmessage(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
    return listener.onChannelChatMessage(ctx.broadcaster.id, ctx.broadcaster.id, async (event: EventSubChannelChatMessageEvent) => {
        const { bits, chatterId, chatterDisplayName, sourceBroadcasterName, sourceBroadcasterId, messageText } = event;
        const [topic, data] = ctx.events.Twitch().chatMessage({
            amount: bits,
            channelId: sourceBroadcasterId,
            channelName: sourceBroadcasterName,
            chatterId,
            chatterName: chatterDisplayName,
            isPaid: Boolean(bits),
            message: messageText,
        });
        try {
            ctx.messageBus.publish(topic, data);
        } catch (err) {
            console.error(err);
        }
    })
}