import type { ChatterMembership } from "../Chat/events";
/**
 * Event types are platform-agnostic: the same `channel.follow` is emitted
 * whether the follow arrived from Twitch or anywhere else. Which platform it
 * came from travels as the CloudEvent's top-level `platform` attribute, so a
 * workflow can subscribe to the event class and narrow by platform only when
 * it actually cares.
 *
 * The value is also the NATS subject (see `encodeEvent`), so the hierarchy
 * reads left to right and `channel.>` is a usable subscription.
 */
export enum EventType {
  ChatMessage = "user.message",
  Cheer = "channel.cheer",
  Follow = "channel.follow",
  HypeTrainBegin = "channel.hypetrain",
  Raid = "channel.raid",
  Redeem = "channelpoints.redeem",
  StreamOnline = "stream.online",
  StreamOffline = "stream.offline",
  Subscribe = "channel.subscribe",
  SubscriptionGift = "channel.subscriptionGift",
  Resub = "channel.resub",
  GiftPaidUpgrade = "channel.giftPaidUpgrade",
  PrimePaidUpgrade = "channel.primePaidUpgrade",
  Unraid = "channel.unraid",
  PayItForward = "channel.payItForward",
  Announcement = "channel.announcement",
  CharityDonation = "channel.charityDonation",
  BitsBadgeTier = "channel.bitsBadgeTier",
  WatchStreak = "channel.watchStreak",
  SharedSubscribe = "channel.sharedSubscribe",
  SharedSubscriptionGift = "channel.sharedSubscriptionGift",
  SharedRaid = "channel.sharedRaid",
  SharedResub = "channel.sharedResub",
  SharedGiftPaidUpgrade = "channel.sharedGiftPaidUpgrade",
  SharedPrimePaidUpgrade = "channel.sharedPrimePaidUpgrade",
  SharedPayItForward = "channel.sharedPayItForward",
  SharedAnnouncement = "channel.sharedAnnouncement",
  AdBreakUpcoming = "channel.ad_break.upcoming",
  AdBreakBegin = "channel.ad_break.begin",
  AdBreakEnd = "channel.ad_break.end",
}

export interface ChatMessage {
  amount: number;
  isPaid: boolean;
  channelId: string | null;
  channelName: string | null;
  chatterId: string;
  chatterName: string;
  message: string;
  membership: ChatterMembership;
}

export interface Cheer {
  amount: number;
  isAnonymous: boolean;
  message: string;
  userId: string | null;
  userName: string | null;
}

// a twitch follow event
export interface Follow {
  userId: string;
  userName: string;
}

export interface HypeTrainBegin {}

// An incoming raid into the broadcaster's channel.
export interface Raid {
  fromBroadcasterUserId: string;
  fromBroadcasterUserName: string;
  viewers: number;
}

// A channel-points custom reward redemption (channel.channel_points_custom_reward_redemption.add).
export interface Redeem {
  redeemId: string;
  rewardId: string;
  rewardTitle: string;
  // Channel points the viewer spent on the reward.
  rewardCost: number;
  userId: string;
  userName: string;
  message?: string;
}

// Twitch's `stream.online` EventSub payload identifies the broadcaster
// and carries a start timestamp; everything else (title, game, viewer
// count) requires a follow-up Helix lookup. Subscribers that just need
// the on/off transition can ignore the optional fields.
/**
 * An ad break is scheduled soon. Not a Twitch event: the api reads the ad
 * schedule while the stream is live and publishes this once per scheduled
 * break, `secondsUntil` ahead of it (docs/services/twitch-channel.md).
 */
export interface AdBreakUpcoming {
  /** ISO-8601 time Twitch has the next ad break scheduled for. */
  nextAdAt: string;
  secondsUntil: number;
  durationSeconds: number;
}

/** An ad break started (EventSub channel.ad_break.begin). */
export interface AdBreakBegin {
  durationSeconds: number;
  /** False when the broadcaster or an editor ran the ad by hand. */
  isAutomatic: boolean;
  startedAt: string;
  /** `startedAt` plus `durationSeconds`: when the break is expected to end. */
  endsAt: string;
}

/**
 * An ad break ended. Twitch sends no end event: the twitch service
 * publishes this `durationSeconds` after the begin event, so `endedAt` is
 * when the break was due to end, not an observation that it did.
 */
export interface AdBreakEnd {
  durationSeconds: number;
  isAutomatic: boolean;
  startedAt: string;
  endedAt: string;
}

export interface StreamOnline {
  broadcasterUserId: string;
  broadcasterUserName: string;
  startedAt: string;
}

// Counterpart to `StreamOnline`. The raw `stream.offline` EventSub
// notification doesn't carry a payload beyond broadcaster identity.
export interface StreamOffline {
  broadcasterUserId: string;
  broadcasterUserName: string;
}

export interface Subscribe {
  isGift: boolean;
  tier: string;
  userId: string | null;
  userName: string | null;
}

export interface SubscriptionGift {
  amount: number;
  gifterId: string;
  gifterName: string;
  isAnonymous: boolean;
  tier: string;
}

// Fields shared by every channel.chat.notification subtype.
export interface NotificationBase {
  broadcasterId: string;
  broadcasterName: string;
  chatterId: string;
  chatterName: string;
  chatterIsAnonymous: boolean;
  messageId: string;
  messageText: string;
  // Only set when the notification happens in another channel's chat
  // during a shared chat session; null otherwise.
  sourceBroadcasterId: string | null;
  sourceBroadcasterName: string | null;
}

export interface Resub extends NotificationBase {
  tier: string;
  isPrime: boolean;
  durationMonths: number;
  cumulativeMonths: number;
  streakMonths: number | null;
  isGift: boolean;
  gifterIsAnonymous: boolean | null;
  gifterId: string | null;
  gifterName: string | null;
}

export interface GiftPaidUpgrade extends NotificationBase {
  isGifterAnonymous: boolean;
  gifterId: string | null;
  gifterName: string | null;
}

export interface PrimePaidUpgrade extends NotificationBase {
  tier: string;
}

export interface Unraid extends NotificationBase {}

export interface PayItForward extends NotificationBase {
  isGifterAnonymous: boolean;
  gifterId: string | null;
  gifterName: string | null;
}

export interface Announcement extends NotificationBase {
  color: string;
}

export interface CharityDonation extends NotificationBase {
  charityName: string;
  amount: number;
  currency: string;
}

export interface BitsBadgeTier extends NotificationBase {
  newTier: number;
}

export interface WatchStreak extends NotificationBase {
  streakCount: number;
  channelPointsAwarded: number;
}

// The shared* events are activity in another participant's channel during a
// shared chat session, which Twitch also shows in this broadcaster's chat. They
// are kept apart from the plain events so a partner's sub or raid never reads as
// one on this channel; sourceBroadcasterId names the channel it happened in.
export interface SharedSubscribe extends Subscribe, NotificationBase {}

export interface SharedSubscriptionGift extends SubscriptionGift, NotificationBase {}

export interface SharedRaid extends Raid, NotificationBase {}

export interface SharedResub extends Resub {}

export interface SharedGiftPaidUpgrade extends GiftPaidUpgrade {}

export interface SharedPrimePaidUpgrade extends PrimePaidUpgrade {}

export interface SharedPayItForward extends PayItForward {}

export interface SharedAnnouncement extends Announcement {}
