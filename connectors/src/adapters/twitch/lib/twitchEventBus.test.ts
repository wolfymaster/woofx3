import type { HelixUser } from "@twurple/api";
import type { EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "src/types";
import TwitchEventBus from "./twitchEventBus";

let stubCounter = 0;

function subscriptionStub(): EventSubSubscription {
  stubCounter += 1;
  return {
    id: `sub-${stubCounter}`,
    start: mock(() => {}),
    stop: mock(() => {}),
  } as unknown as EventSubSubscription;
}

/**
 * Stands in for Twurple's subscription-outcome emitters: tests drive
 * `emitSuccess`/`emitFailure` to simulate Twitch confirming or refusing
 * a subscription.
 */
function createMockListener() {
  const successHandlers: ((sub: EventSubSubscription) => void)[] = [];
  const failureHandlers: ((sub: EventSubSubscription, err: Error) => void)[] = [];
  return {
    start: mock(() => {}),
    stop: mock(() => {}),
    onSubscriptionCreateSuccess: mock((h: (sub: EventSubSubscription) => void) => {
      successHandlers.push(h);
      return { unbind: mock(() => {}) };
    }),
    onSubscriptionCreateFailure: mock((h: (sub: EventSubSubscription, err: Error) => void) => {
      failureHandlers.push(h);
      return { unbind: mock(() => {}) };
    }),
    emitSuccess: (sub: EventSubSubscription) => successHandlers.forEach((h) => h(sub)),
    emitFailure: (sub: EventSubSubscription, err: Error) => failureHandlers.forEach((h) => h(sub, err)),
    onChannelAdBreakBegin: mock(() => subscriptionStub()),
    onChannelBan: mock(() => subscriptionStub()),
    onChannelChatMessage: mock(() => subscriptionStub()),
    onChannelChatNotification: mock(() => subscriptionStub()),
    onChannelCheer: mock(() => subscriptionStub()),
    onChannelFollow: mock(() => subscriptionStub()),
    onChannelHypeTrainBeginV2: mock(() => subscriptionStub()),
    onChannelRaidTo: mock(() => subscriptionStub()),
    onChannelRedemptionAdd: mock(() => subscriptionStub()),
    onStreamOnline: mock(() => subscriptionStub()),
    onStreamOffline: mock(() => subscriptionStub()),
  };
}

/** Every required subscription stub the listener returned, in registration order. */
function allStubs(listener: ReturnType<typeof createMockListener>): EventSubSubscription[] {
  const mocks = [
    listener.onChannelBan,
    listener.onChannelChatMessage,
    listener.onChannelChatNotification,
    listener.onChannelCheer,
    listener.onChannelFollow,
    listener.onChannelHypeTrainBeginV2,
    listener.onChannelRaidTo,
    listener.onChannelRedemptionAdd,
    listener.onStreamOnline,
    listener.onStreamOffline,
  ];
  return mocks.flatMap((m) => m.mock.results.map((r) => r.value as EventSubSubscription));
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
    } as unknown as Context["logger"],
    messageBus: { publish: mock(() => {}) } as unknown as Context["messageBus"],
    events: {} as Context["events"],
  };
}

// Short settle window: these tests assert wiring, not readiness, so they
// let start() time out immediately rather than emitting outcomes.
const SETTLE_MS = 5;

describe("TwitchEventBus", () => {
  let ctx: Context;
  let listener: ReturnType<typeof createMockListener>;

  beforeEach(() => {
    ctx = minimalContext();
    listener = createMockListener();
  });

  test("start begins the listener and registers every handler", async () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);

    await bus.start(SETTLE_MS);

    expect(listener.start).toHaveBeenCalledTimes(1);
    expect(listener.onChannelFollow).toHaveBeenCalledTimes(1);
    expect(listener.onStreamOffline).toHaveBeenCalledTimes(1);
  });

  test("disconnect stops the listener and tears down any registered EventSub subscriptions", async () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    await bus.start(SETTLE_MS);

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

  test("start replaces a previous subscription batch when called again", async () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);

    await bus.start(SETTLE_MS);

    expect(listener.onChannelBan).toHaveBeenCalledTimes(1);

    const firstBanSub = listener.onChannelBan.mock.results[0]?.value as { stop: ReturnType<typeof mock> };

    await bus.start(SETTLE_MS);

    expect(firstBanSub.stop).toHaveBeenCalled();
    expect(listener.onChannelBan).toHaveBeenCalledTimes(2);
  });

  test("resumeSubscriptions and stopSubscriptions forward lifecycle calls to each active subscription", async () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    await bus.start(SETTLE_MS);

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

  test("is not ready when Twitch refuses a subscription", async () => {
    // The 429 "number of websocket transports limit exceeded" case: the
    // socket is up, so nothing looks broken, but a refused subscription
    // delivers no events at all. Health has to reflect that.
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    const started = bus.start(50);
    const subs = allStubs(listener);
    for (const sub of subs.slice(0, TwitchEventBus.expectedSubscriptionCount - 1)) {
      listener.emitSuccess(sub);
    }
    listener.emitFailure(
      subs[TwitchEventBus.expectedSubscriptionCount - 1]!,
      new Error("Encountered HTTP status code 429: Too Many Requests")
    );
    await started;

    expect(bus.isReady()).toBe(false);
    expect(bus.failedSubscriptions()).toHaveLength(1);
    expect(bus.failedSubscriptions()[0]?.reason).toContain("429");
  });

  test("is ready only once every expected subscription is confirmed", async () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    const started = bus.start(50);
    const subs = allStubs(listener);
    for (const sub of subs.slice(0, TwitchEventBus.expectedSubscriptionCount)) {
      listener.emitSuccess(sub);
    }
    await started;

    expect(bus.establishedCount()).toBe(TwitchEventBus.expectedSubscriptionCount);
    expect(bus.isReady()).toBe(true);
    expect(bus.failedSubscriptions()).toEqual([]);
  });

  test("is not ready when confirmations never arrive before the timeout", async () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    await bus.start(5);

    expect(bus.isReady()).toBe(false);
    expect(bus.establishedCount()).toBe(0);
  });

  test("recovers to ready when a refused subscription later succeeds on retry", async () => {
    // Twurple keeps retrying refused subscriptions, so a bus that boots
    // unhealthy must be able to heal without a restart.
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    const started = bus.start(50);
    const subs = allStubs(listener);
    const expected = TwitchEventBus.expectedSubscriptionCount;
    for (const sub of subs.slice(0, expected - 1)) {
      listener.emitSuccess(sub);
    }
    const flaky = subs[expected - 1]!;
    listener.emitFailure(flaky, new Error("429"));
    await started;
    expect(bus.isReady()).toBe(false);

    listener.emitSuccess(flaky);
    expect(bus.isReady()).toBe(true);
  });

  test("the optional ad-break subscription is attempted but left out of readiness", async () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    const started = bus.start(50);
    const [adBreak] = listener.onChannelAdBreakBegin.mock.results.map((r) => r.value as EventSubSubscription);
    expect(adBreak).toBeDefined();
    for (const sub of allStubs(listener)) {
      listener.emitSuccess(sub);
    }
    const missingScope = new Error(
      "This token does not have any of the requested scopes (channel:read:ads) and can not be upgraded."
    );
    listener.emitFailure(adBreak!, missingScope);
    listener.emitFailure(adBreak!, missingScope);
    await started;

    expect(bus.isReady()).toBe(true);
    expect(bus.establishedCount()).toBe(TwitchEventBus.expectedSubscriptionCount);
    expect(bus.failedSubscriptions()).toEqual([]);
    const warn = ctx.logger.warn as ReturnType<typeof mock>;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("channel:read:ads");
  });

  test("a confirmed optional subscription does not count toward the required total", async () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    const started = bus.start(50);
    const [adBreak] = listener.onChannelAdBreakBegin.mock.results.map((r) => r.value as EventSubSubscription);
    listener.emitSuccess(adBreak!);
    const required = allStubs(listener);
    for (const sub of required.slice(0, required.length - 1)) {
      listener.emitSuccess(sub);
    }
    await started;

    expect(bus.isReady()).toBe(false);
    expect(bus.establishedCount()).toBe(TwitchEventBus.expectedSubscriptionCount - 1);
  });

  test("resubscribe requests every subscription again, retrying a refused optional one", async () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    const started = bus.start(50);
    for (const sub of allStubs(listener)) {
      listener.emitSuccess(sub);
    }
    const [firstAdBreak] = listener.onChannelAdBreakBegin.mock.results.map((r) => r.value as EventSubSubscription);
    listener.emitFailure(firstAdBreak!, new Error("does not have any of the requested scopes"));
    await started;
    const requiredBefore = allStubs(listener);

    const resubscribed = bus.resubscribe(50);
    expect(listener.onChannelAdBreakBegin).toHaveBeenCalledTimes(2);
    expect(listener.start).toHaveBeenCalledTimes(1);
    for (const sub of requiredBefore) {
      expect(sub.stop).toHaveBeenCalled();
    }
    for (const sub of allStubs(listener).slice(requiredBefore.length)) {
      listener.emitSuccess(sub);
    }
    await resubscribed;

    expect(bus.isReady()).toBe(true);
  });

  test("disconnect unbinds the outcome handlers and clears readiness", async () => {
    const bus = new TwitchEventBus(ctx, listener as unknown as EventSubWsListener);
    const started = bus.start(50);
    const subs = allStubs(listener);
    for (const sub of subs.slice(0, TwitchEventBus.expectedSubscriptionCount)) {
      listener.emitSuccess(sub);
    }
    await started;
    expect(bus.isReady()).toBe(true);

    bus.disconnect();

    expect(bus.isReady()).toBe(false);
    expect(bus.establishedCount()).toBe(0);
  });
});
