import { describe, expect, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import { RecordingLogger } from "../../../host/testing";
import type { Context } from "../types";
import { publishEvent } from "./publishEvent";
import onChannelChatMessage from "./subscriptions/onChannelChatMessage";
import onChannelCheer from "./subscriptions/onChannelCheer";
import onChannelFollow from "./subscriptions/onChannelFollow";
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
  };
  return { ctx, logger };
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

    await publishEvent(ctx, ["user.follow", new Uint8Array()]);

    expect(logger.at("error")).toEqual([
      expect.objectContaining({ metadata: { subject: "user.follow", err: BUS_DOWN.message } }),
    ]);
  });
});

describe("EventSub callbacks when the bus refuses the publish", () => {
  const chatMessage = {
    chatterId: "u1",
    chatterDisplayName: "Pup",
    messageText: "hi",
    sourceBroadcasterId: null,
    sourceBadges: null,
    hasBadge: () => false,
  };
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
