import { describe, expect, mock, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubSubscription } from "@twurple/eventsub-base";
import { TWITCH_DEFAULTS, type TwitchConfig } from "../../config/twitch";
import { systemTimers } from "../../host/deps";
import { countingIds, FakeTime, halfRandom, RecordingLogger } from "../../host/testing";
import type { TwitchAppContext } from "./application";
import { HELIX_DEADLINE_MS } from "./lib/helix";
import { SelfSentRegistry } from "./lib/self-sent";

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
 * Mirrors Twitch confirming each subscription as it is created, so
 * `TwitchEventBus.start()` settles immediately instead of waiting out its
 * full timeout. `TwitchEventBus` binds the outcome handlers before it
 * registers anything, so emitting synchronously here is safe.
 */
function createMockListener() {
  const successHandlers: ((sub: EventSubSubscription) => void)[] = [];
  const confirmed = () => {
    const sub = subscriptionStub();
    for (const handler of successHandlers) {
      handler(sub);
    }
    return sub;
  };
  return {
    start: mock(() => {}),
    stop: mock(() => {}),
    onSubscriptionCreateSuccess: mock((h: (sub: EventSubSubscription) => void) => {
      successHandlers.push(h);
      return { unbind: mock(() => {}) };
    }),
    onSubscriptionCreateFailure: mock(() => ({ unbind: mock(() => {}) })),
    onChannelAdBreakBegin: mock(() => confirmed()),
    onChannelChatMessage: mock(() => confirmed()),
    onChannelChatNotification: mock(() => confirmed()),
    onChannelCheer: mock(() => confirmed()),
    onChannelFollow: mock(() => confirmed()),
    onChannelHypeTrainBeginV2: mock(() => confirmed()),
    onChannelRaidTo: mock(() => confirmed()),
    onChannelRedemptionAdd: mock(() => confirmed()),
    onStreamOnline: mock(() => confirmed()),
    onStreamOffline: mock(() => confirmed()),
  };
}

let lastTwitchClientConfig: unknown;
let lastClient: MockTwitchClient | undefined;
let lastListener: ReturnType<typeof createMockListener> | undefined;

class MockTwitchClient {
  constructor(config: unknown) {
    lastTwitchClientConfig = config;
    lastClient = this;
  }

  init = mock(async () => {});
  close = mock(async () => {});
  ApiClient = mock(() => ({}));
  EventBusListener = mock(() => {
    lastListener = createMockListener();
    return lastListener;
  });
  broadcaster = mock(async () => ({ id: "broadcaster-1", displayName: "Stream" }) as HelixUser);
}

mock.module("@woofx3/twitch", () => ({
  default: MockTwitchClient,
  requestTokenOverNats: () => async () => {
    throw new Error("no dashboard in this test");
  },
  TWITCH_NOT_LINKED: "TwitchNotLinked",
}));

const { default: TwitchApplication } = await import("./application");

/** A start signal that never aborts, for the tests that are not about aborting. */
const running = new AbortController().signal;

const CONFIG: TwitchConfig = {
  channel: "mychan",
  app: { clientId: "cid", clientSecret: "sec", redirectUri: "http://localhost/oauth" },
  membership: {
    ttlMs: TWITCH_DEFAULTS.membershipTtlMs,
    deadlineMs: TWITCH_DEFAULTS.membershipDeadlineMs,
    loadTimeoutMs: TWITCH_DEFAULTS.membershipLoadTimeoutMs,
    failureTtlMs: TWITCH_DEFAULTS.membershipFailureTtlMs,
    maxEntries: TWITCH_DEFAULTS.membershipMaxEntries,
  },
  sendQueueCap: TWITCH_DEFAULTS.sendQueueCap,
  selfSent: { capacity: TWITCH_DEFAULTS.selfSentCapacity, ttlMs: TWITCH_DEFAULTS.selfSentTtlMs },
};

function selfSentLines(): SelfSentRegistry {
  return new SelfSentRegistry(
    { capacity: TWITCH_DEFAULTS.selfSentCapacity, ttlMs: TWITCH_DEFAULTS.selfSentTtlMs },
    new FakeTime()
  );
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function context(overrides: Partial<TwitchAppContext> = {}): TwitchAppContext {
  return {
    logger: new RecordingLogger(),
    bus: {
      subscribe: mock(async () => {}),
      publish: mock(async () => {}),
      request: mock(async () => ({ subject: "", data: new Uint8Array() })),
    },
    db: { baseURL: "http://db-proxy" },
    config: CONFIG,
    ...overrides,
  } as unknown as TwitchAppContext;
}

type Reply = { id: string; type: string; source: string; time: string; data: unknown };

async function ask(
  app: InstanceType<typeof TwitchApplication>,
  ctx: TwitchAppContext,
  body: unknown,
  deadline = Number.MAX_SAFE_INTEGER
): Promise<Reply> {
  return JSON.parse(
    decoder.decode(await app.handleTwitchApiRequest(ctx, encoder.encode(JSON.stringify(body)), deadline))
  ) as Reply;
}

describe("TwitchApplication", () => {
  test("start wires TwitchClient with the channel and DB-backed settings, starts EventSub and listens for relinks", async () => {
    const ctx = context();
    const app = new TwitchApplication({
      clock: new FakeTime(),
      ids: countingIds(),
      timers: systemTimers,
      random: halfRandom,
      selfSent: selfSentLines(),
    });

    expect(await app.start(ctx, running)).toBe("connected");

    expect(lastTwitchClientConfig).toEqual(expect.objectContaining({ channel: "mychan" }));
    expect(typeof (lastTwitchClientConfig as { getSetting: unknown }).getSetting).toBe("function");
    expect(ctx.bus.subscribe).toHaveBeenCalledWith("setting.integration.token.updated", expect.any(Function));
    expect(ctx.bus.subscribe).not.toHaveBeenCalledWith("twitchapi", expect.any(Function));
    expect(ctx.broadcaster?.id).toBe("broadcaster-1");
    expect(ctx.twitchApi).toBeDefined();
    expect(app.eventSubStatus().ready).toBe(true);
  });

  test("stop closes the TwitchClient, stops EventSub and clears the context", async () => {
    const ctx = context();
    const app = new TwitchApplication({
      clock: new FakeTime(),
      ids: countingIds(),
      timers: systemTimers,
      random: halfRandom,
      selfSent: selfSentLines(),
    });
    await app.start(ctx, running);
    const listener = lastListener;

    await app.stop(ctx);

    expect(lastClient?.close).toHaveBeenCalledTimes(1);
    expect(listener?.stop).toHaveBeenCalled();
    expect(ctx.twitchApi).toBeUndefined();
    expect(ctx.broadcaster).toBeUndefined();
    expect(app.eventSubStatus()).toEqual({ established: 0, expected: expect.any(Number), ready: false });
  });

  test("stop before anything connected is safe", async () => {
    const app = new TwitchApplication({
      clock: new FakeTime(),
      ids: countingIds(),
      timers: systemTimers,
      random: halfRandom,
      selfSent: selfSentLines(),
    });

    await app.stop(context());

    expect(app.eventSubStatus().ready).toBe(false);
  });
});

describe("TwitchApplication twitchapi requests", () => {
  const time = new FakeTime(Date.parse("2026-10-22T12:00:00.000Z"));
  const app = new TwitchApplication({
    clock: time,
    ids: countingIds(),
    timers: systemTimers,
    random: halfRandom,
    selfSent: selfSentLines(),
  });

  test("answers a command with its result in a twitchapi.<command>.result CloudEvent", async () => {
    const getStreamInfo = mock(async () => ({ title: "hello" }));
    const reply = await ask(app, context({ twitchApi: { getStreamInfo } as never }), {
      command: "getStreamInfo",
      args: { a: "b" },
    });

    // Fields a command does not take are dropped, not refused.
    expect(getStreamInfo).toHaveBeenCalledWith({});
    expect(reply).toEqual({
      id: expect.any(String),
      type: "twitchapi.getStreamInfo.result",
      source: "twitchapi",
      time: "2026-10-22T12:00:00.000Z",
      data: { title: "hello" },
    });
  });

  const refusals: Array<[name: string, body: unknown, error: string]> = [
    ["an unknown command", { command: "not_a_real_command" }, "Unknown command: not_a_real_command"],
    ["a private helper", { command: "resolveUser" }, "Unknown command: resolveUser"],
    ["no command", { args: {} }, "Missing command"],
    ["a body that is not an object", 42, "Missing command"],
    ["an empty command", { command: "" }, "Missing command"],
    ["args that are not an object", { command: "getUser", args: "pup" }, "getUser: args must be an object"],
    ["args that are an array", { command: "getUser", args: ["pup"] }, "getUser: args must be an object"],
  ];
  for (const [name, body, error] of refusals) {
    test(`refuses ${name} with an uncoded twitchapi.error`, async () => {
      const reply = await ask(app, context({ twitchApi: {} as never }), body);
      expect(reply.type).toBe("twitchapi.error");
      expect(reply.data).toEqual({ error });
    });
  }

  const badArgs: Array<[command: string, args: unknown, error: string]> = [
    ["getUser", { userId: 123 }, "getUser: userId: Invalid input: expected string, received number"],
    ["shoutout", { userName: false }, "shoutout: userName: Invalid input: expected string, received boolean"],
    ["timeout", { userId: "u1" }, "timeout: durationSeconds: Invalid input: expected number, received undefined"],
    ["updateStream", { tags: "a,b" }, "updateStream: tags: Invalid input: expected array, received string"],
    ["searchCategories", {}, "searchCategories: query: Invalid input: expected string, received undefined"],
    [
      "addChannelModerator",
      { userId: null },
      "addChannelModerator: userId: Invalid input: expected string, received null",
    ],
  ];
  for (const [command, args, error] of badArgs) {
    test(`refuses ${command} with args of the wrong shape as invalid_arguments, without running it`, async () => {
      const run = mock(async () => ({ ok: true }));
      const reply = await ask(app, context({ twitchApi: { [command]: run } as never }), { command, args });

      expect(reply.type).toBe("twitchapi.error");
      expect(reply.data).toEqual({ error, code: "invalid_arguments" });
      expect(run).not.toHaveBeenCalled();
    });
  }

  test("reads the request out of a CloudEvent's data", async () => {
    const getUser = mock(async () => ({ userId: "u1" }));
    const reply = await ask(app, context({ twitchApi: { getUser } as never }), {
      type: "twitchapi",
      data: { command: "getUser", args: { userName: "pup" } },
    });

    expect(getUser).toHaveBeenCalledWith({ userName: "pup" });
    expect(reply.type).toBe("twitchapi.getUser.result");
  });

  test("refuses a body that is not JSON", async () => {
    const ctx = context({ twitchApi: {} as never });
    const reply = JSON.parse(
      decoder.decode(await app.handleTwitchApiRequest(ctx, encoder.encode("{"), Number.MAX_SAFE_INTEGER))
    ) as Reply;
    expect(reply.data).toEqual({ error: "Invalid request payload" });
  });

  test("passes a thrown TwitchApiError's code and drops the code of anything else", async () => {
    const { TwitchApiError } = await import("./lib/twitchApiError");
    const twitchApi = {
      shoutout: mock(async () => {
        throw new TwitchApiError("rate_limited", "slow down");
      }),
      clip: mock(async () => {
        throw new Error("boom");
      }),
    };
    const ctx = context({ twitchApi: twitchApi as never });

    expect((await ask(app, ctx, { command: "shoutout" })).data).toEqual({ error: "slow down", code: "rate_limited" });
    expect((await ask(app, ctx, { command: "clip" })).data).toEqual({ error: "boom" });
  });

  const deadlines: Array<[name: string, remainingMs: number, helixDeadlineMs: number]> = [
    ["plenty of time left gets the Helix deadline", 60_000, HELIX_DEADLINE_MS],
    ["less time left than the Helix deadline gets what is left", 3_000, 3_000],
    ["a deadline already past gets none", -5, 0],
  ];
  for (const [name, remainingMs, helixDeadlineMs] of deadlines) {
    test(`a helix call with ${name}`, async () => {
      const helix = mock(async () => ({ ok: true, body: null }));
      await ask(
        app,
        context({ twitchApi: { helix } as never }),
        { command: "helix", args: {} },
        time.now() + remainingMs
      );
      expect(helix).toHaveBeenCalledWith({}, { helixDeadlineMs });
    });
  }
});
