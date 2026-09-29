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
    subscribeCount: 0,
  };
  return new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) {
        return target[prop];
      }
      if (prop.startsWith("on")) {
        return () => {
          (target.subscribeCount as number) += 1;
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
let instances: MockTwitchClient[] = [];
/** What the next `reloadToken` reports, as a relink in the UI would. */
let nextReload = { userId: "42", userChanged: false };

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
    instances.push(this);
  }

  listener = confirmingListener();
  reloadToken = mock(async () => nextReload);
  close = mock(async () => {});

  init = mock(async () => {
    if (!linked) {
      throw new NotLinkedError();
    }
  });
  ApiClient = mock(() => ({}));
  EventBusListener = mock(() => this.listener);
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
  instances = [];
  nextReload = { userId: "42", userChanged: false };
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

  // The sandbox's ctx.twitch and the chatbot publish the request without a
  // CloudEvent around it; it must reach the dispatcher all the same.
  test("reads a bare { command, args } request as well as a CloudEvent one", async () => {
    reset();
    const { ctx, handlers } = context(CREDENTIALS);
    await new TwitchApiApplication().init(ctx);
    const respond = mock(() => true);

    await handlers.get("twitchapi")?.({
      reply: "inbox.1",
      json: () => ({ command: "getStreamInfo", args: {} }),
      respond,
    });
    await Bun.sleep(0);

    const [payload] = respond.mock.calls[0] as unknown as [Uint8Array];
    const body = new TextDecoder().decode(payload);
    expect(body).not.toContain("Missing command");
    expect(body).toContain("not linked");
  });
});

describe("TwitchApi relinked while connected", () => {
  const tokenUpdated = { json: () => ({ data: { integration: "twitch" } }) };

  test("swaps the token in place and requests every subscription again", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers } = context(CREDENTIALS);
    const app = new TwitchApiApplication();
    await app.init(ctx);
    const client = instances[0];
    const bus = ctx.twitchEventBus;
    const subscriptionsBefore = client?.listener.subscribeCount as number;

    await handlers.get("setting.integration.token.updated")?.(tokenUpdated);

    expect(instances).toHaveLength(1);
    expect(client?.reloadToken).toHaveBeenCalledTimes(1);
    expect(ctx.twitchEventBus).toBe(bus);
    expect(client?.listener.subscribeCount).toBe(subscriptionsBefore * 2);
    expect(app.isReady()).toBe(true);
  });

  test("reconnects from scratch when a different account was linked", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers } = context(CREDENTIALS);
    const app = new TwitchApiApplication();
    await app.init(ctx);
    const first = instances[0];

    nextReload = { userId: "99", userChanged: true };
    await handlers.get("setting.integration.token.updated")?.(tokenUpdated);

    expect(first?.close).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
    expect(ctx.twitchEventBus).toBeDefined();
    expect(app.isReady()).toBe(true);
  });
});
