import { describe, expect, mock, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubSubscription } from "@twurple/eventsub-base";
import { TWITCH_DEFAULTS, type TwitchConfig } from "../../config/twitch";
import { countingIds, FakeTime, RecordingLogger } from "../../host/testing";
import type { TwitchAppContext } from "./application";
import { SelfSentRegistry } from "./lib/self-sent";

/** Whether listeners confirm subscriptions; false leaves TwitchEventBus waiting to settle. */
let confirmSubscriptions = true;

/**
 * An EventSub listener that confirms every subscription as it is created, so
 * the real TwitchEventBus starts at once. Any `on<Event>` method the bus asks
 * for exists, and the callback it is given is kept in `callbacks`.
 */
function confirmingListener() {
  const successHandlers: Array<(sub: EventSubSubscription) => void> = [];
  const callbacks: Record<string, (event: unknown) => Promise<void>> = {};
  const base: Record<string, unknown> = {
    callbacks,
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
        return (...args: unknown[]) => {
          (target.subscribeCount as number) += 1;
          const callback = args.find((arg) => typeof arg === "function");
          if (callback !== undefined) {
            callbacks[prop] = callback as (event: unknown) => Promise<void>;
          }
          const sub = { id: prop, start: () => {}, stop: () => {} } as unknown as EventSubSubscription;
          if (confirmSubscriptions) {
            for (const handler of successHandlers) {
              handler(sub);
            }
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
type AuthFailureHandler = (err: Error, info: { provider: "refreshing" | "dashboard" }) => void;
type ClientArgs = { channel?: string; onAuthFailure?: AuthFailureHandler };
let constructedWith: ClientArgs[] = [];
let instances: MockTwitchClient[] = [];
/** What the next `reloadToken` reports, as a relink in the UI would. */
let nextReload = { userId: "42", userChanged: false, providerChanged: false };

/** Makes every `init` reject with this error while set. */
let initFailure: Error | null = null;

/** Holds every `init` open until released, to observe a reconnect mid-way. */
let initGate: Promise<void> | null = null;

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
  constructor(config: ClientArgs) {
    constructedWith.push(config);
    instances.push(this);
  }

  listener = confirmingListener();
  reloadToken = mock(async () => {
    if (!linked) {
      throw new NotLinkedError();
    }
    return nextReload;
  });
  close = mock(async () => {});

  init = mock(async () => {
    if (initFailure !== null) {
      throw initFailure;
    }
    if (!linked) {
      throw new NotLinkedError();
    }
    await initGate;
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

/** A start signal that never aborts, for the tests that are not about aborting. */
const running = new AbortController().signal;

type Handler = (msg: { data: Uint8Array }) => unknown;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function newApp(): InstanceType<typeof TwitchApplication> {
  return new TwitchApplication({ clock: new FakeTime(), ids: countingIds(), selfSent: selfSentLines() });
}

function context(config: Partial<TwitchConfig> = {}) {
  const handlers = new Map<string, Handler>();
  const subscribe = mock(async (subject: string, handler: Handler) => {
    handlers.set(subject, handler);
  });
  const logger = new RecordingLogger();
  const reportFault = mock((_reason: string) => {});
  const ctx: TwitchAppContext = {
    logger,
    bus: {
      subscribe,
      publish: mock(async () => {}),
      request: mock(async () => ({ subject: "", data: new Uint8Array() })),
    },
    db: { baseURL: "http://db-proxy" },
    config: { ...CREDENTIALS, ...config },
    reportFault,
  } as unknown as TwitchAppContext;
  return { ctx, handlers, logger, reportFault };
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
  sendQueueCap: TWITCH_DEFAULTS.sendQueueCap,
  selfSent: { capacity: TWITCH_DEFAULTS.selfSentCapacity, ttlMs: TWITCH_DEFAULTS.selfSentTtlMs },
};

function selfSentLines(): SelfSentRegistry {
  return new SelfSentRegistry(
    { capacity: TWITCH_DEFAULTS.selfSentCapacity, ttlMs: TWITCH_DEFAULTS.selfSentTtlMs },
    new FakeTime()
  );
}

function reset() {
  linked = false;
  constructedWith = [];
  instances = [];
  initGate = null;
  initFailure = null;
  confirmSubscriptions = true;
  nextReload = { userId: "42", userChanged: false, providerChanged: false };
}

const TOKEN_UPDATED = "setting.integration.token.updated";

describe("TwitchApplication before Twitch is linked", () => {
  test("start reports not_linked instead of failing, and runs nothing", async () => {
    reset();
    const { ctx, logger } = context();
    const app = newApp();

    expect(await app.start(ctx, running)).toBe("not_linked");

    expect(ctx.twitchEventBus).toBeUndefined();
    expect(app.eventSubStatus().ready).toBe(false);
    expect(logger.at("info").map((entry) => entry.message)).toContainEqual(
      expect.stringContaining("waiting for a Twitch link")
    );
  });

  test("needs no channel configured", async () => {
    reset();
    const { ctx } = context();

    await newApp().start(ctx, running);

    expect(constructedWith[0]?.channel).toBeUndefined();
  });

  test("connects when the Twitch link arrives", async () => {
    reset();
    const { ctx, handlers } = context();
    const app = newApp();
    await app.start(ctx, running);

    linkTwitch();
    await handlers.get(TOKEN_UPDATED)?.(event({ data: { integration: "twitch" } }));

    expect(ctx.twitchEventBus).toBeDefined();
    expect(ctx.broadcaster?.id).toBe("broadcaster-1");
    expect(app.eventSubStatus().ready).toBe(true);
  });

  test("ignores token updates for other integrations, and bodies that are not events", async () => {
    reset();
    const { ctx, handlers } = context();
    await newApp().start(ctx, running);

    linkTwitch();
    await handlers.get(TOKEN_UPDATED)?.(event({ data: { integration: "spotify" } }));
    await handlers.get(TOKEN_UPDATED)?.({ data: encoder.encode("not json") });

    expect(ctx.twitchEventBus).toBeUndefined();
  });

  test("answers a twitchapi request with an error rather than failing", async () => {
    reset();
    const { ctx } = context();
    const app = newApp();
    await app.start(ctx, running);

    const reply = await ask(app, ctx, { data: { command: "getStreamInfo" } });

    expect(reply.type).toBe("twitchapi.error");
    expect(reply.source).toBe("twitchapi");
    expect(reply.data.error).toContain("not linked");
  });

  test("codes the not-linked refusal for helix only, as the other commands' contract has no code for it", async () => {
    reset();
    const { ctx } = context();
    const app = newApp();
    await app.start(ctx, running);

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
    await app.start(ctx, running);

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
    expect(await app.start(ctx, running)).toBe("connected");
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
    await app.start(ctx, running);
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
    await app.start(ctx, running);
    const first = instances[0];

    nextReload = { userId: "42", userChanged: false, providerChanged: true };
    await handlers.get(TOKEN_UPDATED)?.(tokenUpdated);

    expect(first?.close).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
    expect(instances[1]?.init).toHaveBeenCalledTimes(1);
    expect(ctx.twitchEventBus).toBeDefined();
    expect(app.eventSubStatus().ready).toBe(true);
  });

  test("faults the adapter when the reconnect for a different account fails", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers, reportFault } = context();
    const app = newApp();
    await app.start(ctx, running);

    nextReload = { userId: "99", userChanged: true, providerChanged: false };
    initFailure = new Error("helix unreachable");
    await handlers.get(TOKEN_UPDATED)?.(tokenUpdated);

    expect(reportFault.mock.calls).toEqual([["Twitch token update could not be applied: helix unreachable"]]);
  });

  test("answers every command integration_unavailable while a relink reconnects", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers } = context();
    const app = newApp();
    await app.start(ctx, running);

    let release = () => {};
    initGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    nextReload = { userId: "42", userChanged: false, providerChanged: true };
    const relinking = handlers.get(TOKEN_UPDATED)?.(tokenUpdated);
    await Bun.sleep(0);

    const codes = [];
    for (const command of ["helix", "getStreamInfo"]) {
      const reply = await ask(app, ctx, { command, args: {} });
      codes.push(reply.data.code);
    }
    initGate = null;
    release();
    await relinking;

    expect(codes).toEqual(["integration_unavailable", "integration_unavailable"]);
  });

  test("ignores an update that left no token stored, keeping the connection for the host to stop", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers, logger } = context();
    const app = newApp();
    await app.start(ctx, running);
    const bus = ctx.twitchEventBus;
    const subscriptionsBefore = instances[0]?.listener.subscribeCount as number;

    linked = false;
    await handlers.get(TOKEN_UPDATED)?.(tokenUpdated);

    expect(instances).toHaveLength(1);
    expect(instances[0]?.close).not.toHaveBeenCalled();
    expect(ctx.twitchEventBus).toBe(bus);
    expect(instances[0]?.listener.subscribeCount).toBe(subscriptionsBefore);
    expect(logger.at("error")).toEqual([]);
    expect(logger.at("debug").map((entry) => entry.message)).toContainEqual(
      expect.stringContaining("left no token stored")
    );
  });

  test("keeps the connection for a different account when a channel is configured", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers } = context({ channel: "stream" });
    await newApp().start(ctx, running);

    nextReload = { userId: "99", userChanged: true, providerChanged: false };
    await handlers.get(TOKEN_UPDATED)?.(tokenUpdated);

    expect(instances).toHaveLength(1);
    expect(instances[0]?.close).not.toHaveBeenCalled();
  });

  test("reconnects for a token renewed another way even with a channel configured", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers } = context({ channel: "stream" });
    await newApp().start(ctx, running);

    nextReload = { userId: "42", userChanged: false, providerChanged: true };
    await handlers.get(TOKEN_UPDATED)?.(tokenUpdated);

    expect(instances[0]?.close).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
  });
});

describe("TwitchApplication stop", () => {
  test("closes the client, stops EventSub and clears the context", async () => {
    reset();
    linkTwitch();
    const { ctx } = context();
    const app = newApp();
    await app.start(ctx, running);
    const client = instances[0];

    await app.stop(ctx);

    expect(client?.close).toHaveBeenCalledTimes(1);
    expect(client?.listener.stop).toHaveBeenCalled();
    expect(ctx.twitchApi).toBeUndefined();
    expect(ctx.twitchEventBus).toBeUndefined();
    expect(ctx.broadcaster).toBeUndefined();
    expect(app.eventSubStatus().ready).toBe(false);
  });

  test("drops a relink that arrived mid-connect", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers } = context();
    const app = newApp();
    let release = () => {};
    initGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const starting = app.start(ctx, running);
    await Bun.sleep(0);
    await handlers.get(TOKEN_UPDATED)?.(event({ data: { integration: "twitch" } }));

    await app.stop(ctx);
    release();

    await expect(starting).rejects.toThrow("stopped");
    expect(instances[0]?.reloadToken).not.toHaveBeenCalled();
    expect(instances[0]?.close).toHaveBeenCalledTimes(1);
    expect(ctx.twitchEventBus).toBeUndefined();
  });

  test("ignores a token update that arrives after it", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers, logger } = context();
    const app = newApp();
    await app.start(ctx, running);
    await app.stop(ctx);

    await handlers.get(TOKEN_UPDATED)?.(event({ data: { integration: "twitch" } }));

    expect(instances).toHaveLength(1);
    expect(instances[0]?.reloadToken).not.toHaveBeenCalled();
    expect(logger.at("error")).toEqual([]);
  });

  test("waits for an event publish still in flight", async () => {
    reset();
    linkTwitch();
    const { ctx } = context();
    const app = newApp();
    await app.start(ctx, running);
    let release = () => {};
    (ctx.bus.publish as ReturnType<typeof mock>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const callbacks = instances[0]?.listener.callbacks as Record<string, (event: unknown) => Promise<void>>;
    void callbacks.onChannelFollow?.({ userDisplayName: "Pup", userId: "u1" });

    let stopped = false;
    const stopping = app.stop(ctx).then(() => {
      stopped = true;
    });
    await Bun.sleep(0);
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(stopped).toBe(true);
  });
});

describe("TwitchApplication token renewal failures", () => {
  const tokenUpdated = event({ data: { integration: "twitch" } });

  test.each([
    ["refreshing", "Invalid refresh token"],
    ["dashboard", "the api service could not get a Twitch token: relink_required"],
  ] as const)("a failed %s renewal while connected reports a fault with the reason", async (provider, message) => {
    reset();
    linkTwitch();
    const { ctx, reportFault } = context();
    await newApp().start(ctx, running);

    constructedWith[0]?.onAuthFailure?.(new Error(message), { provider });

    expect(reportFault.mock.calls).toEqual([[`Twitch token renewal failed (${provider}): ${message}`]]);
  });

  test("a failure after stop is ignored", async () => {
    reset();
    linkTwitch();
    const { ctx, reportFault } = context();
    const app = newApp();
    await app.start(ctx, running);
    await app.stop(ctx);

    constructedWith[0]?.onAuthFailure?.(new Error("Invalid refresh token"), { provider: "refreshing" });

    expect(reportFault).not.toHaveBeenCalled();
  });

  test("a failure from the connection a relink replaced is ignored; the new one's is reported", async () => {
    reset();
    linkTwitch();
    const { ctx, handlers, reportFault } = context();
    await newApp().start(ctx, running);
    nextReload = { userId: "42", userChanged: false, providerChanged: true };
    await handlers.get(TOKEN_UPDATED)?.(tokenUpdated);
    expect(constructedWith).toHaveLength(2);

    constructedWith[0]?.onAuthFailure?.(new Error("old token"), { provider: "refreshing" });
    expect(reportFault).not.toHaveBeenCalled();

    constructedWith[1]?.onAuthFailure?.(new Error("new token"), { provider: "dashboard" });
    expect(reportFault.mock.calls).toEqual([["Twitch token renewal failed (dashboard): new token"]]);
  });
});

describe("TwitchApplication start aborted", () => {
  test("mid-init gives up and closes the client", async () => {
    reset();
    linkTwitch();
    const { ctx } = context();
    const abort = new AbortController();
    let release = () => {};
    initGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const starting = newApp().start(ctx, abort.signal);
    await Bun.sleep(0);
    abort.abort(new Error("no longer wanted"));
    release();

    await expect(starting).rejects.toThrow("no longer wanted");
    expect(instances[0]?.close).toHaveBeenCalledTimes(1);
    expect(ctx.twitchApi).toBeUndefined();
  });

  test("while EventSub settles stops waiting, stops the listener and closes the client", async () => {
    reset();
    linkTwitch();
    confirmSubscriptions = false;
    const { ctx } = context();
    const abort = new AbortController();
    const app = newApp();

    const starting = app.start(ctx, abort.signal);
    await Bun.sleep(0);
    expect(instances[0]?.listener.start).toHaveBeenCalled();
    abort.abort(new Error("no longer wanted"));

    await expect(starting).rejects.toThrow("no longer wanted");
    expect(instances[0]?.listener.stop).toHaveBeenCalled();
    expect(instances[0]?.close).toHaveBeenCalledTimes(1);
    expect(ctx.twitchEventBus).toBeUndefined();
    expect(app.eventSubStatus().ready).toBe(false);
  });

  test("on a signal already aborted connects nothing", async () => {
    reset();
    linkTwitch();
    const { ctx } = context();

    await expect(newApp().start(ctx, AbortSignal.abort(new Error("gone")))).rejects.toThrow("gone");

    expect(instances).toHaveLength(0);
  });
});
