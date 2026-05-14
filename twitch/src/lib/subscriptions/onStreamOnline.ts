import type { EventSubStreamOnlineEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";

export default function onStreamOnline(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onStreamOnline(ctx.broadcaster.id, async (event: EventSubStreamOnlineEvent) => {
    const [topic, data] = ctx.events.Twitch().streamOnline({
      broadcasterUserId: event.broadcasterId,
      broadcasterUserName: event.broadcasterName,
      // `startDate` is when the EventSub topic considers the broadcast
      // to have begun. Falling back to `new Date()` only if Twitch
      // omits it — extremely unlikely but keeps the payload contract
      // (`startedAt: string`) non-nullable for downstream consumers.
      startedAt: (event.startDate ?? new Date()).toISOString(),
    });
    ctx.messageBus.publish(topic, data);
  });
}
