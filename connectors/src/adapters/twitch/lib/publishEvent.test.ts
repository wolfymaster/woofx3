import { describe, expect, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import { FakeTime, RecordingLogger } from "../../../host/testing";
import type { Context } from "../types";
import { publishEvent } from "./publishEvent";
import { SelfSentRegistry } from "./self-sent";
import onChannelChatMessage from "./subscriptions/onChannelChatMessage";
import onChannelChatNotification from "./subscriptions/onChannelChatNotification";
import onChannelCheer from "./subscriptions/onChannelCheer";
import onChannelFollow from "./subscriptions/onChannelFollow";
import onChannelHypeTrainBegin from "./subscriptions/onChannelHypeTrainBegin";
import onChannelRaid from "./subscriptions/onChannelRaid";
import onChannelRedemptionAdd from "./subscriptions/onChannelRedemptionAdd";
import onStreamOffline from "./subscriptions/onStreamOffline";
import onStreamOnline from "./subscriptions/onStreamOnline";

const BUS_DOWN = new Error("the bus scope is closed");

/** A context whose bus refuses every publish, as a closed adapter scope does. */
function refusingContext(): { ctx: Context; logger: RecordingLogger } {
  const logger = new RecordingLogger();
  const ctx: Context = {
    broadcaster: { id: "broadcaster-1" } as HelixUser,
    logger,
    messageBus: { publish: async () => Promise.reject(BUS_DOWN) },
    events: new EventFactory({ source: "twitch" }),
    selfSent: new SelfSentRegistry({ capacity: 1, ttlMs: 1 }, new FakeTime()),
    clock: new FakeTime(),
    timers: new FakeTime(),
  };
  return { ctx, logger };
}

const BUILD_REFUSED = new Error("the payload is not a plain object");

/**
 * A context whose event factory refuses to build anything, as it does for a
 * payload that fails its plain-object guard. Records every publish and every
 * live-state change it is told about.
 */
function buildRefusingContext(): { ctx: Context; logger: RecordingLogger; published: string[]; live: boolean[] } {
  const logger = new RecordingLogger();
  const published: string[] = [];
  const live: boolean[] = [];
  const ctx: Context = {
    broadcaster: { id: "broadcaster-1" } as HelixUser,
    logger,
    messageBus: {
      publish: async (subject) => {
        published.push(subject);
      },
    },
    events: {
      Twitch: () => {
        throw BUILD_REFUSED;
      },
    } as unknown as EventFactory,
    selfSent: new SelfSentRegistry({ capacity: 1, ttlMs: 1 }, new FakeTime()),
    clock: new FakeTime(),
    timers: new FakeTime(),
    onStreamLiveChange: (isLive) => {
      live.push(isLive);
    },
  };
  return { ctx, logger, published, live };
}

type Callback = (event: unknown) => Promise<void>;

/** An EventSub listener that keeps the one callback a subscription factory registers. */
function capturingListener(): { listener: EventSubWsListener; deliver: Callback } {
  let callback: Callback | undefined;
  const listener = new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        return (...args: unknown[]) => {
          callback = args.find((arg) => typeof arg === "function") as Callback | undefined;
          return { id: prop } as unknown as EventSubSubscription;
        };
      },
    }
  ) as EventSubWsListener;
  return {
    listener,
    deliver: (event) => {
      if (callback === undefined) {
        throw new Error("the subscription registered no callback");
      }
      return callback(event);
    },
  };
}

describe("publishEvent", () => {
  test("logs a refused publish with its subject instead of rejecting", async () => {
    const { ctx, logger } = refusingContext();

    await publishEvent(ctx, () => ["user.follow", new Uint8Array()]);

    expect(logger.at("error")).toEqual([
      expect.objectContaining({ metadata: { subject: "user.follow", err: BUS_DOWN.message } }),
    ]);
  });

  test("logs an event that fails to build instead of rejecting, and publishes nothing", async () => {
    const { ctx, logger, published } = buildRefusingContext();

    await publishEvent(ctx, () => {
      throw BUILD_REFUSED;
    });

    expect(published).toEqual([]);
    expect(logger.at("error")).toEqual([expect.objectContaining({ metadata: { err: BUILD_REFUSED.message } })]);
  });
});

const chatMessage = {
  messageId: "msg-1",
  chatterId: "u1",
  chatterName: "pup",
  chatterDisplayName: "Pup",
  messageText: "hi",
  sourceBroadcasterId: null,
  sourceBadges: null,
  hasBadge: () => false,
};

describe("EventSub callbacks when the bus refuses the publish", () => {
  const cases: Array<[name: string, factory: (ctx: Context, l: EventSubWsListener) => unknown, event: unknown]> = [
    ["chat message", onChannelChatMessage, chatMessage],
    ["cheer", onChannelCheer, { bits: 5, isAnonymous: false, userDisplayName: "Pup", userId: "u1", message: "" }],
    ["follow", onChannelFollow, { userDisplayName: "Pup", userId: "u1" }],
    ["raid", onChannelRaid, { raidingBroadcasterId: "b2", raidingBroadcasterDisplayName: "Howl", viewers: 3 }],
    ["redemption", onChannelRedemptionAdd, { id: "r1", userId: "u1", userDisplayName: "Pup", rewardId: "w1" }],
    ["stream online", onStreamOnline, { broadcasterId: "broadcaster-1", broadcasterName: "Wolfy" }],
    ["stream offline", onStreamOffline, { broadcasterId: "broadcaster-1", broadcasterName: "Wolfy" }],
  ];
  for (const [name, factory, event] of cases) {
    test(`${name}: resolves and logs the failure`, async () => {
      const { ctx, logger } = refusingContext();
      const { listener, deliver } = capturingListener();
      factory(ctx, listener);

      await deliver(event);

      expect(logger.at("error")).toHaveLength(1);
      expect(logger.at("error")[0]?.metadata?.err).toBe(BUS_DOWN.message);
    });
  }
});

describe("EventSub callbacks when the event fails to build", () => {
  const cases: Array<[name: string, factory: (ctx: Context, l: EventSubWsListener) => unknown, event: unknown]> = [
    ["chat message", onChannelChatMessage, chatMessage],
    ["chat notification", onChannelChatNotification, { type: "sub", chatterId: "u1", tier: "1000" }],
    ["cheer", onChannelCheer, { bits: 5, isAnonymous: false, userDisplayName: "Pup", userId: "u1", message: "" }],
    ["follow", onChannelFollow, { userDisplayName: "Pup", userId: "u1" }],
    ["hype train begin", onChannelHypeTrainBegin, { id: "h1" }],
    ["raid", onChannelRaid, { raidingBroadcasterId: "b2", raidingBroadcasterDisplayName: "Howl", viewers: 3 }],
    ["redemption", onChannelRedemptionAdd, { id: "r1", userId: "u1", userDisplayName: "Pup", rewardId: "w1" }],
    ["stream online", onStreamOnline, { broadcasterId: "broadcaster-1", broadcasterName: "Wolfy" }],
    ["stream offline", onStreamOffline, { broadcasterId: "broadcaster-1", broadcasterName: "Wolfy" }],
  ];
  for (const [name, factory, event] of cases) {
    test(`${name}: resolves, logs the failure and publishes nothing`, async () => {
      const { ctx, logger, published } = buildRefusingContext();
      const { listener, deliver } = capturingListener();
      factory(ctx, listener);

      await deliver(event);

      expect(published).toEqual([]);
      expect(logger.at("error")).toHaveLength(1);
    });
  }

  const liveChanges: Array<[name: string, factory: (ctx: Context, l: EventSubWsListener) => unknown, live: boolean]> = [
    ["stream online", onStreamOnline, true],
    ["stream offline", onStreamOffline, false],
  ];
  for (const [name, factory, live] of liveChanges) {
    test(`${name}: still reports the live change`, async () => {
      const { ctx, live: reported } = buildRefusingContext();
      const { listener, deliver } = capturingListener();
      factory(ctx, listener);

      await deliver({ broadcasterId: "broadcaster-1", broadcasterName: "Wolfy" });

      expect(reported).toEqual([live]);
    });
  }
});
