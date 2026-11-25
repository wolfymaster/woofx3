import type { EventSubStreamOfflineEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import { publishEvent } from "../../../shared/publish-event";
import type { Context } from "../../types";

// Mirrors `onStreamOnline.ts`. The raw `stream.offline` EventSub
// notification only identifies the broadcaster — there's no payload
// to enrich. Subscribers that need richer state (final viewer count,
// recap stats) should query Helix separately at the time of consumption.
export default function onStreamOffline(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onStreamOffline(ctx.broadcaster.id, async (event: EventSubStreamOfflineEvent) => {
    await publishEvent(ctx, () =>
      ctx.events.Platform("twitch").streamOffline({
        broadcasterUserId: event.broadcasterId,
        broadcasterUserName: event.broadcasterName,
      })
    );
    ctx.onStreamLiveChange?.(false);
  });
}
