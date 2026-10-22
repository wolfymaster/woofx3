import type { EventSubChannelHypeTrainBeginV2Event, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { HypeTrainBegin } from "@woofx3/common/cloudevents/Twitch";
import type { Context } from "../../types";
import { publishEvent } from "../publishEvent";

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
    // A mapping or guard failure drops this one event; it must not escape the
    // async callback as an unhandled rejection. publishEvent logs its own failures.
    try {
      const [topic, data] = ctx.events.Twitch().hypeTrainBegin(toHypeTrainBegin(event));
      await publishEvent(ctx, [topic, data]);
    } catch (error) {
      ctx.logger.error("twitch: could not read a hype train begin event; dropping it", {
        hypeTrainId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
