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
 * This is deliberately platform-neutral. Twitch happens to report most of
 * these as badges stamped on the message; another platform may read them from
 * a roster, enrich them out of band, or not support them at all. Consumers -
 * notably the built-in group sync - depend only on this shape and must never
 * reach for a platform's own representation.
 *
 * The four required flags are the ones every supported platform reports on
 * every message. The optional fields below are tri-state on purpose: see the
 * note on each.
 */
export interface ChatterMembership {
    isBroadcaster: boolean;
    isModerator: boolean;
    isSubscriber: boolean;
    isVip: boolean;

    /**
     * Whether the chatter follows the channel.
     *
     * `undefined` means "this platform does not report following, or the
     * lookup did not resolve in time"; `false` means "it does report, and they
     * do not follow". Collapsing the two would make a `follower` grant on a
     * platform that cannot answer either silently match nobody - a bug that is
     * undiagnosable from chat - or match everybody, which is privilege
     * escalation. Consumers must treat `undefined` as "leave the existing
     * answer alone", never as `false`.
     */
    isFollower?: boolean;

    /**
     * The chatter's subscription tier as a neutral token, e.g. `"tier1"`.
     *
     * Platform-specific tier codes (Twitch's `"1000"`/`"2000"`/`"3000"`) are
     * translated by the platform adapter and stop there. `undefined` means the
     * platform has no tiers, does not report them, or the lookup did not
     * resolve; it is never a claim that the chatter is on some default tier.
     */
    subscriberTier?: string;
}
