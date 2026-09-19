import { describe, expect, mock, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubSubscription } from "@twurple/eventsub-base";
import type { TwitchApiContext } from "./application";

/**
 * An EventSub listener that confirms every subscription as it is created, so
 * the real TwitchEventBus starts at once. Any `on<Event>` method the bus asks
 * for exists.
 */
function confirmingListener() {
  const successHandlers: Array<(sub: EventSubSubscription) => void> = [];
  const base: Record<string, unknown> = {
    start: mock(() => {}),
    stop: mock(() => {}),
    onSubscriptionCreateSuccess: (handler: (sub: EventSubSubscription) => void) => {
      successHandlers.push(handler);
      return { unbind: () => {} };
    },
    onSubscriptionCreateFailure: () => ({ unbind: () => {} }),
  };
  return new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) {
        return target[prop];
      }
      if (prop.startsWith("on")) {
        return () => {
          const sub = { id: prop, start: () => {}, stop: () => {} } as unknown as EventSubSubscription;
          for (const handler of successHandlers) {
            handler(sub);
          }
          return sub;
        };
      }
      return undefined;
    },
  });
}

/**
 * A TwitchClient whose `init` fails as the real one does while no Twitch
 * account is linked, until `linkTwitch()` is called.
 */
let linked = false;
let constructedWith: Array<{ channel?: string }> = [];

function linkTwitch() {
  linked = true;
}

class NotLinkedError extends Error {
  constructor() {
    super("Missing broadcaster token in db proxy setting: twitch_token");
    this.name = "TwitchNotLinked";
  }
}

class MockTwitchClient {
  constructor(config: { channel?: string }) {
    constructedWith.push(config);
  }

  init = mock(async () => {
    if (!linked) {
      throw new NotLinkedError();
    }
  });
  ApiClient = mock(() => ({}));
  EventBusListener = mock(() => confirmingListener());
  broadcaster = mock(async () => ({ id: "broadcaster-1", displayName: "Stream" }) as HelixUser);
}

mock.module("@woofx3/twitch", () => ({
  default: MockTwitchClient,
  TWITCH_NOT_LINKED: "TwitchNotLinked",
}));

const { default: TwitchApiApplication } = await import("./application");

type Handler = (msg: unknown) => unknown;

function context(config: Record<string, string | undefined>) {
  const handlers = new Map<string, Handler>();
  const subscribe = mock(async (subject: string, handler: Handler) => {
    handlers.set(subject, handler);
  });
  const logger = {
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
    child: mock(() => ({ info: mock(() => {}) })),
  };
  const ctx = {
    services: {
      dbProxy: { client: { baseURL: "http://db-proxy" } },
      messageBus: { client: { subscribe, publish: mock(() => {}) } },
    },
    config: { getConfig: (key: string) => config[key] },
    logger,
  } as unknown as TwitchApiContext;
  return { ctx, handlers, logger };
}

const CREDENTIALS = {
  woofx3TwitchClientId: "cid",
  woofx3TwitchClientSecret: "sec",
  woofx3TwitchRedirectUrl: "http://localhost/oauth",
};

function reset() {
  linked = false;
  constructedWith = [];
}

describe("TwitchApi before Twitch is linked", () => {
  test("starts idle and reports ready instead of failing", async () => {
    reset();
    const { ctx, logger } = context(CREDENTIALS);
    const app = new TwitchApiApplication();

    await app.init(ctx);

    expect(ctx.twitchEventBus).toBeUndefined();
    expect(app.isReady()).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("waiting for a Twitch link"));
  });

  test("needs no channel configured", async () => {
    reset();
    const { ctx } = context(CREDENTIALS);

    await new TwitchApiApplication().init(ctx);

    expect(constructedWith[0]?.channel).toBeUndefined();
  });

  test("connects when the Twitch link arrives", async () => {
    reset();
    const { ctx, handlers } = context(CREDENTIALS);
    const app = new TwitchApiApplication();
    await app.init(ctx);

    linkTwitch();
    await handlers.get("setting.integration.token.updated")?.({
      json: () => ({ data: { integration: "twitch" } }),
    });

    expect(ctx.twitchEventBus).toBeDefined();
    expect(ctx.broadcaster?.id).toBe("broadcaster-1");
    expect(app.isReady()).toBe(true);
  });

  test("ignores token updates for other integrations", async () => {
    reset();
    const { ctx, handlers } = context(CREDENTIALS);
    await new TwitchApiApplication().init(ctx);

    linkTwitch();
    await handlers.get("setting.integration.token.updated")?.({
      json: () => ({ data: { integration: "spotify" } }),
    });

    expect(ctx.twitchEventBus).toBeUndefined();
  });

  test("answers a twitchapi request with an error rather than failing", async () => {
    reset();
    const { ctx, handlers } = context(CREDENTIALS);
    await new TwitchApiApplication().init(ctx);
    const respond = mock(() => true);

    await handlers.get("twitchapi")?.({
      reply: "inbox.1",
      json: () => ({ data: { command: "getStreamInfo" } }),
      respond,
    });
    // The handler answers inside a tracing span it does not await.
    await Bun.sleep(0);

    expect(respond).toHaveBeenCalledTimes(1);
    const [payload] = respond.mock.calls[0] as unknown as [Uint8Array];
    expect(new TextDecoder().decode(payload)).toContain("not linked");
  });
});
