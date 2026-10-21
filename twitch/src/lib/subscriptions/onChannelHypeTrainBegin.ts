import type { EventSubChannelHypeTrainBeginV2Event, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { HypeTrainBegin } from "@woofx3/common/cloudevents/Twitch";
import type { Context } from "src/types";

/**
 * Copies the hype train's fields out of Twurple's event. The event itself must
 * never be published: its data sits behind getters, while its API client and
 * that client's credentials are own properties that serialize.
 */
export function toHypeTrainBegin(event: EventSubChannelHypeTrainBeginV2Event): HypeTrainBegin {
  return {
    id: event.id,
    broadcasterId: event.broadcasterId,
    broadcasterName: event.broadcasterDisplayName,
    level: event.level,
    total: event.total,
    progress: event.progress,
    goal: event.goal,
    topContributions: event.topContributors.map((contribution) => ({
      userId: contribution.userId,
      userName: contribution.userDisplayName,
      type: contribution.type,
      total: contribution.total,
    })),
    startedAt: event.startDate.toISOString(),
    expiresAt: event.expiryDate.toISOString(),
  };
}

export default function onChannelHypeTrainBegin(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelHypeTrainBeginV2(ctx.broadcaster.id, async (event: EventSubChannelHypeTrainBeginV2Event) => {
    const [topic, data] = ctx.events.Twitch().hypeTrainBegin(toHypeTrainBegin(event));
    ctx.messageBus.publish(topic, data);
  });
}
