import type { EventSubChannelHypeTrainBeginV2Event, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";

export default function onChannelHypeTrainBegin(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelHypeTrainBeginV2(ctx.broadcaster.id, async (event: EventSubChannelHypeTrainBeginV2Event) => {
    const [topic, data] = ctx.events.Twitch().hypeTrainBegin(event);
    ctx.messageBus.publish(topic, data);
  });
}
