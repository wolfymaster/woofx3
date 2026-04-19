import { describe, expect, mock, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubSubscription } from "@twurple/eventsub-base";
import type { TwitchApiContext } from "./application";

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
    onChannelSubscription: mock(() => subscriptionStub()),
    onChannelSubscriptionGift: mock(() => subscriptionStub()),
    onStreamOnline: mock(() => subscriptionStub()),
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
}));

const { default: TwitchApiApplication } = await import("./application");

describe("TwitchApi application", () => {
  test("init wires TwitchClient with channel and DB-backed getSetting; starts EventSub and subscribes to twitchapi", async () => {
    const subscribe = mock(async () => {});
    const getConfig = mock((key: string) => {
      const map: Record<string, string> = {
        woofx3TwitchChannelName: "mychan",
        woofx3TwitchClientId: "cid",
        woofx3TwitchClientSecret: "sec",
        woofx3TwitchRedirectUrl: "http://localhost/oauth",
      };
      return map[key];
    });

    const ctx = {
      services: {
        dbProxy: { client: { baseURL: "http://db-proxy" } },
        messageBus: { client: { subscribe, publish: mock(() => {}) } },
      },
      config: { getConfig },
      logger: {
        info: mock(() => {}),
        error: mock(() => {}),
        warn: mock(() => {}),
        debug: mock(() => {}),
        child: mock(() => ({ info: mock(() => {}) })),
      },
    } as unknown as TwitchApiContext;

    const app = new TwitchApiApplication();
    await app.init(ctx);

    expect(lastTwitchClientConfig).toEqual(
      expect.objectContaining({
        channel: "mychan",
      })
    );
    expect(typeof (lastTwitchClientConfig as { getSetting: unknown }).getSetting).toBe("function");
    expect(subscribe).toHaveBeenCalledWith("twitchapi", expect.any(Function));
    expect(ctx.broadcaster?.id).toBe("broadcaster-1");
    expect(ctx.twitchApi).toBeDefined();
    expect(ctx.twitchEventBus).toBeDefined();
  });

  test("terminate disconnects the EventSub bus when present", async () => {
    const app = new TwitchApiApplication();
    const disconnect = mock(() => {});
    const ctx = {
      twitchEventBus: { disconnect },
    } as unknown as TwitchApiContext;

    await app.terminate(ctx);

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  test("twitchApiMessageHandler returns false when the command is not implemented on the API client", async () => {
    const app = new TwitchApiApplication();
    const handler = (
      app as unknown as {
        twitchApiMessageHandler(ctx: TwitchApiContext, command: string, args: Record<string, string>): Promise<boolean>;
      }
    ).twitchApiMessageHandler.bind(app);

    const ctx = {
      twitchApi: {},
      services: { messageBus: { client: { publish: mock(() => {}) } } },
      logger: { error: mock(() => {}) },
    } as unknown as TwitchApiContext;

    const ok = await handler(ctx, "not_a_real_command", {});
    expect(ok).toBe(false);
  });

  test("twitchApiMessageHandler publishes follow-up bus commands when the handler returns a command envelope", async () => {
    const app = new TwitchApiApplication();
    const handler = (
      app as unknown as {
        twitchApiMessageHandler(ctx: TwitchApiContext, command: string, args: Record<string, string>): Promise<boolean>;
      }
    ).twitchApiMessageHandler.bind(app);

    const publish = mock(() => {});
    const ctx = {
      twitchApi: {
        clip: mock(async () => ({
          error: false,
          command: {
            topic: "woofwoofwoof",
            command: "write_message",
            args: { message: "hello" },
          },
        })),
      },
      services: { messageBus: { client: { publish } } },
      logger: { error: mock(() => {}) },
    } as unknown as TwitchApiContext;

    const ok = await handler(ctx, "clip", {});

    expect(ok).toBe(true);
    expect(publish).toHaveBeenCalledWith("woofwoofwoof", expect.any(Uint8Array));
  });
});
