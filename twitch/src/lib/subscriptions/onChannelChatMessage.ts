import type { EventSubChannelChatMessageEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { ChatterBadges } from "@woofx3/common/cloudevents/Twitch/events";
import type { Context } from "src/types";

/**
 * Twitch exposes no queryable roster for moderator/VIP/subscriber status, but
 * it stamps the badges onto every chat message. Reading them here is what lets
 * downstream consumers keep the built-in subscriber/vip/moderator/broadcaster
 * groups current.
 *
 * `sourceBadges` is populated instead of `badges` for messages arriving through
 * a shared-chat session; prefer it when present so a shared-chat message is
 * attributed with the chatter's badges in their own channel rather than this
 * one.
 */
function readBadges(event: EventSubChannelChatMessageEvent): ChatterBadges {
    const hasBadge = (name: string): boolean => {
        if (event.sourceBadges !== null && event.sourceBadges !== undefined) {
            return event.hasSourceBadge(name);
        }
        return event.hasBadge(name);
    };

    return {
        isBroadcaster: hasBadge("broadcaster"),
        isModerator: hasBadge("moderator"),
        // "founder" is the badge long-term subscribers keep in place of the
        // subscriber badge; both mean an active subscription.
        isSubscriber: hasBadge("subscriber") || hasBadge("founder"),
        isVip: hasBadge("vip"),
    };
}

export default function onChannelChatmessage(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
    return listener.onChannelChatMessage(ctx.broadcaster.id, ctx.broadcaster.id, async (event: EventSubChannelChatMessageEvent) => {
        const { bits, chatterId, chatterDisplayName, sourceBroadcasterName, sourceBroadcasterId, messageText } = event;
        const [topic, data] = ctx.events.Twitch().chatMessage({
            amount: bits,
            channelId: sourceBroadcasterId,
            channelName: sourceBroadcasterName,
            chatterId,
            chatterName: chatterDisplayName,
            isPaid: Boolean(bits),
            message: messageText,
            badges: readBadges(event),
        });
        try {
            ctx.messageBus.publish(topic, data);
        } catch (err) {
            console.error(err);
        }
    })
}
