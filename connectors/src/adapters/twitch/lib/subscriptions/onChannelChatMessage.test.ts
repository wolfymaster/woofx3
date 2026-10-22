import { describe, expect, test } from "bun:test";
import type { EventSubChannelChatMessageEvent } from "@twurple/eventsub-base";
import { readMembership } from "./onChannelChatMessage";

const BROADCASTER = "broadcaster-1";
const PARTNER = "partner-7";

/** A chat message carrying `badges`, and `sourceBadges` when it came through shared chat. */
function message(sourceBroadcasterId: string | null, badges: string[]) {
  const sourceBadges = sourceBroadcasterId ? badges : null;
  return {
    sourceBroadcasterId,
    sourceBadges,
    hasBadge: (name: string) => sourceBadges === null && badges.includes(name),
    hasSourceBadge: (name: string) => (sourceBadges === null ? null : sourceBadges.includes(name)),
  } as unknown as EventSubChannelChatMessageEvent;
}

describe("readMembership", () => {
  test("reads broadcaster and moderator for a message sent in this channel", () => {
    expect(readMembership(message(null, ["broadcaster"]), BROADCASTER).isBroadcaster).toBe(true);
    expect(readMembership(message(null, ["moderator"]), BROADCASTER).isModerator).toBe(true);
    expect(readMembership(message(BROADCASTER, ["moderator"]), BROADCASTER).isModerator).toBe(true);
  });

  // A partner's broadcaster or mods in shared chat must not be trusted as this channel's.
  test("never grants broadcaster or moderator to a message from a shared-chat partner", () => {
    const membership = readMembership(message(PARTNER, ["broadcaster", "moderator", "vip"]), BROADCASTER);
    expect(membership.isBroadcaster).toBe(false);
    expect(membership.isModerator).toBe(false);
    expect(membership.isVip).toBe(true);
  });
});
