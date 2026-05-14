import type { EventSubStreamOfflineEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";

// Mirrors `onStreamOnline.ts`. The raw `stream.offline` EventSub
// notification only identifies the broadcaster — there's no payload
// to enrich. Subscribers that need richer state (final viewer count,
// recap stats) should query Helix separately at the time of consumption.
export default function onStreamOffline(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onStreamOffline(ctx.broadcaster.id, async (event: EventSubStreamOfflineEvent) => {
    const [topic, data] = ctx.events.Twitch().streamOffline({
      broadcasterUserId: event.broadcasterId,
      broadcasterUserName: event.broadcasterName,
    });
    ctx.messageBus.publish(topic, data);
  });
}
