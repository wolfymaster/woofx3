export enum EventType {
    ChatMessage = 'message.user.twitch',
    Cheer = 'cheer.channel.twitch',
    Follow = 'follow.channel.twitch',
    HypeTrainBegin = 'hypetrain.channel.twitch',
    Raid = 'raid.channel.twitch',
    Redeem = 'redeem.channelpoints.twitch',
    StreamOnline = 'online.channel.twitch',
    StreamOffline = 'offline.channel.twitch',
    Subscribe = 'subscribe.channel.twitch',
    SubscriptionGift = 'subscriptionGift.channel.twitch',
    Resub = 'resub.channel.twitch',
    GiftPaidUpgrade = 'giftPaidUpgrade.channel.twitch',
    PrimePaidUpgrade = 'primePaidUpgrade.channel.twitch',
    Unraid = 'unraid.channel.twitch',
    PayItForward = 'payItForward.channel.twitch',
    Announcement = 'announcement.channel.twitch',
    CharityDonation = 'charityDonation.channel.twitch',
    BitsBadgeTier = 'bitsBadgeTier.channel.twitch',
    WatchStreak = 'watchStreak.channel.twitch',
    SharedResub = 'sharedResub.channel.twitch',
    SharedGiftPaidUpgrade = 'sharedGiftPaidUpgrade.channel.twitch',
    SharedPrimePaidUpgrade = 'sharedPrimePaidUpgrade.channel.twitch',
    SharedPayItForward = 'sharedPayItForward.channel.twitch',
    SharedAnnouncement = 'sharedAnnouncement.channel.twitch',
}

export interface ChatMessage {
    amount: number;
    isPaid: boolean;
    channelId: string | null;
    channelName: string | null;
    chatterId: string;
    chatterName: string;
    message: string;
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
    userId: string;
    userName: string;
    message?: string;
}

// Twitch's `stream.online` EventSub payload identifies the broadcaster
// and carries a start timestamp; everything else (title, game, viewer
// count) requires a follow-up Helix lookup. Subscribers that just need
// the on/off transition can ignore the optional fields.
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

export interface SharedResub extends Resub {}

export interface SharedGiftPaidUpgrade extends GiftPaidUpgrade {}

export interface SharedPrimePaidUpgrade extends PrimePaidUpgrade {}

export interface SharedPayItForward extends PayItForward {}

export interface SharedAnnouncement extends Announcement {}
