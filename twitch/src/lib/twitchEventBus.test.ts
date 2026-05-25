import type { HelixUser } from "@twurple/api";
import type { EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "src/types";
import TwitchEventBus from "./twitchEventBus";

function subscriptionStub(): EventSubSubscription {
  return {
    start: mock(() => {}),
    stop: mock(() => {}),
  } as unknown as EventSubSubscription;
}

function createMockListener() {
  return {
    start: mock(() => {}),
    stop: mock(() => {}),
    onChannelBan: mock(() => subscriptionStub()),
    onChannelChatMessage: mock(() => subscriptionStub()),
    onChannelCheer: mock(() => subscriptionStub()),
    onChannelFollow: mock(() => subscriptionStub()),
    onChannelHypeTrainBegin: mock(() => subscriptionStub()),
    onChannelRaidTo: mock(() => subscriptionStub()),
    onChannelRedemptionAdd: mock(() => subscriptionStub()),
    onChannelSubscription: mock(() => subscriptionStub()),
    onChannelSubscriptionGift: mock(() => subscriptionStub()),
    onStreamOnline: mock(() => subscriptionStub()),
    onStreamOffline: mock(() => subscriptionStub()),
  };
}

function minimalContext(): Context {
  const broadcaster = { id: "broadcaster-1" } as HelixUser;
  return {
    broadcaster,
    logger: {
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      debug: mock(() => {}),
      child: mock(() => ({ info: mock(() => {}) })),
    },
    messageBus: { publish: mock(() => {}) } as Context["messageBus"],
    events: {} as Context["events"],
  };
}

describe("TwitchEventBus", () => {
  let ctx: Context;
  let listener: ReturnType<typeof createMockListener>;

  beforeEach(() => {
    ctx = minimalContext();
    listener = createMockListener();
  });

  test("start begins the listener and registers every handler", () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);

    bus.start();

    expect(listener.start).toHaveBeenCalledTimes(1);
    expect(listener.onChannelFollow).toHaveBeenCalledTimes(1);
    expect(listener.onStreamOffline).toHaveBeenCalledTimes(1);
  });

  test("disconnect stops the listener and tears down any registered EventSub subscriptions", () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    bus.start();

    const firstSubs = [
      listener.onChannelBan.mock.results[0]?.value,
      listener.onStreamOnline.mock.results[0]?.value,
    ].filter(Boolean) as Array<{ stop: ReturnType<typeof mock> }>;

    bus.disconnect();

    expect(listener.stop).toHaveBeenCalledTimes(1);
    for (const sub of firstSubs) {
      expect(sub.stop).toHaveBeenCalled();
    }
  });

  test("start replaces a previous subscription batch when called again", () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);

    bus.start();

    expect(listener.onChannelBan).toHaveBeenCalledTimes(1);

    const firstBanSub = listener.onChannelBan.mock.results[0]?.value as { stop: ReturnType<typeof mock> };

    bus.start();

    expect(firstBanSub.stop).toHaveBeenCalled();
    expect(listener.onChannelBan).toHaveBeenCalledTimes(2);
  });

  test("resumeSubscriptions and stopSubscriptions forward lifecycle calls to each active subscription", () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    bus.start();

    const stubs = listener.onStreamOnline.mock.results.map(
      (r) => r.value as { start: ReturnType<typeof mock>; stop: ReturnType<typeof mock> }
    );

    bus.resumeSubscriptions();
    for (const s of stubs) {
      expect(s.start).toHaveBeenCalledTimes(1);
    }

    bus.stopSubscriptions();
    for (const s of stubs) {
      expect(s.stop).toHaveBeenCalled();
    }
  });
});
