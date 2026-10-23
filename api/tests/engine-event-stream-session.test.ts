import { afterEach, describe, expect, test } from "bun:test";
import type { EngineEventFrame, Woofx3EngineApi } from "@woofx3/api";
import { EngineEventType, EngineRequestType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import { Api } from "../src/api";
import { EngineEventStream } from "../src/engine-event-stream";
import { ClientSessions } from "../src/client-sessions";
import { ApiGateway } from "../src/gateway";
import { createHttpServer } from "../src/http";
import { resolveRegistrationPolicy } from "../src/registration";
import { TwitchTokenSource } from "../src/twitch-token-source";
import { WebhookClient } from "../src/webhook-client";

/*
 * The event stream end to end, over a real capnweb WebSocket session: what a
 * desktop client registered without a callback URL relies on.
 */

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as SharedLogger;

const GRANT = {
  userId: "42",
  accessToken: "from-the-stream",
  scope: ["chat:read"],
  expiresIn: 3600,
  obtainmentTimestamp: Date.now(),
  clientId: "desktop-app",
};

type Server = ReturnType<typeof createHttpServer>;
let server: Server | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

/** An engine whose only client, `local`, registered without a callback URL. */
async function startEngine() {
  const db = {
    listClients: async () => ({
      clients: [{ clientId: "local", description: "desktop", callbackUrl: "", callbackToken: "" }],
    }),
  };
  const api = new Api({
    db: db as never,
    nats: null,
    functions: null,
    barkloaderUrl: "http://b",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger,
  });
  const stream = new EngineEventStream(logger);
  api.setEngineEventStream(stream);
  const webhooks = new WebhookClient(db as never, logger, stream);
  api.setWebhookClient(webhooks);
  await webhooks.refreshCallbackUrls();
  const auth = { validate: async () => ({ kind: "accepted", description: "desktop", boundOrigin: null }) };
  const gateway = new ApiGateway(
    api,
    auth as never,
    db as never,
    logger,
    resolveRegistrationPolicy({}),
    new ClientSessions(logger)
  );
  server = createHttpServer({
    port: 0,
    hostname: "127.0.0.1",
    readiness: async () => ({}) as never,
    health: () => ({}) as never,
    logger,
    gateway,
    requestGuard: { allowedHosts: null, allowedOrigins: null },
    onProcessingCallback: async () => {},
    barkloaderWebhookSecret: null,
  });
  return { stream, webhooks, url: `ws://127.0.0.1:${server.port}/api` };
}

/** Collects frames, and answers each request with `answer` through `answerEngineRequest`. */
class Subscriber extends RpcTarget {
  frames: EngineEventFrame[] = [];
  private waiters: (() => void)[] = [];

  constructor(
    private readonly api: () => Woofx3EngineApi,
    private readonly answer: unknown
  ) {
    super();
  }

  async onEngineEvent(frame: EngineEventFrame): Promise<void> {
    this.frames.push(frame);
    for (const wake of this.waiters.splice(0)) {
      wake();
    }
    if (frame.kind === "request") {
      await this.api().answerEngineRequest(frame.envelope.id, { ok: true, body: this.answer });
    }
  }

  async next(count: number): Promise<EngineEventFrame[]> {
    while (this.frames.length < count) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    return this.frames;
  }
}

function connect(url: string) {
  const gateway = newWebSocketRpcSession(url) as unknown as {
    authenticate(id: string, secret: string): Woofx3EngineApi;
  } & Disposable;
  const api = gateway.authenticate("local", "secret");
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

describe("subscribeEngineEvents over a WebSocket session", () => {
  test("pushes the envelopes the callback URL would be sent", async () => {
    const { webhooks, url } = await startEngine();
    const { api, close } = connect(url);
    const subscriber = new Subscriber(() => api, null);
    await api.subscribeEngineEvents(subscriber);

    await webhooks.send({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" });
    const [frame] = await subscriber.next(1);

    expect(frame.kind).toBe("event");
    expect(frame.seq).toBe(1);
    expect(frame.envelope).toMatchObject({
      specversion: "1.0",
      type: EngineEventType.WORKFLOW_DELETED,
      data: { type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" },
    });
    close();
  });

  test("asks a client with no callback URL on its stream, and takes its answer", async () => {
    const { webhooks, url } = await startEngine();
    const { api, close } = connect(url);
    await api.subscribeEngineEvents(new Subscriber(() => api, { token: GRANT }));

    // The token names the client that sent it; that client is the one asked.
    let stored: string | null = JSON.stringify({ ...GRANT, accessToken: "stale", dashboardClientId: "local" });
    const settings = {
      getSetting: async () => stored,
      setSetting: async (_key: string, value: string) => {
        stored = value;
      },
    };
    const source = new TwitchTokenSource({
      db: settings,
      dashboard: () => webhooks,
      ownClientId: null,
      onLinkChanged: () => {},
      publicClient: {
        refresh: async () => {
          throw new Error("this test has no public Twitch app");
        },
      },
    });

    expect(await source.dashboardToken(true)).toEqual(GRANT);
    close();
  });

  test("drops the subscription when the socket closes, and fails a request in flight", async () => {
    const { stream, webhooks, url } = await startEngine();
    const { api, close } = connect(url);
    // Never answers, so the request is still waiting when the socket goes.
    const silent = new (class extends RpcTarget {
      async onEngineEvent(): Promise<void> {}
    })();
    await api.subscribeEngineEvents(silent);
    expect(stream.subscriberCount).toBe(1);

    const answered = webhooks.request({ type: EngineRequestType.TWITCH_TOKEN_REQUESTED }, "local");
    close();

    await expect(answered).rejects.toThrow("the event stream subscription closed");
    await until(() => stream.subscriberCount === 0);
    await expect(webhooks.request({ type: EngineRequestType.TWITCH_TOKEN_REQUESTED }, "local")).rejects.toThrow(
      "no registered dashboard with client id local"
    );
  });
});
