import { isPlatformId, type PlatformId } from "@woofx3/api/platform-gateway";
import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import { TWITCH_EVENT_SOURCE } from "../adapters/twitch/event-source";
import { type ViewerKey, viewerKey } from "./viewer";

/**
 * The CloudEvent `source` each platform's adapter publishes its chat lines
 * with. Only a line from that source is the platform's word on who said it
 * and what their badges are. Anything else on the bus can publish a chat
 * line too: the api's event simulator does, with source "api".
 */
export const TRUSTED_LINE_SOURCES: Readonly<Record<PlatformId, string>> = {
  twitch: TWITCH_EVENT_SOURCE,
};

/** One chat line as the dispatcher acts on it, after the trust rules ran. */
export interface ChatLine {
  platform: PlatformId;
  viewer: ViewerKey;
  /** The account name permission and group rows are keyed by; see docs/services/connectors.md. */
  chatterLogin: string;
  /** What chat shows for the speaker; for replies only, never for identity. */
  chatterName: string;
  text: string;
  /**
   * The platform's id for the line, which a reply threads under. Set only on
   * a trusted line: an id another publisher made up names no real line.
   */
  messageId: string | undefined;
  /** Unique per line: the platform's id when trusted, the CloudEvent id otherwise. Keys the reply. */
  lineId: string;
  /** Whether the line came from the platform's own adapter; see TRUSTED_LINE_SOURCES. */
  trusted: boolean;
  /**
   * The speaker's membership as the platform reported it. Undefined on an
   * untrusted line: its badges are whatever the publisher wrote, so they are
   * unknown rather than false, and never satisfy a role.
   */
  membership: ChatterMembership | undefined;
  /**
   * Said in a partner channel during a shared chat session. Such a line
   * never carries broadcaster or moderator, and its badges describe the
   * partner channel, so they are not written to the derived groups.
   */
  sharedChat: boolean;
}

/**
 * - line: act on it.
 * - from_engine: a line the engine said itself, which never runs a command.
 * - refused: not a chat line the dispatcher can attribute to anyone.
 */
export type LineReading =
  | { kind: "line"; line: ChatLine }
  | { kind: "from_engine" }
  | { kind: "refused"; problem: string };

/**
 * Reads a `user.message` CloudEvent. A line with no platform, no speaker id
 * or no text is refused rather than guessed at: every per-viewer decision
 * after this keys on the speaker's id. A trusted line with no login is
 * refused too, since its login names the groups it writes and the grants it
 * reads. An untrusted line's identity is the publisher's say-so either way,
 * so its display name stands in for a missing login.
 */
export function readChatLine(envelope: unknown): LineReading {
  if (!isRecord(envelope)) {
    return refused("the event is not an object");
  }
  if (!isPlatformId(envelope.platform)) {
    return refused("the event names no known platform");
  }
  const platform = envelope.platform;
  const data = envelope.data;
  if (!isRecord(data)) {
    return refused("the event has no data object");
  }
  if (data.fromEngine === true) {
    return { kind: "from_engine" };
  }
  const chatterId = nonBlank(data.chatterId);
  if (chatterId === undefined) {
    return refused("the line names no speaker id");
  }
  if (typeof data.message !== "string") {
    return refused("the line has no message text");
  }
  const eventId = nonBlank(envelope.id);
  const platformMessageId = nonBlank(data.messageId);
  const trusted = envelope.source === TRUSTED_LINE_SOURCES[platform];
  const lineId = trusted ? (platformMessageId ?? eventId) : eventId;
  if (lineId === undefined) {
    return refused("the line has no message id and the event has no id");
  }
  const reportedLogin = nonBlank(data.chatterLogin);
  if (trusted && reportedLogin === undefined) {
    return refused("a trusted line names no speaker login");
  }
  const chatterName = nonBlank(data.chatterName) ?? chatterId;
  const sharedChat = nonBlank(data.channelId) !== undefined;
  return {
    kind: "line",
    line: {
      platform,
      viewer: viewerKey(platform, chatterId),
      chatterLogin: (reportedLogin ?? chatterName).toLowerCase(),
      chatterName,
      text: data.message,
      messageId: trusted ? platformMessageId : undefined,
      lineId,
      trusted,
      membership: trusted ? reportedMembership(data.membership, sharedChat) : undefined,
      sharedChat,
    },
  };
}

/**
 * The membership a trusted line carries. Twitch already reports a partner
 * channel's broadcaster and moderators as neither; this holds the rule for
 * any platform, whatever its adapter does.
 */
function reportedMembership(value: unknown, sharedChat: boolean): ChatterMembership | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const flags = [value.isBroadcaster, value.isModerator, value.isSubscriber, value.isVip];
  if (!flags.every((flag) => typeof flag === "boolean")) {
    return undefined;
  }
  const membership: ChatterMembership = {
    isBroadcaster: value.isBroadcaster === true && !sharedChat,
    isModerator: value.isModerator === true && !sharedChat,
    isSubscriber: value.isSubscriber === true,
    isVip: value.isVip === true,
  };
  if (typeof value.isFollower === "boolean") {
    membership.isFollower = value.isFollower;
  }
  if (typeof value.subscriberTier === "string") {
    membership.subscriberTier = value.subscriberTier;
  }
  return membership;
}

function refused(problem: string): LineReading {
  return { kind: "refused", problem };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
