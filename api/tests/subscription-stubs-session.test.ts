import { afterEach, describe, expect, test } from "bun:test";
import type { StreamEventFrame, Woofx3EngineApi } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import { Api } from "../src/api";
import { ClientSessions } from "../src/client-sessions";
import type { EventCatalog, LoggedEvent } from "../src/event-catalog";
import { ApiGateway } from "../src/gateway";
import { createHttpServer } from "../src/http";
import { resolveRegistrationPolicy } from "../src/registration";
import { StreamEventBroadcaster } from "../src/stream-event-broadcaster";

/*
 * The push subscriptions over a real capnweb WebSocket session. capnweb
 * disposes a stub received as a call parameter when that call returns, so
 * these are the only tests that see whether a kept callback still works once
 * `subscribe*` has returned.
 */

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as SharedLogger;
const FOLLOW = "channel.follow";

type Server = ReturnType<typeof createHttpServer>;
let server: Server | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

async function startEngine() {
  const handlers = new Map<string, (msg: Msg) => void>();
  const nats = {
    async subscribe(subject: string, handler: (msg: Msg) => void) {
      handlers.set(subject, handler);
      return {
        unsubscribe: () => {
          handlers.delete(subject);
        },
      };
    },
  } as unknown as NATSClient;
  const catalog = {
    events: new Map<string, LoggedEvent>([[FOLLOW, { subject: FOLLOW, moduleId: "woofx3_twitch", onByDefault: true }]]),
    onChange() {},
  } as unknown as EventCatalog;
  const broadcaster = new StreamEventBroadcaster(nats, logger, catalog);
  await broadcaster.start();

  const db = { listClients: async () => ({ clients: [] }) };
  const api = new Api({
    db: db as never,
    nats: null,
    functions: null,
    barkloaderUrl: "http://b",
    barkloaderKey: "test-barkloader-key-0123456789abcdef",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger,
  });
  api.setStreamEventBroadcaster(broadcaster);
  const auth = { validate: async () => ({ ok: true, value: { description: "dashboard", boundOrigin: null } }) };
  const gateway = new ApiGateway(
    api,
    auth as never,
    db as never,
    logger,
    resolveRegistrationPolicy({}),
    new ClientSessions(logger),
    null
  );
  server = createHttpServer({
    port: 0,
    hostname: "127.0.0.1",
    readiness: async () => ({}) as never,
    health: () => ({}) as never,
    logger,
    gateway,
    requestGuard: { allowedHosts: null, allowedOrigins: null, listedOrigins: null },
    onProcessingCallback: async () => {},
    barkloaderWebhookSecret: null,
  });

  const publish = (id: string) => {
    const event = {
      id,
      type: FOLLOW,
      source: "twitch",
      time: "2026-10-21T00:00:00.000Z",
      platform: "twitch",
      data: {},
    };
    handlers.get(FOLLOW)?.({ json: () => event } as unknown as Msg);
  };
  const notifyTriggerChange = (moduleName: string) =>
    (api as unknown as { notifyTriggerChange(name: string): Promise<void> }).notifyTriggerChange(moduleName);
  return { url: `ws://127.0.0.1:${server.port}/api`, broadcaster, publish, notifyTriggerChange };
}

function connect(url: string) {
  const gateway = newWebSocketRpcSession(url) as unknown as {
    authenticate(id: string, secret: string): Woofx3EngineApi;
  } & Disposable;
  const api = gateway.authenticate("dashboard", "secret");
  return { api, close: () => gateway[Symbol.dispose]() };
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("condition not met within 2s");
    }
    await Bun.sleep(5);
  }
}

class StreamListener extends RpcTarget {
  frames: StreamEventFrame[] = [];

  async onStreamEvent(frame: StreamEventFrame): Promise<void> {
    this.frames.push(frame);
  }
}

class TriggerListener extends RpcTarget {
  changes: string[] = [];

  async onTriggerChange(event: { type: string; moduleName: string }): Promise<void> {
    this.changes.push(event.moduleName);
  }
}

describe("push subscriptions over a WebSocket session", () => {
  test("stream events keep arriving after subscribeStreamEvents returns", async () => {
    const { url, publish } = await startEngine();
    const { api, close } = connect(url);
    const listener = new StreamListener();
    await api.subscribeStreamEvents(listener, [FOLLOW]);

    publish("evt-1");
    publish("evt-2");
    await until(() => listener.frames.length === 2);

    expect(listener.frames.map((frame) => frame.id)).toEqual(["evt-1", "evt-2"]);
    close();
  });

  test("a stream subscription is dropped when its socket closes", async () => {
    const { url, broadcaster } = await startEngine();
    const { api, close } = connect(url);
    await api.subscribeStreamEvents(new StreamListener(), [FOLLOW]);
    expect(broadcaster.subscriberCount).toBe(1);

    close();
    await until(() => broadcaster.subscriberCount === 0);
  });

  test("trigger changes keep arriving after subscribeTriggerChanges returns", async () => {
    const { url, notifyTriggerChange } = await startEngine();
    const { api, close } = connect(url);
    const listener = new TriggerListener();
    await api.subscribeTriggerChanges(listener);

    await notifyTriggerChange("chat-games");
    await notifyTriggerChange("alerts");
    await until(() => listener.changes.length === 2);

    expect(listener.changes).toEqual(["chat-games", "alerts"]);
    close();
  });
});
