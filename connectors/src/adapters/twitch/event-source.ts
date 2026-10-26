/**
 * The CloudEvent `source` of every event the Twitch adapter publishes. The
 * chat dispatcher trusts a chat line's badges only when it carries this
 * source, so a line another publisher made up cannot claim them.
 */
export const TWITCH_EVENT_SOURCE = "twitch";
