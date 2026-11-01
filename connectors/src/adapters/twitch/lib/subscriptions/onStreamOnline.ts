import type { EventSubStreamOnlineEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "../../types";
import { publishEvent } from "../publishEvent";

export default function onStreamOnline(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onStreamOnline(ctx.broadcaster.id, async (event: EventSubStreamOnlineEvent) => {
    // `startDate` is when the EventSub topic considers the broadcast to have
    // begun. Falling back to the arrival time only if Twitch omits it keeps the
    // payload contract (`startedAt: string`) non-nullable for downstream consumers.
    const startedAt = (event.startDate ?? new Date(ctx.clock.now())).toISOString();
    await publishEvent(ctx, () =>
      ctx.events.Twitch().streamOnline({
        broadcasterUserId: event.broadcasterId,
        broadcasterUserName: event.broadcasterName,
        startedAt,
      })
    );
    ctx.onStreamLiveChange?.(true, startedAt);
  });
}
