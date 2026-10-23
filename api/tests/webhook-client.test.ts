import { describe, expect, it, mock } from "bun:test";
import type { EngineEventFrame } from "@woofx3/api";
import { EngineEventType, EngineRequestType } from "@woofx3/api/webhooks";
import { EngineEventStream } from "../src/engine-event-stream";
import {
  callbackUrlRefusal,
  DEFAULT_WEBHOOK_CLIENT_CONFIG,
  WebhookClient,
  type WebhookClientConfig,
} from "../src/webhook-client";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function fakeDb(clients: any[] = []) {
  return { listClients: mock(async () => ({ clients })) } as any;
}

function webhookClient(
  db: ConstructorParameters<typeof WebhookClient>[0],
  logger: ConstructorParameters<typeof WebhookClient>[1],
  stream: EngineEventStream,
  config: WebhookClientConfig = DEFAULT_WEBHOOK_CLIENT_CONFIG
): WebhookClient {
  return new WebhookClient(db, logger, stream, config);
}

describe("WebhookClient", () => {
  it("does not read clients until asked to refresh", () => {
    const db = fakeDb();
    webhookClient(db, fakeLogger(), new EngineEventStream(fakeLogger()));
    expect(db.listClients).not.toHaveBeenCalled();
  });

  it("refreshCallbackUrls lists every client and sends only to those with a callback", async () => {
    const db = fakeDb([
      { clientId: "c1", description: "d", callbackUrl: "https://x.example", callbackToken: "" },
      { clientId: "c2", description: "headless", callbackUrl: "", callbackToken: "" },
    ]);
    const logger = fakeLogger();
    const wc = webhookClient(db, logger, new EngineEventStream(logger));
    await wc.refreshCallbackUrls();
    expect(db.listClients).toHaveBeenCalledWith();
    expect(logger.info).toHaveBeenCalledWith("Webhook callback URLs refreshed", { count: 1 });
  });

  it("refreshCallbackUrls skips a stored callback URL that is no longer accepted, with a warning", async () => {
    const db = fakeDb([
      { clientId: "old", description: "d", callbackUrl: "http://internal.example/hook", callbackToken: "" },
      { clientId: "good", description: "d", callbackUrl: "https://x.example", callbackToken: "" },
    ]);
    const logger = fakeLogger();
    const wc = webhookClient(db, logger, new EngineEventStream(logger));
    await wc.refreshCallbackUrls();
    expect(wc.clientIds()).toEqual(["good"]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping a client whose stored callback URL is no longer accepted",
      expect.objectContaining({ clientId: "old" })
    );
  });
});

describe("callbackUrlRefusal", () => {
  const cases: [string, boolean][] = [
    ["https://example.convex.site/api/webhooks/woofx3", true],
    ["http://127.0.0.1:3000/callback", true],
    ["http://localhost:3000/callback", true],
    ["http://[::1]:3000/callback", true],
    ["file:///etc/passwd", false],
    ["http://internal.example/callback", false],
    ["http://10.0.0.5/callback", false],
    ["https://user:pass@example.com/callback", false],
    ["https://example.com/callback#frag", false],
    ["https://example.com/callback#", false],
    ["ftp://example.com/callback", false],
    ["not a url", false],
  ];
  for (const [url, accepted] of cases) {
    it(`${accepted ? "accepts" : "refuses"} ${url}`, () => {
      expect(callbackUrlRefusal(url) === null).toBe(accepted);
    });
  }
});

describe("WebhookClient callback POSTs", () => {
  const fastConfig: WebhookClientConfig = { ...DEFAULT_WEBHOOK_CLIENT_CONFIG, retryDelayMs: 1 };

  it("does not follow a redirect, so the event and token never reach the redirect target", async () => {
    let targetHits = 0;
    const target = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        targetHits += 1;
        return new Response(null, { status: 204 });
      },
    });
    let callbackHits = 0;
    const callback = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        callbackHits += 1;
        return new Response(null, { status: 307, headers: { location: `http://127.0.0.1:${target.port}/stolen` } });
      },
    });
    try {
      const logger = fakeLogger();
      const wc = webhookClient(
        fakeDb([
          {
            clientId: "c",
            description: "d",
            callbackUrl: `http://127.0.0.1:${callback.port}/hook`,
            callbackToken: "secret",
          },
        ]),
        logger,
        new EngineEventStream(logger),
        fastConfig
      );
      await wc.refreshCallbackUrls();

      await wc.send({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" });
      await expect(wc.request(TOKEN_REQUEST, "c")).rejects.toThrow();

      expect(callbackHits).toBe(3);
      expect(targetHits).toBe(0);
    } finally {
      callback.stop(true);
      target.stop(true);
    }
  });

  it("refuses a request answer larger than the response cap", async () => {
    const big = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.json({ padding: "x".repeat(2048) });
      },
    });
    try {
      const logger = fakeLogger();
      const wc = webhookClient(
        fakeDb([{ clientId: "c", description: "d", callbackUrl: `http://127.0.0.1:${big.port}/`, callbackToken: "" }]),
        logger,
        new EngineEventStream(logger),
        { ...fastConfig, maxResponseBytes: 1024 }
      );
      await wc.refreshCallbackUrls();

      await expect(wc.request(TOKEN_REQUEST, "c")).rejects.toThrow("more than 1024 bytes");
    } finally {
      big.stop(true);
    }
  });

  it("times out a callback that sends its headers and then stalls the body", async () => {
    const stalled = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
          },
        });
        return new Response(body, { headers: { "content-type": "application/json" } });
      },
    });
    try {
      const logger = fakeLogger();
      const wc = webhookClient(
        fakeDb([
          { clientId: "c", description: "d", callbackUrl: `http://127.0.0.1:${stalled.port}/`, callbackToken: "" },
        ]),
        logger,
        new EngineEventStream(logger),
        { ...fastConfig, timeoutMs: 50 }
      );
      await wc.refreshCallbackUrls();

      const started = performance.now();
      await expect(wc.request(TOKEN_REQUEST, "c")).rejects.toThrow();
      // Three attempts of 50 ms each, plus slack; without the body under the timeout it never settles.
      expect(performance.now() - started).toBeLessThan(2_000);
    } finally {
      stalled.stop(true);
    }
  });
});

/** A callback URL on 127.0.0.1 that answers every POST with `answer`, recording the bodies. */
function callbackServer(answer: unknown) {
  const received: { type: string; id: string }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      received.push((await req.json()) as { type: string; id: string });
      return Response.json(answer);
    },
  });
  return { url: `http://127.0.0.1:${server.port}/callback`, received, stop: () => server.stop(true) };
}

/** A stream subscriber that answers every request with `body`, recording every frame. */
function answeringSubscriber(stream: EngineEventStream, clientId: string, body: unknown) {
  const frames: EngineEventFrame[] = [];
  const subscriber = {
    async onEngineEvent(frame: EngineEventFrame) {
      frames.push(frame);
      if (frame.kind === "request") {
        stream.answer(clientId, frame.envelope.id, { ok: true, body });
      }
    },
  };
  stream.subscribe(subscriber, undefined, {}, clientId);
  return frames;
}

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

const TOKEN_REQUEST = { type: EngineRequestType.TWITCH_TOKEN_REQUESTED } as const;

describe("WebhookClient routing", () => {
  it("asks a client with a callback URL over HTTP, even while it has a stream subscription", async () => {
    const http = callbackServer({ via: "http" });
    try {
      const logger = fakeLogger();
      const stream = new EngineEventStream(logger);
      const wc = webhookClient(
        fakeDb([{ clientId: "cloud", description: "d", callbackUrl: http.url, callbackToken: "" }]),
        logger,
        stream
      );
      await wc.refreshCallbackUrls();
      const frames = answeringSubscriber(stream, "cloud", { via: "stream" });

      expect(await wc.request(TOKEN_REQUEST, "cloud")).toEqual({ via: "http" });
      expect(http.received.map((r) => r.type)).toEqual([EngineRequestType.TWITCH_TOKEN_REQUESTED]);
      expect(frames).toHaveLength(0);
    } finally {
      http.stop();
    }
  });

  it("asks a client with no callback URL on its stream subscription", async () => {
    const logger = fakeLogger();
    const stream = new EngineEventStream(logger);
    const wc = webhookClient(
      fakeDb([{ clientId: "local", description: "desktop", callbackUrl: "", callbackToken: "" }]),
      logger,
      stream
    );
    await wc.refreshCallbackUrls();
    const frames = answeringSubscriber(stream, "local", { via: "stream" });

    expect(await wc.request(TOKEN_REQUEST, "local")).toEqual({ via: "stream" });
    expect(frames.map((f) => [f.kind, f.envelope.type])).toEqual([
      ["request", EngineRequestType.TWITCH_TOKEN_REQUESTED],
    ]);
  });

  it("refuses a request for a client reachable neither way, as before", async () => {
    const logger = fakeLogger();
    const wc = webhookClient(fakeDb(), logger, new EngineEventStream(logger));
    await wc.refreshCallbackUrls();

    await expect(wc.request(TOKEN_REQUEST, "local")).rejects.toThrow("no registered dashboard with client id local");
  });

  it("offers stream-only clients after those with a callback URL", async () => {
    const logger = fakeLogger();
    const stream = new EngineEventStream(logger);
    const wc = webhookClient(
      fakeDb([{ clientId: "cloud", description: "d", callbackUrl: "https://x.example", callbackToken: "" }]),
      logger,
      stream
    );
    await wc.refreshCallbackUrls();
    answeringSubscriber(stream, "local", null);
    answeringSubscriber(stream, "cloud", null);

    expect(wc.clientIds()).toEqual(["cloud", "local"]);
  });

  it("sends one envelope to the callback URL and the stream alike", async () => {
    const http = callbackServer({});
    try {
      const logger = fakeLogger();
      const stream = new EngineEventStream(logger);
      const wc = webhookClient(
        fakeDb([{ clientId: "cloud", description: "d", callbackUrl: http.url, callbackToken: "" }]),
        logger,
        stream
      );
      await wc.refreshCallbackUrls();
      const cloudFrames = answeringSubscriber(stream, "cloud", null);
      const localFrames = answeringSubscriber(stream, "local", null);

      await wc.send({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" });
      await settle();

      expect(http.received).toHaveLength(1);
      expect(cloudFrames.map((f) => f.envelope)).toEqual([http.received[0] as never]);
      expect(localFrames.map((f) => f.envelope.id)).toEqual([http.received[0].id]);
    } finally {
      http.stop();
    }
  });

  it("sends an event for one client to that client's stream alone", async () => {
    const logger = fakeLogger();
    const stream = new EngineEventStream(logger);
    const wc = webhookClient(fakeDb(), logger, stream);
    await wc.refreshCallbackUrls();
    const mine = answeringSubscriber(stream, "local", null);
    const theirs = answeringSubscriber(stream, "other", null);

    await wc.send({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" }, "local");
    await settle();

    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("refuses an empty target client id instead of broadcasting it over either transport", async () => {
    const http = callbackServer(null);
    try {
      const logger = fakeLogger();
      const stream = new EngineEventStream(logger);
      const wc = webhookClient(
        fakeDb([{ clientId: "cloud", description: "cloud", callbackUrl: http.url, callbackToken: "" }]),
        logger,
        stream
      );
      await wc.refreshCallbackUrls();
      const frames = answeringSubscriber(stream, "local", null);

      await expect(wc.send({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" }, "")).rejects.toThrow(
        "targetClientId is empty"
      );
      await settle();

      expect(http.received).toHaveLength(0);
      expect(frames).toHaveLength(0);
    } finally {
      http.stop();
    }
  });

  it("warns when an event reaches nobody", async () => {
    const logger = fakeLogger();
    const wc = webhookClient(fakeDb(), logger, new EngineEventStream(logger));
    await wc.refreshCallbackUrls();

    await wc.send({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" });

    expect(logger.warn).toHaveBeenCalledWith(
      "WebhookClient.send: no callback URL or event stream subscription to deliver to",
      expect.objectContaining({ eventType: EngineEventType.WORKFLOW_DELETED })
    );
  });
});
