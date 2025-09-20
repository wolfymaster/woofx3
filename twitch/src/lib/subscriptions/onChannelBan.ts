import { EventSubChannelBanEvent, EventSubSubscription } from "@twurple/eventsub-base";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import Commands from "../commands";
import { Context } from "src/types";

export default function onChannelBan(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
    return listener.onChannelBan(ctx.broadcaster.id, (event: EventSubChannelBanEvent) => {
        let { reason, isPermanent, userDisplayName, userId } = event;
        ctx.logger.info(
            Commands.USER_BANNED,
            reason,
            isPermanent,
            userDisplayName,
            userId,
        );
    });
}
