// The overlay page end to end: `createOverlay` run in a fake browser, with
// the DOM, fetch (and the event stream through it), timers, the runtime
// clock, the cross-tab coordinator and the console all injected, so what the
// page does is driven and read here rather than through a real browser.

import { describe, expect, it } from "bun:test";
import type { RenderAnimation, RenderStyle } from "@woofx3/scene/runtime";
import { generateNonce, type PageHost } from "@woofx3/widget-host/page";
import { encodeStreamFrame, type StreamFrame } from "../../contract/overlay-stream";
import type { SceneConfig } from "../../contract/scene-config";
import type { PageMarks } from "../../public/scene-manager/alert-timing";
import { createOverlay, type OverlayEnv } from "../../public/scene-manager/overlay";
import type { ReconnectCoordinator } from "../../public/scene-manager/reconnect-coordinator";

class FakeAnimation implements RenderAnimation {
  startTime: CSSNumberish | null = null;
  currentTime: CSSNumberish | null = null;
  pause(): void {}
  cancel(): void {}
}

class FakeElement {
  readonly style = {} as RenderStyle & { backgroundColor?: string };
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<() => void>>();
  readonly posted: unknown[] = [];
  readonly contentWindow = { postMessage: (message: unknown) => this.posted.push(message) };
  className = "";
  src = "";
  clientWidth = 1920;
  clientHeight = 1080;
  parent: FakeElement | null = null;

  constructor(readonly tag: string) {}

  appendChild(child: FakeElement): unknown {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parent !== null) {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  animate(): RenderAnimation {
    return new FakeAnimation();
  }

  /** Every element below this one, depth first. */
  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

/** Timers that run only when the test advances them. */
class FakeTimers {
  time = 1_000_000;
  private next = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void; every: number | null }>();

  setTimeout = (callback: () => void, ms: number): number => this.add(callback, ms, null);
  setInterval = (callback: () => void, ms: number): number => this.add(callback, ms, ms);
  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };
  now = (): number => this.time;

  private add(callback: () => void, ms: number, every: number | null): number {
    const handle = this.next++;
    this.timers.set(handle, { at: this.time + ms, callback, every });
    return handle;
  }

  async advance(ms: number): Promise<void> {
    const until = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= until).sort(([, a], [, b]) => a.at - b.at)[0];
      if (due === undefined) {
        break;
      }
      const [handle, timer] = due;
      this.time = Math.max(this.time, timer.at);
      if (timer.every === null) {
        this.timers.delete(handle);
      } else {
        timer.at += timer.every;
      }
      timer.callback();
      await settle();
    }
    this.time = until;
    await settle();
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** One open `/events` stream the test writes server-sent events into. */
class FakeStream {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  readonly response: Response;

  constructor() {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.response = new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  async send(frame: StreamFrame): Promise<void> {
    this.controller?.enqueue(new TextEncoder().encode(encodeStreamFrame(frame)));
    await settle();
  }

  async end(): Promise<void> {
    this.controller?.close();
    await settle();
  }
}

const SCENE: SceneConfig = {
  id: "s1",
  name: "Main",
  layout: { width: 1920, height: 1080 },
  widgets: [
    {
      id: "w1",
      widgetCanonicalId: "woofx3:widget:text",
      moduleId: "woofx3",
      position: { x: 10, y: 20, width: 300, height: 100 },
      settings: { text: "hi" },
      hostsSurface: "",
      frameUrl: "/frames/woofx3/text?v=1",
    },
    {
      id: "a1",
      widgetCanonicalId: "woofx3:widget:alert",
      moduleId: "woofx3",
      position: { x: 0, y: 0, width: 800, height: 600 },
      settings: { name: "default" },
      hostsSurface: "alert",
      frameUrl: "",
    },
  ],
};

/** Every byte 7: every frame's nonce is the same, and known. */
const randomBytes = (length: number) => new Uint8Array(length).fill(7);
const NONCE = generateNonce(randomBytes);

function setup(options: { refreshStatus?: number } = {}) {
  const timers = new FakeTimers();
  const warnings: unknown[][] = [];
  const host: PageHost = {
    timers,
    log: { warn: (...args: unknown[]) => warnings.push(args) },
    randomBytes,
  };
  const streams: FakeStream[] = [];
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    if (url.endsWith("/scene/s1/events")) {
      const stream = new FakeStream();
      streams.push(stream);
      return stream.response;
    }
    if (url.endsWith("/session/refresh")) {
      return new Response(null, { status: options.refreshStatus ?? 200 });
    }
    return new Response("{}", { status: 200 });
  };
  const listeners: Array<(event: MessageEvent) => void> = [];
  const window = {
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.push(listener),
    parent: null as unknown,
  };
  window.parent = window;
  const reloads: string[] = [];
  const peerReloads: string[] = [];
  const coordinator: ReconnectCoordinator = {
    shouldProbe: () => true,
    onDisconnected: () => {},
    onConnected: () => {},
    onPeerConnected: () => {},
    requestPeerReload: () => peerReloads.push("reload"),
    onPeerReload: () => {},
    stop: () => {},
  };
  const connected: boolean[] = [];
  const marked: string[] = [];
  const marks: PageMarks = {
    mark: (name) => marked.push(name),
    measure: (name) => marked.push(name),
    clear: () => {},
  };
  const body = new FakeElement("body");
  const root = new FakeElement("div");
  const document = {
    body,
    timeline: { currentTime: 0 },
    createElement: (tag: string) => new FakeElement(tag),
  };
  const env: OverlayEnv = {
    scene: structuredClone(SCENE),
    // At the sequence every stream's hello below reports, so the page has no reason to fetch the scene.
    sceneDocument: { sceneId: "s1", name: "Main", seq: 0, doc: { layout: {}, widgets: {}, behaviors: {} }, meta: {} },
    document: document as unknown as Document,
    root: root as unknown as HTMLElement,
    location: {
      search: "?token=tok-1",
      href: "https://sm.test/scene/s1?token=tok-1",
      origin: "https://sm.test",
      reload: () => reloads.push("reload"),
    },
    window: window as unknown as OverlayEnv["window"],
    framed: false,
    fetch: fetchFn,
    renderConnected: (value) => connected.push(value),
    host,
    clock: {
      now: () => timers.time,
      setTimer: (atMs, callback) => timers.setTimeout(callback, Math.max(0, atMs - timers.time)),
      clearTimer: (handle) => timers.clearTimeout(handle),
    },
    coordinator,
    marks,
  };
  createOverlay(env);
  const frames = () => root.descendants().filter((element) => element.tag === "iframe");
  /** A message from a frame's document, as the bridge receives it. */
  const fromFrame = (frame: FakeElement, message: Record<string, unknown>) => {
    const event = { source: frame.contentWindow, data: { proto: "woofx3.widget", v: 1, nonce: NONCE, ...message } };
    for (const listener of listeners) {
      listener(event as unknown as MessageEvent);
    }
  };
  return { env, timers, warnings, streams, requests, reloads, peerReloads, connected, marked, body, frames, fromFrame };
}

describe("an overlay page", () => {
  it("fills each placement's slot: a sandboxed frame booted with its placement, or an alert area", async () => {
    const page = setup();
    await settle();

    const frames = page.frames();
    expect(frames).toHaveLength(1);
    expect(frames[0]!.attributes.get("sandbox")).toBe("allow-scripts");
    expect(frames[0]!.src.startsWith("/frames/woofx3/text?v=1#")).toBe(true);
    expect(page.warnings).toEqual([]);
  });

  it("shows itself connected once the stream opens, and disconnected when it drops", async () => {
    const page = setup();
    await settle();
    await page.streams[0]!.send({ kind: "hello", bootId: "boot-1", seq: 0, draftSeq: 0 });
    expect(page.connected.at(-1)).toBe(true);

    await page.streams[0]!.end();

    expect(page.connected.at(-1)).toBe(false);
  });

  it("delivers a streamed event to the widget that subscribed, then acknowledges it delivered", async () => {
    const page = setup();
    await settle();
    const frame = page.frames()[0]!;
    page.fromFrame(frame, { type: "hello", instanceId: "w1", sdkVersion: "test" });
    page.fromFrame(frame, { type: "events.subscribe", subId: "sub-1" });
    await page.streams[0]!.send({ kind: "hello", bootId: "boot-1", seq: 0, draftSeq: 0 });

    await page.streams[0]!.send({
      kind: "delivery",
      frame: { eventId: "ev-1", instanceId: "w1", type: "follow", key: "", value: { user: "sam" } },
    });
    await page.timers.advance(1_000);

    const event = frame.posted.find((message) => (message as { type?: string }).type === "event.deliver") as
      | { subId: string; event: { eventId: string; time: string } }
      | undefined;
    expect(event?.subId).toBe("sub-1");
    expect(event?.event.eventId).toBe("ev-1");
    // Stamped by the injected clock, not the browser's.
    expect(Date.parse(event!.event.time)).toBeLessThanOrEqual(page.timers.time);
    expect(Date.parse(event!.event.time)).toBeGreaterThanOrEqual(1_000_000);
    const ack = page.requests.find((request) => request.url.includes("/delivered"));
    expect(ack?.method).toBe("POST");
    expect(ack?.url).toContain("ev-1");
  });

  it("marks each step of an alert, from its delivery to its widget's first paint", async () => {
    const page = setup();
    await settle();
    await page.streams[0]!.send({ kind: "hello", bootId: "boot-1", seq: 0, draftSeq: 0 });
    const layout = {
      layout: { width: 800, height: 600 },
      widgets: {
        t1: {
          widget: "woofx3:widget:text",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          visible: true,
          z: "a1",
          settings: {},
          name: "",
          rotation: 0,
          opacity: 1,
          locked: false,
          extra: {},
        },
      },
      behaviors: {},
    };

    await page.streams[0]!.send({
      kind: "delivery",
      frame: { eventId: "ev-9", instanceId: "a1", type: "alert", key: "alert-9", value: { layout, event: null } },
    });
    await page.timers.advance(10);
    const frame = page.frames().find((element) => element.src.includes("/alert/ev-9/"))!;
    page.fromFrame(frame, { type: "hello", instanceId: "ev-9.t1", sdkVersion: "test" });
    page.fromFrame(frame, { type: "events.subscribe", subId: "sub-1" });
    page.fromFrame(frame, { type: "rendered" });

    expect(page.marked).toEqual([
      "woofx3.alert/ev-9/a1/delivered",
      "woofx3.alert/ev-9/a1/started",
      "woofx3.alert/ev-9/a1/t1/mounted",
      "woofx3.alert/ev-9/a1/t1/ready",
      "woofx3.alert/ev-9/a1/t1/subscribed",
      "woofx3.alert/ev-9/a1/t1/rendered",
      "woofx3.alert/ev-9/a1/on-screen",
    ]);
  });

  it("reloads, telling the other overlays first, when the server it reconnects to has restarted", async () => {
    const page = setup();
    await settle();
    await page.streams[0]!.send({ kind: "hello", bootId: "boot-1", seq: 0, draftSeq: 0 });
    await page.streams[0]!.end();

    await page.timers.advance(10_000);
    expect(page.streams).toHaveLength(2);
    await page.streams[1]!.send({ kind: "hello", bootId: "boot-2", seq: 0, draftSeq: 0 });

    expect(page.peerReloads).toEqual(["reload"]);
    expect(page.reloads).toEqual(["reload"]);
  });

  it("renews its session with the overlay token on the injected timers", async () => {
    const page = setup();
    await settle();

    await page.timers.advance(50_000);

    const renewal = page.requests.find((request) => request.url.endsWith("/session/refresh"));
    expect(renewal?.method).toBe("POST");
    expect(JSON.parse(renewal!.body!)).toEqual({ token: "tok-1" });
    expect(page.reloads).toEqual([]);
  });

  it("reloads alone when its session can no longer be renewed", async () => {
    const page = setup({ refreshStatus: 401 });
    await settle();

    await page.timers.advance(50_000);

    expect(page.reloads).toEqual(["reload"]);
    expect(page.peerReloads).toEqual([]);
  });
});
