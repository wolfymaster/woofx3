export enum EventType {
    SendMessage = 'message.send',
}

export interface SendMessage {
    platform: string;
    message: string;
}

/**
 * Platform membership for the author of a chat message, as reported by
 * whichever platform delivered it.
 *
 * This is deliberately platform-neutral. Twitch happens to report these as
 * badges stamped on the message; another platform may read them from a
 * roster, enrich them out of band, or not support them at all. Consumers -
 * notably the built-in group sync - depend only on this shape and must never
 * reach for a platform's own representation.
 */
export interface ChatterMembership {
    isBroadcaster: boolean;
    isModerator: boolean;
    isSubscriber: boolean;
    isVip: boolean;
}
