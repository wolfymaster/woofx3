import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubChannelChatNotificationEvent } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import type { Context } from "src/types";
import onChannelChatNotification from "./onChannelChatNotification";

type Handler = (event: EventSubChannelChatNotificationEvent) => Promise<void>;

const BROADCASTER = "broadcaster-1";
const PARTNER = "partner-7";

/** The fields every notice carries, as Twurple exposes them. */
function notice(type: string, sourceBroadcasterId: string | null, fields: Record<string, unknown>) {
  return {
    type,
    broadcasterId: BROADCASTER,
    broadcasterDisplayName: "Streamer",
    chatterId: "chatter-1",
    chatterDisplayName: "Viewer",
    chatterIsAnonymous: false,
    messageId: "message-1",
    messageText: "",
    sourceBroadcasterId,
    sourceBroadcasterDisplayName: sourceBroadcasterId ? "Partner" : null,
    ...fields,
  } as unknown as EventSubChannelChatNotificationEvent;
}

describe("onChannelChatNotification", () => {
  let publish: ReturnType<typeof mock>;
  let handler: Handler;

  beforeEach(() => {
    publish = mock(() => {});
    const ctx = {
      broadcaster: { id: BROADCASTER } as HelixUser,
      logger: { warn: mock(() => {}) } as unknown as Context["logger"],
      messageBus: { publish } as unknown as Context["messageBus"],
      events: new EventFactory({ source: "test" }),
    } as Context;
    const listener = {
      onChannelChatNotification: mock((_broadcaster: string, _user: string, h: Handler) => {
        handler = h;
        return {};
      }),
    };
    onChannelChatNotification(ctx, listener as unknown as EventSubWsListener);
  });

  const publishedTopics = () => publish.mock.calls.map((call) => call[0]);

  test("a sub in this channel is published as this channel's subscribe", async () => {
    await handler(notice("sub", null, { tier: "1000" }));
    expect(publishedTopics()).toEqual([EventType.Subscribe]);
  });

  test("a partner's subs, gifts and raids during shared chat are published as shared events", async () => {
    await handler(notice("shared_chat_sub", PARTNER, { tier: "1000" }));
    await handler(
      notice("shared_chat_sub_gift", PARTNER, { tier: "1000", recipientId: "r-1", recipientDisplayName: "R" })
    );
    await handler(notice("shared_chat_community_sub_gift", PARTNER, { tier: "1000", amount: 5 }));
    await handler(
      notice("shared_chat_raid", PARTNER, { raiderId: "raider-1", raiderDisplayName: "Raider", viewerCount: 20 })
    );

    expect(publishedTopics()).toEqual([
      EventType.SharedSubscribe,
      EventType.SharedSubscribe,
      EventType.SharedSubscriptionGift,
      EventType.SharedRaid,
    ]);
    const payload = JSON.parse(new TextDecoder().decode(publish.mock.calls[3][1] as Uint8Array));
    expect(payload.data).toMatchObject({
      sourceBroadcasterId: PARTNER,
      fromBroadcasterUserId: "raider-1",
      viewers: 20,
    });
  });

  test("a raid notice in this channel publishes nothing, since channel.raid already announces it", async () => {
    await handler(notice("raid", null, { raiderId: "raider-1", raiderDisplayName: "Raider", viewerCount: 20 }));
    expect(publishedTopics()).toEqual([]);
  });
});
