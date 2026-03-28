import type { EventSubChannelBanEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";
import Commands from "../commands";

export default function onChannelBan(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelBan(ctx.broadcaster.id, (event: EventSubChannelBanEvent) => {
    const { reason, isPermanent, userDisplayName, userId } = event;
    ctx.logger.info(Commands.USER_BANNED, reason, isPermanent, userDisplayName, userId);
  });
}
