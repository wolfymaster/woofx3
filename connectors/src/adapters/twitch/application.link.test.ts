import { describe, expect, mock, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubSubscription } from "@twurple/eventsub-base";
import { TWITCH_DEFAULTS, type TwitchConfig } from "../../config/twitch";
import { countingIds, FakeTime, RecordingLogger } from "../../host/testing";
import type { TwitchAppContext } from "./application";

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
let nextReload = { userId: "42", userChanged: false, providerChanged: false };

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
  requestTokenOverNats: () => async () => {
    throw new Error("no dashboard in this test");
  },
  TWITCH_NOT_LINKED: "TwitchNotLinked",
}));

const { default: TwitchApplication } = await import("./application");

type Handler = (msg: { data: Uint8Array }) => unknown;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function newApp(): InstanceType<typeof TwitchApplication> {
  return new TwitchApplication({ clock: new FakeTime(), ids: countingIds() });
}

function context(config: Partial<TwitchConfig> = {}) {
  const handlers = new Map<string, Handler>();
  const subscribe = mock(async (subject: string, handler: Handler) => {
    handlers.set(subject, handler);
  });
  const logger = new RecordingLogger();
  const ctx: TwitchAppContext = {
    logger,
    bus: {
      subscribe,
      publish: mock(async () => {}),
      request: mock(async () => ({ subject: "", data: new Uint8Array() })),
    },
    db: { baseURL: "http://db-proxy" },
    config: { ...CREDENTIALS, ...config },
  } as unknown as TwitchAppContext;
  return { ctx, handlers, logger };
}

function event(body: unknown): { data: Uint8Array } {
  return { data: encoder.encode(JSON.stringify(body)) };
}

/** Asks for `command` as the sandbox does, with a bare `{ command, args }`, and decodes the reply. */
async function ask(app: InstanceType<typeof TwitchApplication>, ctx: TwitchAppContext, body: unknown) {
  const reply = await app.handleTwitchApiRequest(ctx, encoder.encode(JSON.stringify(body)), Number.MAX_SAFE_INTEGER);
  return JSON.parse(decoder.decode(reply)) as { type: string; source: string; data: { error: string; code?: string } };
}

const CREDENTIALS: TwitchConfig = {
  channel: undefined,
  app: { clientId: "cid", clientSecret: "sec", redirectUri: "http://localhost/oauth" },
  membership: { ttlMs: TWITCH_DEFAULTS.membershipTtlMs, deadlineMs: TWITCH_DEFAULTS.membershipDeadlineMs },
};

function reset() {
  linked = false;
  constructedWith = [];
  instances = [];
  nextReload = { userId: "42", userChanged: false, providerChanged: false };
}

const TOKEN_UPDATED = "setting.integration.token.updated";

describe("TwitchApplication before Twitch is linked", () => {
  test("start reports not_linked instead of failing, and runs nothing", async () => {
    reset();
    const { ctx, logger } = context();
    const app = newApp();

    expect(await app.start(ctx)).toBe("not_linked");

    expect(ctx.twitchEventBus).toBeUndefined();
    expect(app.eventSubStatus().ready).toBe(false);
    expect(logger.at("info").map((entry) => entry.message)).toContainEqual(
      expect.stringContaining("waiting for a Twitch link")
    );
  });

  test("needs no channel configured", async () => {
    reset();
    const { ctx } = context();

    await newApp().start(ctx);

    expect(constructedWith[0]?.channel).toBeUndefined();
  });

  test("connects when the Twitch link arrives", async () => {
    reset();
    const { ctx, handlers } = context();
    const app = newApp();
    await app.start(ctx);

    linkTwitch();
    await handlers.get(TOKEN_UPDATED)?.(event({ data: { integration: "twitch" } }));

    expect(ctx.twitchEventBus).toBeDefined();
    expect(ctx.broadcaster?.id).toBe("broadcaster-1");
    expect(app.eventSubStatus().ready).toBe(true);
  });

  test("ignores token updates for other integrations, and bodies that are not events", async () => {
    reset();
    const { ctx, handlers } = context();
    await newApp().start(ctx);

    linkTwitch();
    await handlers.get(TOKEN_UPDATED)?.(event({ data: { integration: "spotify" } }));
    await handlers.get(TOKEN_UPDATED)?.({ data: encoder.encode("not json") });

    expect(ctx.twitchEventBus).toBeUndefined();
  });

  test("answers a twitchapi request with an error rather than failing", async () => {
    reset();
    const { ctx } = context();
    const app = newApp();
    await app.start(ctx);

    const reply = await ask(app, ctx, { data: { command: "getStreamInfo" } });

    expect(reply.type).toBe("twitchapi.error");
    expect(reply.source).toBe("twitchapi");
    expect(reply.data.error).toContain("not linked");
  });

  test("codes the not-linked refusal for helix only, as the other commands' contract has no code for it", async () => {
    reset();
    const { ctx } = context();
    const app = newApp();
    await app.start(ctx);

    const helix = await ask(app, ctx, { command: "helix", args: { operation: "getChannelInformation" } });
    expect(helix.type).toBe("twitchapi.error");
    expect(helix.data.code).toBe("not_linked");
    expect(helix.data.error).toContain("not linked");

    const other = await ask(app, ctx, { command: "getStreamInfo", args: { operation: "getChannelInformation" } });
    expect(other.data.code).toBeUndefined();
  });

  // The sandbox's ctx.twitch and the chatbot publish the request without a
  // CloudEvent around it; it must reach the dispatcher all the same.
  test("reads a bare { command, args } request as well as a CloudEvent one", async () => {
    reset();
    const { ctx } = context();
    const app = newApp();
    await app.start(ctx);

    const reply = await ask(app, ctx, { command: "getStreamInfo", args: {} });

    expect(reply.data.error).not.toContain("Missing command");
    expect(reply.data.error).toContain("not linked");
  });
});

describe("TwitchApplication relinked while connected", () => {
  const tokenUpdated = event({ data: { integration: "twitch" } });

  test("swaps the token in place and requests every subscription again", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers } = context();
    const app = newApp();
    expect(await app.start(ctx)).toBe("connected");
    const client = instances[0];
    const bus = ctx.twitchEventBus;
    const subscriptionsBefore = client?.listener.subscribeCount as number;

    await handlers.get(TOKEN_UPDATED)?.(tokenUpdated);

    expect(instances).toHaveLength(1);
    expect(client?.reloadToken).toHaveBeenCalledTimes(1);
    expect(ctx.twitchEventBus).toBe(bus);
    expect(client?.listener.subscribeCount).toBe(subscriptionsBefore * 2);
    expect(app.eventSubStatus().ready).toBe(true);
  });

  test("reconnects from scratch when a different account was linked", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers } = context();
    const app = newApp();
    await app.start(ctx);
    const first = instances[0];

    nextReload = { userId: "99", userChanged: true, providerChanged: false };
    await handlers.get(TOKEN_UPDATED)?.(tokenUpdated);

    expect(first?.close).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
    expect(ctx.twitchEventBus).toBeDefined();
    expect(app.eventSubStatus().ready).toBe(true);
  });

  test("reconnects from scratch when the relinked token is renewed another way", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers } = context();
    const app = newApp();
    await app.start(ctx);
    const first = instances[0];

    nextReload = { userId: "42", userChanged: false, providerChanged: true };
    await handlers.get(TOKEN_UPDATED)?.(tokenUpdated);

    expect(first?.close).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
    expect(instances[1]?.init).toHaveBeenCalledTimes(1);
    expect(ctx.twitchEventBus).toBeDefined();
    expect(app.eventSubStatus().ready).toBe(true);
  });

  test("keeps the connection for a different account when a channel is configured", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers } = context({ channel: "stream" });
    await newApp().start(ctx);

    nextReload = { userId: "99", userChanged: true, providerChanged: false };
    await handlers.get(TOKEN_UPDATED)?.(tokenUpdated);

    expect(instances).toHaveLength(1);
    expect(instances[0]?.close).not.toHaveBeenCalled();
  });

  test("reconnects for a token renewed another way even with a channel configured", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers } = context({ channel: "stream" });
    await newApp().start(ctx);

    nextReload = { userId: "42", userChanged: false, providerChanged: true };
    await handlers.get(TOKEN_UPDATED)?.(tokenUpdated);

    expect(instances[0]?.close).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
  });
});
