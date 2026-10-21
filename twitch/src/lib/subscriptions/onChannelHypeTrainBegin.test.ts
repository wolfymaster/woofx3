import { describe, expect, mock, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import { EventSubChannelHypeTrainBeginV2Event } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import type { Context } from "src/types";
import onChannelHypeTrainBegin from "./onChannelHypeTrainBegin";

const CLIENT_SECRET = "hype-train-client-secret";

type HypeTrainHandler = (event: EventSubChannelHypeTrainBeginV2Event) => Promise<void>;

/** Twurple's declarations hide the (data, client) constructor its listener uses. */
const HypeTrainBeginV2Event = EventSubChannelHypeTrainBeginV2Event as unknown as new (
  data: unknown,
  client: unknown
) => EventSubChannelHypeTrainBeginV2Event;

function twurpleEvent(): EventSubChannelHypeTrainBeginV2Event {
  const client = { _config: { authProvider: { _clientId: "client-id", _clientSecret: CLIENT_SECRET } } };
  return new HypeTrainBeginV2Event(
    {
      id: "train-1",
      broadcaster_user_id: "broadcaster-1",
      broadcaster_user_login: "wolfy",
      broadcaster_user_name: "Wolfy",
      type: "regular",
      level: 2,
      total: 1700,
      progress: 200,
      goal: 1800,
      top_contributions: [
        { user_id: "user-1", user_login: "pup", user_name: "Pup", type: "bits", total: 1000 },
        { user_id: "user-2", user_login: "howl", user_name: "Howl", type: "subscription", total: 500 },
      ],
      is_shared_train: false,
      shared_train_participants: [],
      all_time_high_level: 4,
      all_time_high_total: 9000,
      started_at: "2026-10-21T18:00:00.000Z",
      expires_at: "2026-10-21T18:05:00.000Z",
    },
    client
  );
}

function harness() {
  const published: { topic: string; raw: string }[] = [];
  const ctx = {
    broadcaster: { id: "broadcaster-1" } as HelixUser,
    logger: { warn: mock(() => {}) } as unknown as Context["logger"],
    messageBus: {
      publish: mock((topic: string, bytes: Uint8Array) => {
        published.push({ topic, raw: new TextDecoder().decode(bytes) });
      }),
    } as unknown as Context["messageBus"],
    events: new EventFactory({ source: "twitch" }),
  } as Context;

  let handler: HypeTrainHandler | undefined;
  const listener = {
    onChannelHypeTrainBeginV2: mock((_broadcasterId: string, fn: HypeTrainHandler) => {
      handler = fn;
      return {};
    }),
  } as unknown as EventSubWsListener;
  onChannelHypeTrainBegin(ctx, listener);

  return {
    published,
    deliver: (event: EventSubChannelHypeTrainBeginV2Event) => {
      if (handler === undefined) {
        throw new Error("onChannelHypeTrainBegin did not subscribe");
      }
      return handler(event);
    },
  };
}

describe("onChannelHypeTrainBegin", () => {
  test("publishes the hype train's fields and none of the Twurple client", async () => {
    const { published, deliver } = harness();

    await deliver(twurpleEvent());

    expect(published).toHaveLength(1);
    const { topic, raw } = published[0];
    expect(topic).toBe("channel.hypetrain");
    expect(raw).not.toContain("_client");
    expect(raw).not.toContain(CLIENT_SECRET);
    expect(raw).toContain('"level":2');
    expect(JSON.parse(raw).data).toEqual({
      id: "train-1",
      broadcasterId: "broadcaster-1",
      broadcasterName: "Wolfy",
      level: 2,
      total: 1700,
      progress: 200,
      goal: 1800,
      topContributions: [
        { userId: "user-1", userName: "Pup", type: "bits", total: 1000 },
        { userId: "user-2", userName: "Howl", type: "subscription", total: 500 },
      ],
      startedAt: "2026-10-21T18:00:00.000Z",
      expiresAt: "2026-10-21T18:05:00.000Z",
    });
  });
});
