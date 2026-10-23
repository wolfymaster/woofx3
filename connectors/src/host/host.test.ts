import { describe, expect, test } from "bun:test";
import { PLATFORM_GATEWAY_SUBJECTS } from "@woofx3/api/platform-gateway";
import { COMPANION_GATEWAY_SUBJECTS } from "@woofx3/common/cloudevents/Companion/module-request";
import { getCurrentSessionId } from "@woofx3/common/cloudevents/session";
import {
  INTEGRATION_ENABLED_UPDATED_SUBJECT,
  INTEGRATION_TOKEN_UPDATED_SUBJECT,
} from "@woofx3/common/integrations/integration-settings";
import { FakeDispatcherDb, NO_ROLES, storedCommand } from "../chat/testing";
import { TRUSTED_LINE_SOURCES } from "../chat/trust";
import { ChatEnvSchema, chatConfig } from "../config/chat";
import { GatewayEnvSchema, gatewayConfig } from "../config/gateway";
import { HOST_DEFAULTS, HostEnvSchema, hostConfig } from "../config/host";
import type { Adapter, EgressHandlers, ServedSubject } from "./adapter";
import { Host } from "./host";
import type { BusMessage } from "./scoped-bus";
import {
  bytes,
  countingIds,
  FakeAdapter,
  FakeBus,
  FakeTime,
  fixedLinkStore,
  flush,
  halfRandom,
  RecordingLogger,
  shippedLinkReaders,
  testCompanion,
  text,
} from "./testing";

const twitchapi: ServedSubject = {
  subject: "twitchapi",
  budgetMs: 9_000,
  handle: async () => bytes("ok"),
  unavailableReply: ({ reason, link }) => bytes(link?.connected ? `integration_unavailable:${reason}` : "not_linked"),
};

function event(subject: string, data: Record<string, unknown>): Uint8Array {
  return bytes(JSON.stringify({ specversion: "1.0", id: "e", type: subject, source: "api", data }));
}

/** A bus whose requests reach the host's own responders, as the real bus would route them. */
class LoopbackBus extends FakeBus {
  override async request(
    subject: string,
    data: Uint8Array,
    _opts: { timeout: number }
  ): Promise<{ subject: string; data: Uint8Array }> {
    return new Promise((resolve) => {
      const msg: BusMessage = {
        subject,
        data,
        reply: "inbox",
        respond: (out) => {
          resolve({ subject: "inbox", data: out });
          return true;
        },
      };
      for (const subscription of this.subscriptions) {
        if (subscription.active && subscription.pattern === subject) {
          void subscription.handler(msg);
        }
      }
    });
  }
}

/** A line from a viewer with no grant for the restricted "hug" command, which the dispatcher answers with a reply. */
function deniedLine(): Uint8Array {
  return bytes(
    JSON.stringify({
      specversion: "1.0.0",
      id: "evt-1",
      type: "user.message",
      source: TRUSTED_LINE_SOURCES.twitch,
      platform: "twitch",
      data: {
        messageId: "m-1",
        chatterId: "v-1",
        chatterName: "Viewer",
        chatterLogin: "viewer",
        channelId: null,
        membership: NO_ROLES,
        fromEngine: false,
        message: "!hug",
      },
    })
  );
}

const chatSend: EgressHandlers = {
  "chat.send": { handle: async (payload) => ({ status: "delivered", messageId: `posted ${payload.message}` }) },
};

async function setup(
  served: ServedSubject = twitchapi,
  env: Record<string, unknown> = {},
  adapterOverride?: Adapter,
  dispatcherDb = new FakeDispatcherDb(),
  bus = new FakeBus()
) {
  const values: Record<string, string> = {};
  const settings = fixedLinkStore(values);
  const adapter = new FakeAdapter("twitch", [served], chatSend);
  const time = new FakeTime();
  const logger = new RecordingLogger();
  const host = new Host({
    config: hostConfig(HostEnvSchema.parse(env)),
    gateway: gatewayConfig(GatewayEnvSchema.parse({})),
    chat: chatConfig(ChatEnvSchema.parse({})),
    dispatcherDb,
    companion: testCompanion(),
    dbProxy: { baseURL: "http://db.test" },
    bus,
    busConnected: () => true,
    linkStore: settings,
    adapters: new Map([["twitch", adapterOverride ?? adapter]]),
    hostStates: new Map([["twitch", undefined]]),
    readers: shippedLinkReaders(),
    clock: time,
    random: halfRandom,
    ids: countingIds(),
    timers: time,
    logger,
  });
  const announce = async (enabled: boolean) => {
    bus.deliver(
      INTEGRATION_ENABLED_UPDATED_SUBJECT,
      event(INTEGRATION_ENABLED_UPDATED_SUBJECT, { integration: "twitch", enabled })
    );
    bus.deliver(INTEGRATION_TOKEN_UPDATED_SUBJECT, event(INTEGRATION_TOKEN_UPDATED_SUBJECT, { integration: "twitch" }));
    await flush();
    await host.settled();
  };
  const ask = async () => {
    const replies = bus.deliver("twitchapi", bytes("{}"), "inbox");
    await flush();
    return replies.map(text);
  };
  let sends = 0;
  const sendChat = async () => {
    sends++;
    const request = {
      action: "chat.send",
      target: { kind: "platforms", ids: ["twitch"] },
      payload: { message: "hi" },
      idempotencyKey: `key-${sends}`,
      requestedBy: { kind: "api", ref: "client-1" },
    };
    const replies = bus.deliver(PLATFORM_GATEWAY_SUBJECTS.send, bytes(JSON.stringify(request)), "inbox");
    await flush();
    return replies.map((reply) => (JSON.parse(text(reply)) as { data: unknown }).data);
  };
  return { values, bus, adapter, host, time, logger, announce, ask, sendChat };
}

describe("Host", () => {
  test("refuses to be built when an adapter has no host state entry", () => {
    const time = new FakeTime();
    const build = () =>
      new Host({
        config: hostConfig(HostEnvSchema.parse({})),
        gateway: gatewayConfig(GatewayEnvSchema.parse({})),
        chat: chatConfig(ChatEnvSchema.parse({})),
        dispatcherDb: new FakeDispatcherDb(),
        companion: testCompanion(),
        dbProxy: { baseURL: "http://db.test" },
        bus: new FakeBus(),
        busConnected: () => true,
        linkStore: fixedLinkStore({}),
        adapters: new Map([["twitch", new FakeAdapter("twitch", [twitchapi])]]),
        hostStates: new Map(),
        readers: shippedLinkReaders(),
        clock: time,
        random: halfRandom,
        ids: countingIds(),
        timers: time,
        logger: new RecordingLogger(),
      });
    expect(build).toThrow('the adapter "twitch" has no host state entry');
  });

  test("refuses to be built when two adapters claim one local endpoint", () => {
    const time = new FakeTime();
    const claiming = (id: "twitch" | "obs") => {
      const adapter = new FakeAdapter(id);
      Object.assign(adapter.manifest, { localEndpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }] });
      return adapter;
    };
    const build = () =>
      new Host({
        config: hostConfig(HostEnvSchema.parse({})),
        gateway: gatewayConfig(GatewayEnvSchema.parse({})),
        companion: testCompanion(),
        chat: chatConfig(ChatEnvSchema.parse({})),
        dispatcherDb: new FakeDispatcherDb(),
        dbProxy: { baseURL: "http://db.test" },
        bus: new FakeBus(),
        busConnected: () => true,
        linkStore: fixedLinkStore({}),
        adapters: new Map([
          ["twitch", claiming("twitch")],
          ["obs", claiming("obs")],
        ]),
        hostStates: new Map([
          ["twitch", undefined],
          ["obs", undefined],
        ]),
        readers: shippedLinkReaders(),
        clock: time,
        random: halfRandom,
        ids: countingIds(),
        timers: time,
        logger: new RecordingLogger(),
      });
    expect(build).toThrow("the local endpoint woofx3_obs/obs is claimed by both");
  });

  test("hands each adapter a companion handle scoped to its own claims", async () => {
    const { adapter, host, announce, values } = await setup();
    await host.start();
    values.twitch_token = "tok";
    values["integration.twitch.enabled"] = "true";
    await announce(true);
    const companion = adapter.lastContext?.companion;
    expect(companion).toBeDefined();
    expect(() =>
      companion?.resolve({ moduleId: "woofx3_obs", endpointId: "obs" }, { signal: new AbortController().signal })
    ).toThrow('the adapter "twitch" does not claim the local endpoint woofx3_obs/obs');
    await host.stop();
  });

  test("starts the adapter on link, stops it on disable and on unlink, without a restart", async () => {
    const { values, adapter, host, announce, ask } = await setup();
    await host.start();
    await host.settled();
    expect(await ask()).toEqual(["not_linked"]);

    values.twitch_token = "tok";
    values["integration.twitch.enabled"] = "true";
    await announce(true);
    expect(adapter.starts).toBe(1);
    expect(await ask()).toEqual(["ok"]);

    values["integration.twitch.enabled"] = "false";
    await announce(false);
    expect(adapter.stops).toBe(1);
    expect(await ask()).toEqual(["integration_unavailable:stopped"]);

    values["integration.twitch.enabled"] = "true";
    await announce(true);
    values.twitch_token = "";
    values["integration.twitch.enabled"] = "false";
    await announce(false);
    expect(adapter.starts).toBe(2);
    expect(await ask()).toEqual(["not_linked"]);
  });

  test("follows the stream session for the whole process, whatever the adapters do", async () => {
    const { bus, host } = await setup();
    await host.start();
    await host.settled();

    bus.deliver(
      "session.started",
      event("session.started", { sessionId: "sess-host-1", startedAt: "2026-10-22T12:00:00Z" })
    );
    await flush();

    expect(getCurrentSessionId()).toBe("sess-host-1");
    await host.stop();
  });

  test("stop stops the adapters and drops every host subscription", async () => {
    const { values, bus, adapter, host } = await setup();
    values.twitch_token = "tok";
    await host.start();
    await host.settled();
    expect(adapter.starts).toBe(1);

    await host.stop();
    expect(adapter.stops).toBe(1);
    expect(bus.subscriptions.filter((s) => s.active)).toHaveLength(0);
  });

  test("start loads the chat commands and the health snapshot counts them", async () => {
    const db = new FakeDispatcherDb();
    db.commands = [storedCommand()];
    const { host, bus } = await setup(twitchapi, {}, undefined, db);
    await host.start();
    const chat = host.snapshot().chat;
    expect(chat.commands.storedCommands).toBe(1);
    expect(chat.commands.builtins).toBeGreaterThan(0);
    expect(bus.active("user.message")).toBe(1);
    await host.stop();
  });

  test("a chat line the dispatcher cannot attribute is counted as refused", async () => {
    const { host, bus } = await setup();
    await host.start();
    bus.deliver("user.message", bytes("{}"));
    await flush();
    expect(host.snapshot().chat.lines.refused).toBe(1);
    await host.stop();
  });

  test("stop closes the chat subscriptions with the rest", async () => {
    const { host, bus } = await setup();
    await host.start();
    await host.stop();
    expect(bus.subscriptions.filter((s) => s.active)).toHaveLength(0);
  });

  describe("stopping with a chat line in flight", () => {
    async function holdLine(held: Promise<void>) {
      const db = new FakeDispatcherDb();
      db.commands = [storedCommand({ visibility: "restricted" })];
      const gated: EgressHandlers = {
        "chat.send": {
          handle: async (payload) => {
            await held;
            return { status: "delivered", messageId: `posted ${payload.message}` };
          },
        },
      };
      const adapter = new FakeAdapter("twitch", [twitchapi], gated);
      const ctx = await setup(twitchapi, {}, adapter, db, new LoopbackBus());
      ctx.values.twitch_token = "tok";
      ctx.values["integration.twitch.enabled"] = "true";
      await ctx.host.start();
      await ctx.host.settled();
      ctx.bus.deliver("user.message", deniedLine());
      await flush();
      return { ...ctx, adapter };
    }

    test("a line waiting on the gateway still gets its reply delivered", async () => {
      let release = () => {};
      const { host, adapter } = await holdLine(new Promise<void>((resolve) => (release = resolve)));
      const stopping = host.stop();
      await flush();
      expect(adapter.stops).toBe(0);
      release();
      await stopping;
      expect(host.snapshot().chat.replies).toEqual({ delivered: 1, failed: 0 });
      expect(host.snapshot().gateway.outcomes.twitch?.["chat.send"]).toEqual({ delivered: 1 });
      expect(adapter.stops).toBe(1);
    });

    test("a line that never finishes is abandoned at the chat drain time, before the adapters stop", async () => {
      const { host, adapter, time, logger } = await holdLine(new Promise<void>(() => {}));
      let stopped = false;
      void host.stop().then(() => {
        stopped = true;
      });
      await flush();
      await time.advance(chatConfig(ChatEnvSchema.parse({})).drainMs - 1);
      expect(adapter.stops).toBe(0);
      await time.advance(1);
      await flush();
      expect(adapter.stops).toBe(1);
      expect(logger.at("error").some((entry) => entry.message.includes("chat lines still being handled"))).toBe(true);
      await time.advance(HOST_DEFAULTS.stopDeadlineMs);
      expect(stopped).toBe(true);
    });
  });

  test("start fails when the chat commands cannot be listed, leaving no chat subscription behind", async () => {
    const db = new FakeDispatcherDb();
    db.failListing = true;
    const { host, bus } = await setup(twitchapi, {}, undefined, db);
    await expect(host.start()).rejects.toThrow("ListCommands");
    expect(bus.subscriptions.some((s) => s.pattern === "user.message")).toBe(false);
  });

  test("stop gives up on a served handler that ignores its deadline once the drain time is spent", async () => {
    const stuck: ServedSubject = { ...twitchapi, handle: () => new Promise<Uint8Array>(() => {}) };
    const { values, bus, host, time, logger } = await setup(stuck);
    values.twitch_token = "tok";
    await host.start();
    await host.settled();
    bus.deliver("twitchapi", bytes("{}"), "inbox");
    await flush();

    let stopped = false;
    void host.stop().then(() => {
      stopped = true;
    });
    await flush();
    // The drain time is the longer of the 10 s stop deadline and the 9 s budget.
    await time.advance(9_999);
    expect(stopped).toBe(false);
    await time.advance(1);
    expect(stopped).toBe(true);
    expect(logger.at("error").some((entry) => entry.message.includes("still running past"))).toBe(true);
  });

  test("refuses a shutdown deadline that does not cover the db-proxy timeout and the longest served budget", async () => {
    const slow: ServedSubject = { ...twitchapi, budgetMs: 14_000 };
    await expect(setup(slow)).rejects.toThrow("must exceed the db-proxy timeout");
    await expect(setup(slow, { woofx3ConnectorsShutdownDeadlineMs: 18_001 })).resolves.toBeDefined();
  });

  test("answers platform.gateway.send from the running adapter, and as unavailable once it is disabled", async () => {
    const { values, host, announce, sendChat } = await setup();
    await host.start();
    values.twitch_token = "tok";
    values["integration.twitch.enabled"] = "true";
    await announce(true);
    expect(await sendChat()).toEqual([
      { ok: true, results: { twitch: { status: "delivered", messageId: "posted hi" } } },
    ]);

    values["integration.twitch.enabled"] = "false";
    await announce(false);
    expect(await sendChat()).toEqual([
      { ok: false, results: { twitch: { status: "unavailable", reason: "disabled" } } },
    ]);
    expect(host.snapshot().gateway.outcomes.twitch?.["chat.send"]).toEqual({ delivered: 1, unavailable: 1 });
  });

  test("lists a platform as a field option only while it is connected and enabled", async () => {
    const { values, bus, host, announce } = await setup();
    await host.start();
    const options = async () => {
      const request = bytes(JSON.stringify({ action: "chat.send" }));
      const replies = bus.deliver(PLATFORM_GATEWAY_SUBJECTS.fieldOptions, request, "inbox");
      await flush();
      return replies.map((reply) => (JSON.parse(text(reply)) as { data: unknown }).data);
    };
    expect(await options()).toEqual([[]]);

    values.twitch_token = "tok";
    values["integration.twitch.enabled"] = "true";
    await announce(true);
    expect(await options()).toEqual([[{ value: "twitch", label: "Twitch" }]]);

    values["integration.twitch.enabled"] = "false";
    await announce(false);
    expect(await options()).toEqual([[]]);
  });

  test("refuses an adapter whose subscriptions cover the gateway's subject", async () => {
    const greedy: Adapter = {
      manifest: { id: "twitch", publishes: [], subscribes: ["platform.>"], requests: [], serves: [] },
      desired: () => false,
      start: async () => {},
      stop: async () => {},
    };
    await expect(setup(twitchapi, {}, greedy)).rejects.toThrow(
      'adapter "twitch" subscribes to "platform.>", which covers the host\'s platform.gateway.send'
    );
  });

  test("refuses an adapter that serves the gateway's subject", async () => {
    const rival: Adapter = {
      manifest: {
        id: "twitch",
        publishes: [],
        subscribes: [],
        requests: [],
        serves: [
          {
            subject: "platform.gateway.send",
            budgetMs: 1_000,
            handle: async () => new Uint8Array(),
            unavailableReply: () => new Uint8Array(),
          },
        ],
      },
      desired: () => false,
      start: async () => {},
      stop: async () => {},
    };
    await expect(setup(twitchapi, {}, rival)).rejects.toThrow(
      'adapter "twitch" serves "platform.gateway.send", which the host serves itself'
    );
  });

  test("answers engine.companion.module.request on its own scope", async () => {
    const { bus, host } = await setup();
    await host.start();
    const request = { op: "send", moduleId: "vtube_studio", endpointId: "vts", message: "{}", budgetMs: 4_500 };
    const replies = bus.deliver(COMPANION_GATEWAY_SUBJECTS.moduleRequest, bytes(JSON.stringify(request)), "inbox");
    await flush();
    expect(replies.map((reply) => JSON.parse(text(reply)))).toEqual([
      { status: "failed", code: "not_declared", message: 'vtube_studio declares no local endpoint "vts"' },
    ]);
    expect(host.snapshot().companion.modules.requests).toEqual({ send: { not_declared: 1 }, request: {} });
  });

  test("refuses an adapter that serves the companion gateway's subject", async () => {
    const rival: Adapter = {
      manifest: {
        id: "twitch",
        publishes: [],
        subscribes: [],
        requests: [],
        serves: [
          {
            subject: COMPANION_GATEWAY_SUBJECTS.moduleRequest,
            budgetMs: 1_000,
            handle: async () => new Uint8Array(),
            unavailableReply: () => new Uint8Array(),
          },
        ],
      },
      desired: () => false,
      start: async () => {},
      stop: async () => {},
    };
    await expect(setup(twitchapi, {}, rival)).rejects.toThrow(
      'adapter "twitch" serves "engine.companion.module.request", which the host serves itself'
    );
  });

  test("refuses a second start", async () => {
    const { host } = await setup();
    await host.start();
    await expect(host.start()).rejects.toThrow("already running");
  });
});
