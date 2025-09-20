import { EventSubStreamOnlineEvent, EventSubSubscription } from "@twurple/eventsub-base";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { Context } from "src/types";

export default function onStreamOnline(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
    return listener.onStreamOnline(ctx.broadcaster.id, async (event: EventSubStreamOnlineEvent) => {
        const [topic, data] = ctx.events.Twitch().streamOnline(event);
        ctx.messageBus.publish(topic, data);
    })
}