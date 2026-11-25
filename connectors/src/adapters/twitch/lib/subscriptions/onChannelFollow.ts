import type { EventSubChannelFollowEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import { publishEvent } from "../../../shared/publish-event";
import type { Context } from "../../types";

export default function onChannelFollow(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelFollow(ctx.broadcaster.id, ctx.broadcaster.id, async (event: EventSubChannelFollowEvent) => {
    await publishEvent(ctx, () =>
      ctx.events.Platform("twitch").follow({
        userId: event.userId,
        userName: event.userDisplayName,
      })
    );
  });
}
