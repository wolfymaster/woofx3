// The scene manager as one running service: its real composition root and
// HTTP server on a port the OS picks, and the engine's real message bus.
// Each case goes through the network the way an overlay, the dashboard or
// the engine does, so what unit tests cover piece by piece is checked here
// as it is put together: routing and its error shapes, the overlay session,
// frames from barkloader, the event stream, and engine events arriving over
// the bus as deliveries on an open overlay.
//
// The bus is a Go program. CI builds it and the suite must run there; on a
// machine without Go the suite is skipped and says so.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createMessageBus } from "@woofx3/nats";
import type NATSClient from "@woofx3/nats/src/client";
import { MEDIA_PROXY_PATH } from "../../contract/media-url";
import { parseStreamFrame, type StreamFrame } from "../../contract/overlay-stream";
import { BootFailure, type BootedSceneManager, bootSceneManager } from "./boot";
import { ALERT_AREA_ID, OVERLAY_TOKEN, SCENE_ID, TEXT_ID } from "./fake-db";
import { type MessageBus, startMessageBus } from "./message-bus";

const started = await startMessageBus();
if (!started.ok) {
  if (process.env.CI) {
    throw new Error(`smoke: the message bus is required in CI: ${started.reason}`);
  }
  console.warn(`[smoke] skipped: ${started.reason}`);
}

/** An open overlay event stream, read frame by frame. */
class OverlayStream {
  private readonly frames: StreamFrame[] = [];
  private readonly abort = new AbortController();
  private buffer = "";

  private constructor() {}

  static async open(baseUrl: string, cookie: string): Promise<OverlayStream> {
    const stream = new OverlayStream();
    const response = await fetch(`${baseUrl}/scene/${SCENE_ID}/events`, {
      headers: { Cookie: cookie, Accept: "text/event-stream" },
      signal: stream.abort.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    void stream.read(response.body!);
    return stream;
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of body) {
        this.buffer += decoder.decode(chunk, { stream: true });
        let end = this.buffer.indexOf("\n\n");
        while (end >= 0) {
          const frame = parseStreamFrame(this.buffer.slice(0, end));
          if (frame !== null) {
            this.frames.push(frame);
          }
          this.buffer = this.buffer.slice(end + 2);
          end = this.buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Aborted by close().
    }
  }

  async next(kind: StreamFrame["kind"], timeoutMs = 5000): Promise<StreamFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const at = this.frames.findIndex((frame) => frame.kind === kind);
      if (at >= 0) {
        return this.frames.splice(at, 1)[0]!;
      }
      if (Date.now() > deadline) {
        throw new Error(`smoke: no ${kind} frame within ${timeoutMs} ms; saw ${this.frames.map((f) => f.kind)}`);
      }
      await Bun.sleep(20);
    }
  }

  close(): void {
    this.abort.abort();
  }
}

/** The scene manager's last log lines, for a failure to say what it was doing. */
function recentLogs(booted: BootedSceneManager): string {
  return JSON.stringify(booted.logs.filter((l) => l.level !== "debug").slice(-15));
}

describe.skipIf(!started.ok)("scene manager smoke", () => {
  const bus = started.ok ? started.bus : (null as unknown as MessageBus);
  let sm: BootedSceneManager;
  let engine: NATSClient;
  let cookie = "";

  beforeAll(async () => {
    sm = await bootSceneManager(bus.url);
    engine = await createMessageBus({ url: bus.url, name: "smoke-engine" });
    await engine.connect();
    // The overlay's session, as a page load mints it; each case below that
    // acts as the overlay uses it.
    const shell = await fetch(`${sm.baseUrl}/scene/${SCENE_ID}?token=${OVERLAY_TOKEN}`);
    cookie = (shell.headers.get("set-cookie") ?? "").split(";")[0]!;
    await shell.text();
  });

  afterAll(async () => {
    await engine?.close();
    await sm?.stop();
    await bus.stop();
  });

  it("starts with the bus connected and its subscriptions in place", () => {
    const messages = sm.logs.map((l) => l.message);
    expect(messages).toContain("sceneManager listening");
    expect(messages).toContain("Subscribed to ui.notify.alert");
    expect(messages.some((m) => m.includes("NATS connection failed"))).toBe(false);
  });

  it("answers health, and refuses unknown paths and wrong methods in its error shapes", async () => {
    const health = await fetch(`${sm.baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const missing = await fetch(`${sm.baseUrl}/no/such/path`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");

    const wrongMethod = await fetch(`${sm.baseUrl}/health`, { method: "DELETE" });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toContain("GET");
  });

  it("answers a wrong method on every kind of route with 405 and the methods it takes", async () => {
    for (const [method, path, allow] of [
      ["DELETE", "/assets/widget-host-shim.js", "GET"],
      ["POST", "/assets/read/user/u1/clip.json", "GET"],
      ["PUT", "/assets/user/u1/clip.json", "GET"],
      ["GET", "/assets/upload/some-grant", "PUT"],
      ["DELETE", "/fonts/css", "GET"],
      ["POST", `${MEDIA_PROXY_PATH}some-token`, "GET"],
    ] as const) {
      const response = await fetch(`${sm.baseUrl}${path}`, { method });
      expect(`${method} ${path} ${response.status}`).toBe(`${method} ${path} 405`);
      expect(response.headers.get("allow")).toContain(allow);
    }
  });

  it("refuses an overlay with a token that resolves to no scene", async () => {
    const response = await fetch(`${sm.baseUrl}/scene/${SCENE_ID}?token=not-a-token`);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("serves the overlay shell for a valid token, with a session and the scene baked in", async () => {
    const response = await fetch(`${sm.baseUrl}/scene/${SCENE_ID}?token=${OVERLAY_TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toStartWith(`sm_session_${SCENE_ID}=`);
    const html = await response.text();
    expect(html).toContain("__WOOFX3_SCENE__");
    expect(html).toContain(TEXT_ID);
  });

  it("answers the session's config and refresh, and nothing without the session", async () => {
    const config = await fetch(`${sm.baseUrl}/scene/${SCENE_ID}/config`, { headers: { Cookie: cookie } });
    expect(config.status).toBe(200);
    const body = (await config.json()) as { scene: { id: string; widgets: Array<{ id: string }> } };
    expect(body.scene.id).toBe(SCENE_ID);
    expect(body.scene.widgets.map((w) => w.id).sort()).toEqual([ALERT_AREA_ID, TEXT_ID].sort());

    const refreshed = await fetch(`${sm.baseUrl}/scene/${SCENE_ID}/session/refresh`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get("set-cookie")).toBeTruthy();

    const anonymous = await fetch(`${sm.baseUrl}/scene/${SCENE_ID}/config`);
    expect(anonymous.status).toBe(401);
  });

  it("serves a widget's frame from barkloader, sandboxed and with no network of its own", async () => {
    const response = await fetch(`${sm.baseUrl}/frames/woofx3/text?v=1`);
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("sandbox allow-scripts");
    expect(await response.text()).toContain('data-widget="text"');
    expect(sm.barkloader.frames).toContain("woofx3/text");
  });

  it("refuses an acknowledgement body over its limit", async () => {
    const response = await fetch(`${sm.baseUrl}/scene/${SCENE_ID}/events/evt-x/delivered`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ instanceIds: ["x".repeat(32 * 1024)] }),
    });
    expect(response.status).toBe(413);
  });

  it("opens the event stream with a hello naming this process, and the scene's open deliveries", async () => {
    const stream = await OverlayStream.open(sm.baseUrl, cookie);
    try {
      const hello = await stream.next("hello");
      expect(hello.kind === "hello" && hello.bootId.length > 0).toBe(true);
      const openSet = await stream.next("open-set");
      expect(openSet.kind === "open-set" && openSet.frame.deliveries).toEqual({});
    } finally {
      stream.close();
    }
  });

  it("delivers an alert the engine publishes on the bus to the open overlay's alert area", async () => {
    const stream = await OverlayStream.open(sm.baseUrl, cookie);
    try {
      await stream.next("hello");
      await engine.publish(
        "ui.notify.alert",
        new TextEncoder().encode(
          JSON.stringify({
            id: "env-smoke",
            parameters: {
              target: "default",
              layout: {
                width: 1920,
                height: 1080,
                widgets: [
                  { id: "t1", widgetCanonicalId: "woofx3:widget:text", position: { x: 0, y: 0 }, settings: {} },
                ],
              },
            },
            event: { type: "channel.raid", data: { raiders: 50 } },
          })
        )
      );
      const delivery = await stream.next("delivery").catch((err: unknown) => {
        throw new Error(`${err instanceof Error ? err.message : String(err)}; last logs: ${recentLogs(sm)}`);
      });
      expect(delivery.kind).toBe("delivery");
      const frame = (delivery as Extract<StreamFrame, { kind: "delivery" }>).frame;
      expect(frame.instanceId).toBe(ALERT_AREA_ID);
      expect(frame.value).toMatchObject({ alertId: "env-smoke", event: { type: "channel.raid" } });
      expect(sm.db.sceneEvents.length).toBeGreaterThan(0);

      const ack = await fetch(`${sm.baseUrl}/scene/${SCENE_ID}/events/${frame.eventId}/delivered`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ instanceIds: [ALERT_AREA_ID] }),
      });
      expect(ack.status).toBeLessThan(300);
    } finally {
      stream.close();
    }
  }, 20_000);

  it("pushes a module storage change from the bus to an overlay whose widget reads the key", async () => {
    sm.db.storage.set("woofx3:count", 3);
    const stream = await OverlayStream.open(sm.baseUrl, cookie);
    try {
      await stream.next("hello");
      const read = await fetch(`${sm.baseUrl}/scene/${SCENE_ID}/widget/${TEXT_ID}/storage?key=count`, {
        headers: { Cookie: cookie },
      });
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual({ value: 3 });

      await engine.publish(
        "module.storage.woofx3.changed",
        new TextEncoder().encode(JSON.stringify({ data: { moduleId: "woofx3", key: "count", value: 4 } }))
      );
      const change = await stream.next("module-state");
      expect(change.kind === "module-state" && change.frame).toEqual({ moduleId: "woofx3", key: "count", value: 4 });
    } finally {
      stream.close();
    }
  }, 20_000);

  it("answers the operator's skip as a request over the bus, by whether an overlay is open", async () => {
    const skip = async () => {
      const reply = await engine.request("widget.queue.skip", new TextEncoder().encode("{}"), { timeout: 5000 });
      return JSON.parse(new TextDecoder().decode(reply.data)) as Record<string, unknown>;
    };
    expect(await skip()).toEqual({ ok: false, skipped: 0, reason: "no overlay is open" });
    const stream = await OverlayStream.open(sm.baseUrl, cookie);
    try {
      await stream.next("hello");
      expect(await skip()).toEqual({ ok: true, skipped: 0 });
    } finally {
      stream.close();
    }
  }, 20_000);

  it("releases its bus connection when a start fails part way, as on a port already taken", async () => {
    const port = Number(new URL(sm.baseUrl).port);
    const failure = await bootSceneManager(bus.url, { port }).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(BootFailure);
    const messages = (failure as BootFailure).logs.map((l) => l.message);
    expect(messages).toContain("Connected to NATS");
    expect(messages).toContain("NATS connection closed");
  }, 20_000);

  it("asks the database for nothing it was not expected to", () => {
    expect(sm.db.unexpected).toEqual([]);
    const errors = sm.logs.filter((l) => l.level === "error");
    expect(errors).toEqual([]);
  });
});
