import { describe, expect, it, mock } from "bun:test";
import type { EngineEventFrame } from "@woofx3/api";
import { EngineEventType, EngineRequestType } from "@woofx3/api/webhooks";
import { EngineEventStream } from "../src/engine-event-stream";
import { WebhookClient } from "../src/webhook-client";

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

describe("WebhookClient", () => {
  it("does not read clients until asked to refresh", () => {
    const db = fakeDb();
    new WebhookClient(db, fakeLogger(), new EngineEventStream(fakeLogger()));
    expect(db.listClients).not.toHaveBeenCalled();
  });

  it("refreshCallbackUrls lists every client and sends only to those with a callback", async () => {
    const db = fakeDb([
      { clientId: "c1", description: "d", callbackUrl: "http://x", callbackToken: "" },
      { clientId: "c2", description: "headless", callbackUrl: "", callbackToken: "" },
    ]);
    const logger = fakeLogger();
    const wc = new WebhookClient(db, logger, new EngineEventStream(logger));
    await wc.refreshCallbackUrls();
    expect(db.listClients).toHaveBeenCalledWith();
    expect(logger.info).toHaveBeenCalledWith("Webhook callback URLs refreshed", { count: 1 });
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
      const wc = new WebhookClient(
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
    const wc = new WebhookClient(
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
    const wc = new WebhookClient(fakeDb(), logger, new EngineEventStream(logger));
    await wc.refreshCallbackUrls();

    await expect(wc.request(TOKEN_REQUEST, "local")).rejects.toThrow("no registered dashboard with client id local");
  });

  it("offers stream-only clients after those with a callback URL", async () => {
    const logger = fakeLogger();
    const stream = new EngineEventStream(logger);
    const wc = new WebhookClient(
      fakeDb([{ clientId: "cloud", description: "d", callbackUrl: "http://x", callbackToken: "" }]),
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
      const wc = new WebhookClient(
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
    const wc = new WebhookClient(fakeDb(), logger, stream);
    await wc.refreshCallbackUrls();
    const mine = answeringSubscriber(stream, "local", null);
    const theirs = answeringSubscriber(stream, "other", null);

    await wc.send({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" }, "local");
    await settle();

    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns when an event reaches nobody", async () => {
    const logger = fakeLogger();
    const wc = new WebhookClient(fakeDb(), logger, new EngineEventStream(logger));
    await wc.refreshCallbackUrls();

    await wc.send({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" });

    expect(logger.warn).toHaveBeenCalledWith(
      "WebhookClient.send: no callback URL or event stream subscription to deliver to",
      expect.objectContaining({ eventType: EngineEventType.WORKFLOW_DELETED })
    );
  });
});
