export enum EventType {
    ChatMessage = 'message.user.twitch',
    Cheer = 'cheer.user.twitch',
    Follow = 'follow.user.twitch',
    HypeTrainBegin = 'hypetrain.channel.twitch',
    StreamOnline = 'online.user.twitch',
    Subscribe = 'subscribe.user.twitch',
    SubscriptionGift = 'subscription.gift.twitch',
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

export interface StreamOnline {}

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
