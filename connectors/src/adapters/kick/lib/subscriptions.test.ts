import { afterEach, describe, expect, test } from "bun:test";
import type { RandomSource } from "../../../host/deps";
import { FakeTime, halfRandom, RecordingLogger } from "../../../host/testing";
import { type FakeKickServer, kickError, startFakeKick } from "../fake-kick-server";
import { KickApi } from "./kick-api";
import { KICK_SUBSCRIBED_EVENTS, SubscriptionReconciler } from "./subscriptions";

const INTERVAL_MS = 15 * 60_000;
const BACKOFF = { baseMs: 1_000, maxMs: 8_000 };
const ALL = KICK_SUBSCRIBED_EVENTS.map((e) => `${e.name}@${e.version}`).sort();

let kick: FakeKickServer;

afterEach(async () => {
  await kick.stop();
});

function setup(random: RandomSource = halfRandom) {
  kick = startFakeKick();
  const time = new FakeTime();
  const api = new KickApi({
    fetch,
    token: {
      get: async () => ({
        ok: true,
        token: {
          userId: "4242",
          accessToken: "token-1",
          scope: [],
          expiresIn: 1,
          obtainmentTimestamp: 0,
          clientId: "a",
        },
      }),
    },
    clock: time,
    baseUrl: kick.url,
    timeoutMs: 2000,
    tokenTimeoutMs: 2000,
    userAgent: "woofx3-test",
    signal: new AbortController().signal,
  });
  const reconciler = new SubscriptionReconciler({
    api,
    timers: time,
    random,
    logger: new RecordingLogger(),
    config: { intervalMs: INTERVAL_MS, backoff: BACKOFF },
  });
  const subscribed = () => kick.state.subscriptions.map((s) => `${s.event}@${s.version}`).sort();
  const writes = () => kick.requests.filter((r) => r.method !== "GET").length;
  return { time, reconciler, subscribed, writes };
}

/** Lets a timer's pass, which makes real HTTP calls to the fake, finish. */
async function settle(reconciler: SubscriptionReconciler): Promise<void> {
  await reconciler.reconcileNow();
}

describe("SubscriptionReconciler", () => {
  test("with none in place, creates all eight", async () => {
    const { reconciler, subscribed } = setup();
    await reconciler.start();
    expect(subscribed()).toEqual(ALL);
    expect(Object.values(reconciler.detail().events)).toEqual(ALL.map(() => ({ state: "subscribed" })));
    await reconciler.stop();
  });

  test("with all in place, writes nothing", async () => {
    const { reconciler, writes } = setup();
    await reconciler.start();
    const before = writes();
    await reconciler.reconcileNow();
    expect(writes()).toBe(before);
    await reconciler.stop();
  });

  test("recreates on the next interval what Kick unsubscribed", async () => {
    const { time, reconciler, subscribed } = setup();
    await reconciler.start();
    kick.state.subscriptions = kick.state.subscriptions.filter((s) => s.event !== "chat.message.sent");

    await time.advance(INTERVAL_MS);
    await settle(reconciler);

    expect(subscribed()).toEqual(ALL);
    await reconciler.stop();
  });

  test("deletes duplicates of one event and version, keeping the oldest", async () => {
    const { reconciler } = setup();
    kick.state.subscriptions = [
      { id: "new", event: "channel.followed", version: 1, created_at: "2026-11-25T10:00:00Z" },
      { id: "old", event: "channel.followed", version: 1, created_at: "2026-11-01T10:00:00Z" },
    ];
    await reconciler.start();
    expect(kick.state.subscriptions.filter((s) => s.event === "channel.followed").map((s) => s.id)).toEqual(["old"]);
    await reconciler.stop();
  });

  test("an event Kick refuses is failed with its reason, and the rest are subscribed", async () => {
    const { reconciler } = setup();
    kick.state.refusedEvents.set("channel.reward.redemption.updated", "missing scope channel:rewards:read");
    await reconciler.start();
    const { events } = reconciler.detail();
    expect(events["channel.reward.redemption.updated@1"]).toEqual({
      state: "failed",
      reason: "missing scope channel:rewards:read",
    });
    expect(events["channel.followed@1"]).toEqual({ state: "subscribed" });
    await reconciler.stop();
  });

  test("a failing list backs off, doubling to the cap and staying there, then resets after a success", async () => {
    const random: RandomSource = { next: () => 0.999 };
    const { time, reconciler } = setup(random);
    let failing = true;
    kick.route("GET", "/public/v1/events/subscriptions", () =>
      failing ? kickError(500, "down") : Response.json({ data: [] })
    );
    const delays: number[] = [];
    const original = time.setTimeout.bind(time);
    time.setTimeout = (fn, ms) => {
      delays.push(ms);
      return original(fn, ms);
    };

    await reconciler.start();
    for (let i = 0; i < 5; i++) {
      await time.advance(delays.at(-1) ?? 0);
      await settle(reconciler);
    }
    expect(reconciler.detail().lastError).toContain("500");
    failing = false;
    await time.advance(delays.at(-1) ?? 0);
    await settle(reconciler);

    expect(delays.slice(0, 5)).toEqual([999, 1998, 3996, 7992, 7992]);
    expect(delays.at(-1)).toBe(INTERVAL_MS);
    expect(reconciler.detail().lastError).toBeNull();
    await reconciler.stop();
  });

  test("stop cancels the next pass", async () => {
    const { time, reconciler } = setup();
    await reconciler.start();
    await reconciler.stop();
    const before = kick.requests.length;
    await time.advance(INTERVAL_MS * 2);
    expect(kick.requests.length).toBe(before);
  });
});
