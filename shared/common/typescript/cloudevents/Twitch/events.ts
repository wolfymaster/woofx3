import type * as Stream from "./stream.gen";
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

/** The payload types are generated from shared/contracts/stream/openapi.yaml; these names point at them. */
export type ChatMessage = Stream.SchemaUserMessage;
export type Cheer = Stream.SchemaChannelCheer;
export type Follow = Stream.SchemaChannelFollow;
export type HypeTrainContribution = Stream.SchemaHypeTrainContribution;
export type HypeTrainBegin = Stream.SchemaChannelHypeTrain;
export type Raid = Stream.SchemaChannelRaid;
export type Redeem = Stream.SchemaChannelPointsRedeem;
export type AdBreakUpcoming = Stream.SchemaChannelAdBreakUpcoming;
export type AdBreakBegin = Stream.SchemaChannelAdBreakBegin;
export type AdBreakEnd = Stream.SchemaChannelAdBreakEnd;
export type StreamOnline = Stream.SchemaStreamOnline;
export type StreamOffline = Stream.SchemaStreamOffline;
export type Subscribe = Stream.SchemaChannelSubscribe;
export type SubscriptionGift = Stream.SchemaChannelSubscriptionGift;
export type Resub = Stream.SchemaChannelResub;
export type GiftPaidUpgrade = Stream.SchemaChannelGiftPaidUpgrade;
export type PrimePaidUpgrade = Stream.SchemaChannelPrimePaidUpgrade;
export type Unraid = Stream.SchemaChannelUnraid;
export type PayItForward = Stream.SchemaChannelPayItForward;
export type Announcement = Stream.SchemaChannelAnnouncement;
export type CharityDonation = Stream.SchemaChannelCharityDonation;
export type BitsBadgeTier = Stream.SchemaChannelBitsBadgeTier;
export type WatchStreak = Stream.SchemaChannelWatchStreak;
export type SharedSubscribe = Stream.SchemaChannelSharedSubscribe;
export type SharedSubscriptionGift = Stream.SchemaChannelSharedSubscriptionGift;
export type SharedRaid = Stream.SchemaChannelSharedRaid;
export type SharedResub = Stream.SchemaChannelResub;
export type SharedGiftPaidUpgrade = Stream.SchemaChannelGiftPaidUpgrade;
export type SharedPrimePaidUpgrade = Stream.SchemaChannelPrimePaidUpgrade;
export type SharedPayItForward = Stream.SchemaChannelPayItForward;
export type SharedAnnouncement = Stream.SchemaChannelAnnouncement;

/** CloudEvent attributes a chat message's event may carry besides its payload. */
export interface ChatMessageAttributes {
  /** Set on an engine line a workflow said; see BaseEvent.workflowChain. */
  workflowChain?: string;
}
