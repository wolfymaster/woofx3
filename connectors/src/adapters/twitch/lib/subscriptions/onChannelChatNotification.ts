import type {
  EventSubChannelChatNotificationEvent,
  EventSubChannelChatRaidNotificationEvent,
  EventSubSubscription,
} from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type EventFactory from "@woofx3/common/cloudevents/EventFactory";
import type { Context } from "../../types";
import { type EventTuple, publishEvent } from "../publishEvent";

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
      // The channel.raid subscription (onChannelRaid) publishes every raid on this
      // channel; publishing its chat notice too would announce each raid twice.
      if (event.type === "raid") {
        return;
      }
      await publishEvent(ctx, () => notificationEvent(ctx.events, event));
    }
  );
}

/** The bus event for one chat notification other than a raid in this channel. */
function notificationEvent(
  events: EventFactory,
  event: Exclude<EventSubChannelChatNotificationEvent, EventSubChannelChatRaidNotificationEvent>
): EventTuple {
  const base = baseFields(event);
  const twitch = events.Twitch();

  switch (event.type) {
    case "sub": {
      return twitch.subscribe({
        isGift: false,
        tier: event.tier,
        userId: event.chatterId,
        userName: event.chatterDisplayName,
      });
    }
    case "resub": {
      return twitch.resub({
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
    }
    case "sub_gift": {
      return twitch.subscribe({
        isGift: true,
        tier: event.tier,
        userId: event.recipientId,
        userName: event.recipientDisplayName,
      });
    }
    case "community_sub_gift": {
      return twitch.subscriptionGift({
        amount: event.amount,
        gifterId: event.chatterId,
        gifterName: event.chatterDisplayName,
        isAnonymous: event.chatterIsAnonymous,
        tier: event.tier,
      });
    }
    case "gift_paid_upgrade": {
      return twitch.giftPaidUpgrade({
        ...base,
        isGifterAnonymous: event.isGifterAnonymous,
        gifterId: event.gifterId,
        gifterName: event.gifterDisplayName,
      });
    }
    case "prime_paid_upgrade": {
      return twitch.primePaidUpgrade({
        ...base,
        tier: event.tier,
      });
    }
    case "unraid": {
      return twitch.unraid({ ...base });
    }
    case "pay_it_forward": {
      return twitch.payItForward({
        ...base,
        isGifterAnonymous: event.isGifterAnonymous,
        gifterId: event.gifterId,
        gifterName: event.gifterDisplayName,
      });
    }
    case "announcement": {
      return twitch.announcement({
        ...base,
        color: event.announcementColor,
      });
    }
    case "charity_donation": {
      return twitch.charityDonation({
        ...base,
        charityName: event.charityName,
        amount: event.amount.localizedValue,
        currency: event.amount.currency,
      });
    }
    case "bits_badge_tier": {
      return twitch.bitsBadgeTier({
        ...base,
        newTier: event.newTier,
      });
    }
    case "watch_streak": {
      return twitch.watchStreak({
        ...base,
        streakCount: event.streakCount,
        channelPointsAwarded: event.channelPointsAwarded,
      });
    }
    case "shared_chat_sub": {
      return twitch.sharedSubscribe({
        ...base,
        isGift: false,
        tier: event.tier,
        userId: event.chatterId,
        userName: event.chatterDisplayName,
      });
    }
    case "shared_chat_resub": {
      return twitch.sharedResub({
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
    }
    case "shared_chat_sub_gift": {
      return twitch.sharedSubscribe({
        ...base,
        isGift: true,
        tier: event.tier,
        userId: event.recipientId,
        userName: event.recipientDisplayName,
      });
    }
    case "shared_chat_community_sub_gift": {
      return twitch.sharedSubscriptionGift({
        ...base,
        amount: event.amount,
        gifterId: event.chatterId,
        gifterName: event.chatterDisplayName,
        isAnonymous: event.chatterIsAnonymous,
        tier: event.tier,
      });
    }
    case "shared_chat_gift_paid_upgrade": {
      return twitch.sharedGiftPaidUpgrade({
        ...base,
        isGifterAnonymous: event.isGifterAnonymous,
        gifterId: event.gifterId,
        gifterName: event.gifterDisplayName,
      });
    }
    case "shared_chat_prime_paid_upgrade": {
      return twitch.sharedPrimePaidUpgrade({
        ...base,
        tier: event.tier,
      });
    }
    case "shared_chat_raid": {
      return twitch.sharedRaid({
        ...base,
        fromBroadcasterUserId: event.raiderId,
        fromBroadcasterUserName: event.raiderDisplayName,
        viewers: event.viewerCount,
      });
    }
    case "shared_chat_pay_it_forward": {
      return twitch.sharedPayItForward({
        ...base,
        isGifterAnonymous: event.isGifterAnonymous,
        gifterId: event.gifterId,
        gifterName: event.gifterDisplayName,
      });
    }
    case "shared_chat_announcement": {
      return twitch.sharedAnnouncement({
        ...base,
        color: event.color,
      });
    }
    default: {
      // Exhaustiveness check: if Twurple adds a new notice_type, this
      // assignment fails to compile until a case above handles it.
      const unexpected: never = event;
      throw new Error(`unknown chat notification type ${JSON.stringify((unexpected as { type: unknown }).type)}`);
    }
  }
}
