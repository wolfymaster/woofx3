import { describe, expect, mock, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubChannelChatMessageEvent } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { ChatMessage } from "@woofx3/common/cloudevents/Twitch/events";
import type { Context } from "src/types";
import { DEFAULT_SELF_SENT_CONFIG, SelfSentRegistry } from "../selfSentChat";
import onChannelChatMessage, { readMembership } from "./onChannelChatMessage";

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

describe("onChannelChatMessage", () => {
  /** Subscribe with a listener that hands back the handler, and record what is published. */
  function subscribed() {
    let handler: ((event: EventSubChannelChatMessageEvent) => Promise<void>) | undefined;
    const listener = {
      onChannelChatMessage: (_b: string, _u: string, h: typeof handler) => {
        handler = h;
        return {};
      },
    } as unknown as EventSubWsListener;
    const published: ChatMessage[] = [];
    const selfSent = new SelfSentRegistry(DEFAULT_SELF_SENT_CONFIG, () => 0);
    const ctx = {
      broadcaster: { id: BROADCASTER } as HelixUser,
      messageBus: { publish: mock(() => {}) },
      events: {
        Twitch: () => ({
          chatMessage: (data: ChatMessage) => {
            published.push(data);
            return ["user.message", new Uint8Array()];
          },
        }),
      },
      selfSent,
    } as unknown as Context;
    onChannelChatMessage(ctx, listener);
    const deliver = (messageId: string, chatterId: string, messageText: string) => {
      const event = {
        ...message(null, []),
        bits: 0,
        chatterId,
        chatterDisplayName: chatterId,
        sourceBroadcasterId: null,
        sourceBroadcasterName: null,
        messageText,
        messageId,
      } as unknown as EventSubChannelChatMessageEvent;
      if (!handler) {
        throw new Error("not subscribed");
      }
      return handler(event);
    };
    return { deliver, published, selfSent };
  }

  test("publishes Twitch's message id and marks a chatter's line as not the engine's", async () => {
    const { deliver, published } = subscribed();

    await deliver("m-7", "chatter-9", "hello");

    expect(published[0]).toMatchObject({ messageId: "m-7", fromEngine: false, message: "hello" });
  });

  test("marks the echo of a line the engine said as the engine's, once", async () => {
    const { deliver, published, selfSent } = subscribed();
    selfSent.begin("\u200b!so friend").sent("m-1");

    await deliver("m-1", BROADCASTER, "\u200b!so friend");
    await deliver("m-2", BROADCASTER, "\u200b!so friend");

    expect(published.map((p) => p.fromEngine)).toEqual([true, false]);
  });
});
