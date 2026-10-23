import { describe, expect, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubChannelChatMessageEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import { FakeTime, RecordingLogger } from "../../../../host/testing";
import type { Context } from "../../types";
import { SelfSentRegistry } from "../self-sent";
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

type ChatCallback = (event: EventSubChannelChatMessageEvent) => Promise<void>;

/** The chat subscription wired to a recording bus, with the engine's own lines in `selfSent`. */
function subscribed() {
  const published: Array<{ subject: string; event: Record<string, unknown> }> = [];
  const selfSent = new SelfSentRegistry({ capacity: 8, ttlMs: 30_000 }, new FakeTime());
  const ctx: Context = {
    broadcaster: { id: BROADCASTER } as HelixUser,
    logger: new RecordingLogger(),
    messageBus: {
      publish: async (subject, data) => {
        published.push({ subject, event: JSON.parse(new TextDecoder().decode(data)) });
      },
    },
    events: new EventFactory({ source: "twitch" }),
    selfSent,
  };
  let deliver: ChatCallback | undefined;
  const listener = {
    onChannelChatMessage: (_broadcaster: string, _user: string, callback: ChatCallback) => {
      deliver = callback;
      return {} as EventSubSubscription;
    },
  } as unknown as EventSubWsListener;
  onChannelChatMessage(ctx, listener);
  return {
    selfSent,
    published,
    say: async (chatterId: string, messageId: string, text: string) => {
      if (deliver === undefined) {
        throw new Error("the subscription registered no callback");
      }
      await deliver(chat(chatterId, messageId, text));
    },
  };
}

function chat(chatterId: string, messageId: string, messageText: string): EventSubChannelChatMessageEvent {
  return {
    ...message(null, []),
    bits: 0,
    chatterId,
    chatterName: `login-${chatterId}`,
    chatterDisplayName: `Name-${chatterId}`,
    messageId,
    messageText,
    sourceBroadcasterId: null,
    sourceBroadcasterName: null,
  } as unknown as EventSubChannelChatMessageEvent;
}

describe("onChannelChatMessage", () => {
  test("publishes a viewer's line with its id and login, not from the engine", async () => {
    const { say, published } = subscribed();

    await say("viewer-1", "msg-1", "hello");

    expect(published).toHaveLength(1);
    expect(published[0]?.subject).toBe("user.message");
    expect(published[0]?.event).not.toHaveProperty("workflowChain");
    expect(published[0]?.event.data).toMatchObject({
      messageId: "msg-1",
      chatterId: "viewer-1",
      chatterName: "Name-viewer-1",
      chatterLogin: "login-viewer-1",
      message: "hello",
      fromEngine: false,
    });
  });

  test("marks the engine's own line and stamps the chain of the workflow that said it", async () => {
    const { say, published, selfSent } = subscribed();
    selfSent.begin("\u200b!so pup", "wf-a,wf-b").sent("msg-7");

    await say(BROADCASTER, "msg-7", "\u200b!so pup");

    expect(published[0]?.event.workflowChain).toBe("wf-a,wf-b");
    expect(published[0]?.event.data).toMatchObject({ messageId: "msg-7", fromEngine: true });
  });

  test("marks an engine line said outside a workflow without a chain", async () => {
    const { say, published, selfSent } = subscribed();
    selfSent.begin("hello from the dashboard");

    await say(BROADCASTER, "msg-8", "hello from the dashboard");

    expect(published[0]?.event).not.toHaveProperty("workflowChain");
    expect(published[0]?.event.data).toMatchObject({ fromEngine: true });
  });

  // The streamer typing the engine's words is the streamer, as is a viewer echoing them.
  test("reads the same words again, or from a viewer, as typed", async () => {
    const { say, published, selfSent } = subscribed();
    selfSent.begin("gg");

    await say("viewer-1", "msg-1", "gg");
    await say(BROADCASTER, "msg-2", "gg");
    await say(BROADCASTER, "msg-3", "gg");

    expect(published.map((entry) => (entry.event.data as { fromEngine: boolean }).fromEngine)).toEqual([
      false,
      true,
      false,
    ]);
  });
});
