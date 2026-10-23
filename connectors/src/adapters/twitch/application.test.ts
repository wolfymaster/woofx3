import { describe, expect, mock, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubSubscription } from "@twurple/eventsub-base";
import { TWITCH_DEFAULTS, type TwitchConfig } from "../../config/twitch";
import { countingIds, FakeTime, RecordingLogger } from "../../host/testing";
import type { TwitchAppContext } from "./application";
import { HELIX_DEADLINE_MS } from "./lib/helix";

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
    onChannelBan: mock(() => confirmed()),
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

class MockTwitchClient {
  constructor(config: unknown) {
    lastTwitchClientConfig = config;
  }

  init = mock(async () => {});
  ApiClient = mock(() => ({}));
  EventBusListener = mock(() => createMockListener());
  broadcaster = mock(async () => ({ id: "broadcaster-1", displayName: "Stream" }) as HelixUser);
}

mock.module("@woofx3/twitch", () => ({
  default: MockTwitchClient,
  requestTokenOverNats: () => async () => {
    throw new Error("no dashboard in this test");
  },
}));

const { default: TwitchApplication } = await import("./application");

const CONFIG: TwitchConfig = {
  channel: "mychan",
  app: { clientId: "cid", clientSecret: "sec", redirectUri: "http://localhost/oauth" },
  membership: { ttlMs: TWITCH_DEFAULTS.membershipTtlMs, deadlineMs: TWITCH_DEFAULTS.membershipDeadlineMs },
};

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
    const app = new TwitchApplication({ clock: new FakeTime(), ids: countingIds() });

    expect(await app.start(ctx)).toBe("connected");

    expect(lastTwitchClientConfig).toEqual(expect.objectContaining({ channel: "mychan" }));
    expect(typeof (lastTwitchClientConfig as { getSetting: unknown }).getSetting).toBe("function");
    expect(ctx.bus.subscribe).toHaveBeenCalledWith("setting.integration.token.updated", expect.any(Function));
    expect(ctx.bus.subscribe).not.toHaveBeenCalledWith("twitchapi", expect.any(Function));
    expect(ctx.broadcaster?.id).toBe("broadcaster-1");
    expect(ctx.twitchApi).toBeDefined();
    expect(ctx.twitchEventBus).toBeDefined();
  });

  test("stop disconnects the EventSub bus when present", async () => {
    const app = new TwitchApplication({ clock: new FakeTime(), ids: countingIds() });
    const disconnect = mock(() => {});

    await app.stop(context({ twitchEventBus: { disconnect } as unknown as TwitchAppContext["twitchEventBus"] }));

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("TwitchApplication twitchapi requests", () => {
  const time = new FakeTime(Date.parse("2026-10-22T12:00:00.000Z"));
  const app = new TwitchApplication({ clock: time, ids: countingIds() });

  test("answers a command with its result in a twitchapi.<command>.result CloudEvent", async () => {
    const getStreamInfo = mock(async () => ({ title: "hello" }));
    const reply = await ask(app, context({ twitchApi: { getStreamInfo } as never }), {
      command: "getStreamInfo",
      args: { a: "b" },
    });

    expect(getStreamInfo).toHaveBeenCalledWith({ a: "b" }, expect.anything());
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
  ];
  for (const [name, body, error] of refusals) {
    test(`refuses ${name} with an uncoded twitchapi.error`, async () => {
      const reply = await ask(app, context({ twitchApi: {} as never }), body);
      expect(reply.type).toBe("twitchapi.error");
      expect(reply.data).toEqual({ error });
    });
  }

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
