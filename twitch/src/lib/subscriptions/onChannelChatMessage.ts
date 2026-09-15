import type { EventSubChannelChatMessageEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import type { Context } from "src/types";

/**
 * Map Twitch's badges onto the platform-neutral ChatterMembership shape.
 *
 * This covers only what a badge can answer. Following has no badge at all and
 * the subscriber badge's version encodes tier by a brittle convention, so both
 * are filled in out of band by the enricher - see chatterMembership.ts.
 *
 * Badges are a Twitch wire detail and stop here: nothing downstream knows how
 * this channel reports membership, only that it does. Twitch exposes no
 * queryable roster for moderator/VIP/subscriber status but stamps the badges
 * onto every message, so reading them here is what lets consumers keep the
 * built-in subscriber/vip/moderator/broadcaster groups current.
 *
 * `sourceBadges` is populated instead of `badges` for messages arriving through
 * a shared-chat session; prefer it when present so a shared-chat message is
 * attributed with the chatter's badges in their own channel rather than this
 * one.
 */
function readMembership(event: EventSubChannelChatMessageEvent): ChatterMembership {
  const hasBadge = (name: string): boolean => {
    if (event.sourceBadges !== null && event.sourceBadges !== undefined) {
      return event.hasSourceBadge(name) ?? false;
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
  return listener.onChannelChatMessage(
    ctx.broadcaster.id,
    ctx.broadcaster.id,
    async (event: EventSubChannelChatMessageEvent) => {
      const { bits, chatterId, chatterDisplayName, sourceBroadcasterName, sourceBroadcasterId, messageText } = event;

      // Following and subscription tier are not on the message at all, so
      // they come from Helix. The enricher bounds how long that may take and
      // leaves the fields absent when it does not resolve: a chat message
      // must never wait on a permissions lookup.
      const badged = readMembership(event);
      const membership = ctx.membershipEnricher
        ? await ctx.membershipEnricher.enrich(ctx.broadcaster.id, chatterId, badged)
        : badged;

      const [topic, data] = ctx.events.Twitch().chatMessage({
        amount: bits,
        channelId: sourceBroadcasterId,
        channelName: sourceBroadcasterName,
        chatterId,
        chatterName: chatterDisplayName,
        isPaid: Boolean(bits),
        message: messageText,
        membership,
      });
      try {
        ctx.messageBus.publish(topic, data);
      } catch (err) {
        console.error(err);
      }
    }
  );
}
