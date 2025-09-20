import { EventSubChannelFollowEvent, EventSubSubscription } from "@twurple/eventsub-base";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { Context } from "src/types";

export default function onChannelFollow(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
    return listener.onChannelFollow(ctx.broadcaster.id, ctx.broadcaster.id, async (event: EventSubChannelFollowEvent) => {
       const { followDate, userDisplayName, userId } = event;
        // publish the follow event to workflow
        const [topic, data] = ctx.events.Twitch().follow({
            userName: userDisplayName,
        });
        ctx.messageBus.publish(topic, data);
    })
}