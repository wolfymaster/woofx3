import type { EventSubChannelChatNotificationEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";

function baseFields(event: EventSubChannelChatNotificationEvent) {
  return {
    broadcasterId: event.broadcasterId,
    broadcasterName: event.broadcasterDisplayName,
    chatterId: event.chatterId,
    chatterName: event.chatterDisplayName,
    chatterIsAnonymous: event.chatterIsAnonymous,
    messageId: event.messageId,
    messageText: event.messageText,
    sourceBroadcasterId: event.sourceBroadcasterId,
    sourceBroadcasterName: event.sourceBroadcasterDisplayName,
  };
}

export default function onChannelChatNotification(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  return listener.onChannelChatNotification(
    ctx.broadcaster.id,
    ctx.broadcaster.id,
    async (event: EventSubChannelChatNotificationEvent) => {
      const base = baseFields(event);
      const twitch = ctx.events.Twitch();

      switch (event.type) {
        case "sub": {
          const [topic, data] = twitch.subscribe({
            isGift: false,
            tier: event.tier,
            userId: event.chatterId,
            userName: event.chatterDisplayName,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "resub": {
          const [topic, data] = twitch.resub({
            ...base,
            tier: event.tier,
            isPrime: event.isPrime,
            durationMonths: event.durationMonths,
            cumulativeMonths: event.cumulativeMonths,
            streakMonths: event.streakMonths,
            isGift: event.isGift,
            gifterIsAnonymous: event.isGifterAnonymous,
            gifterId: event.gifterId,
            gifterName: event.gifterDisplayName,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "sub_gift": {
          const [topic, data] = twitch.subscribe({
            isGift: true,
            tier: event.tier,
            userId: event.recipientId,
            userName: event.recipientDisplayName,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "community_sub_gift": {
          const [topic, data] = twitch.subscriptionGift({
            amount: event.amount,
            gifterId: event.chatterId,
            gifterName: event.chatterDisplayName,
            isAnonymous: event.chatterIsAnonymous,
            tier: event.tier,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "gift_paid_upgrade": {
          const [topic, data] = twitch.giftPaidUpgrade({
            ...base,
            isGifterAnonymous: event.isGifterAnonymous,
            gifterId: event.gifterId,
            gifterName: event.gifterDisplayName,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "prime_paid_upgrade": {
          const [topic, data] = twitch.primePaidUpgrade({
            ...base,
            tier: event.tier,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "raid": {
          const [topic, data] = twitch.raid({
            fromBroadcasterUserId: event.raiderId,
            fromBroadcasterUserName: event.raiderDisplayName,
            viewers: event.viewerCount,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "unraid": {
          const [topic, data] = twitch.unraid({ ...base });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "pay_it_forward": {
          const [topic, data] = twitch.payItForward({
            ...base,
            isGifterAnonymous: event.isGifterAnonymous,
            gifterId: event.gifterId,
            gifterName: event.gifterDisplayName,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "announcement": {
          const [topic, data] = twitch.announcement({
            ...base,
            color: event.announcementColor,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "charity_donation": {
          const [topic, data] = twitch.charityDonation({
            ...base,
            charityName: event.charityName,
            amount: event.amount.localizedValue,
            currency: event.amount.currency,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "bits_badge_tier": {
          const [topic, data] = twitch.bitsBadgeTier({
            ...base,
            newTier: event.newTier,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "watch_streak": {
          const [topic, data] = twitch.watchStreak({
            ...base,
            streakCount: event.streakCount,
            channelPointsAwarded: event.channelPointsAwarded,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "shared_chat_sub": {
          const [topic, data] = twitch.subscribe({
            isGift: false,
            tier: event.tier,
            userId: event.chatterId,
            userName: event.chatterDisplayName,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "shared_chat_resub": {
          const [topic, data] = twitch.sharedResub({
            ...base,
            tier: event.tier,
            isPrime: event.isPrime,
            durationMonths: event.durationMonths,
            cumulativeMonths: event.cumulativeMonths,
            streakMonths: event.streakMonths,
            isGift: event.isGift,
            gifterIsAnonymous: event.isGifterAnonymous,
            gifterId: event.gifterId,
            gifterName: event.gifterDisplayName,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "shared_chat_sub_gift": {
          const [topic, data] = twitch.subscribe({
            isGift: true,
            tier: event.tier,
            userId: event.recipientId,
            userName: event.recipientDisplayName,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "shared_chat_community_sub_gift": {
          const [topic, data] = twitch.subscriptionGift({
            amount: event.amount,
            gifterId: event.chatterId,
            gifterName: event.chatterDisplayName,
            isAnonymous: event.chatterIsAnonymous,
            tier: event.tier,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "shared_chat_gift_paid_upgrade": {
          const [topic, data] = twitch.sharedGiftPaidUpgrade({
            ...base,
            isGifterAnonymous: event.isGifterAnonymous,
            gifterId: event.gifterId,
            gifterName: event.gifterDisplayName,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "shared_chat_prime_paid_upgrade": {
          const [topic, data] = twitch.sharedPrimePaidUpgrade({
            ...base,
            tier: event.tier,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "shared_chat_raid": {
          const [topic, data] = twitch.raid({
            fromBroadcasterUserId: event.raiderId,
            fromBroadcasterUserName: event.raiderDisplayName,
            viewers: event.viewerCount,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "shared_chat_pay_it_forward": {
          const [topic, data] = twitch.sharedPayItForward({
            ...base,
            isGifterAnonymous: event.isGifterAnonymous,
            gifterId: event.gifterId,
            gifterName: event.gifterDisplayName,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        case "shared_chat_announcement": {
          const [topic, data] = twitch.sharedAnnouncement({
            ...base,
            color: event.color,
          });
          ctx.messageBus.publish(topic, data);
          break;
        }
        default: {
          // Exhaustiveness check: if Twurple adds a new notice_type, this
          // assignment fails to compile until a case above handles it.
          const unexpected: never = event;
          ctx.logger.warn("received unknown chat notification type", { event: unexpected });
        }
      }
    }
  );
}
