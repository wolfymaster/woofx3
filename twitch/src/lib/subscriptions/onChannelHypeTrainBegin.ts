import { EventSubChannelHypeTrainBeginEvent, EventSubSubscription } from "@twurple/eventsub-base";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { Context } from "src/types";

export default function onChannelHypeTrainBegin(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
    return listener.onChannelHypeTrainBegin(ctx.broadcaster.id, async (event: EventSubChannelHypeTrainBeginEvent) => {
        const [topic, data] = ctx.events.Twitch().hypeTrainBegin(event);
        ctx.messageBus.publish(topic, data);
    })
}