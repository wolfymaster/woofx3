// The preview page's widget against the real widget host shim: each frame the
// page mounts boots the shim in a simulated window, from the boot payload the
// server inlines and the placement the page puts in the fragment, and
// messages cross between them as postMessage carries them.

import { describe, expect, it } from "bun:test";
import { type DeliveredWidgetEvent, PROTOCOL_VERSION, type WidgetHost, type WidgetSurface } from "@woofx3/module-sdk";
import { installWidgetHostShim, type ShimMessageEvent, type ShimWindow } from "@woofx3/module-sdk/src/widget-host-shim";
import type { WidgetFrameBoot } from "../frame";
import { AssetCache, EventQueueManager, type WidgetBridge } from "../page";
import { PreviewFrame, type PreviewLogEntry } from "../preview/page/preview-frame";
import { PreviewStorage } from "../preview/page/preview-storage";

const ORIGIN = "http://preview.test";
const RESOURCE_BASE_URL = `${ORIGIN}/assets/modules/mod/preview/widgets/w/`;

/** What the server inlines into the widget's frame document. */
const FRAME_BOOT: WidgetFrameBoot = {
  v: PROTOCOL_VERSION,
  moduleId: "mod",
  widgetCanonicalId: "mod:widget:w",
  surface: "scene",
  capabilities: ["storage", "events", "status", "settings", "assets"],
  resourceBaseUrl: RESOURCE_BASE_URL,
  theme: null,
};

interface SimulatedFrame {
  src: string;
  removed: boolean;
  /** The widget's `window.widgetHost`, once the frame has booted. */
  host: WidgetHost;
}

async function drain(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function previewPage(surface: WidgetSurface, settings: Record<string, unknown>) {
  const frames: SimulatedFrame[] = [];
  const log: PreviewLogEntry[] = [];
  const bridges = new Set<WidgetBridge>();
  const storage = new PreviewStorage();
  const files: Record<string, string> = { "/assets/read/modules/mod/preview/widgets/w/data.json": '{"answer":42}' };
  const assets = new AssetCache({
    pageOrigin: ORIGIN,
    fetchFn: async (url) => {
      const body = files[url];
      return body === undefined
        ? new Response("missing", { status: 404 })
        : new Response(body, { headers: { "Content-Type": "application/json" } });
    },
  });

  const page = {
    postMessage(message: unknown, frameWindow: unknown): void {
      const data = structuredClone(message);
      queueMicrotask(() => {
        for (const bridge of bridges) {
          bridge.handleMessage({ source: frameWindow, data } as unknown as MessageEvent);
        }
      });
    },
  };

  function createIframe() {
    const listeners: Array<(event: ShimMessageEvent) => void> = [];
    const frameWindow: ShimWindow & { postMessage(message: unknown): void } = {
      location: { hash: "" },
      addEventListener: (type, listener) => {
        if (type === "message") {
          listeners.push(listener);
        }
      },
      removeEventListener: () => {},
      postMessage(message: unknown): void {
        const data = structuredClone(message);
        queueMicrotask(() => {
          for (const listener of listeners.slice()) {
            listener({ source: pageWindow, data });
          }
        });
      },
    };
    const pageWindow = { postMessage: (message: unknown) => page.postMessage(message, frameWindow) };
    const simulated = { src: "", removed: false } as SimulatedFrame;
    frames.push(simulated);
    return {
      className: "",
      style: { opacity: "" },
      contentWindow: frameWindow,
      setAttribute: () => {},
      addEventListener: () => {},
      remove: () => {
        simulated.removed = true;
      },
      set src(src: string) {
        simulated.src = src;
        frameWindow.location = { hash: src.slice(src.indexOf("#")) };
        frameWindow.__WOOFX3_WIDGET_BOOT__ = structuredClone(FRAME_BOOT);
        const host = installWidgetHostShim({ windowRef: frameWindow, parentRef: pageWindow });
        if (host === null) {
          throw new Error("the shim did not install");
        }
        simulated.host = host;
      },
    };
  }

  const frame = new PreviewFrame({
    slot: { appendChild: () => {} } as unknown as HTMLElement,
    moduleId: "mod",
    widgetId: "w",
    surface,
    settings,
    bridges,
    queues: new EventQueueManager(),
    assets,
    storage,
    log: (entry) => log.push(entry),
    document: { createElement: createIframe } as unknown as Pick<Document, "createElement">,
  });
  return { frame, frames, log, storage, current: () => frames[frames.length - 1]! };
}

describe("PreviewFrame", () => {
  it("boots the widget's frame with the placement's settings, identity and surface", async () => {
    const { current } = previewPage("scene", { label: "hi" });
    await drain();
    const host = current().host;
    expect(current().src.startsWith("/frames/w#boot=")).toBe(true);
    expect(host.instanceId).toBe("preview.w");
    expect(host.moduleId).toBe("mod");
    expect(host.surface).toBe("scene");
    expect(host.settings).toEqual({ label: "hi" });
    expect(host.getResourceUrl("a.png")).toBe(`${RESOURCE_BASE_URL}a.png`);
    expect(host.capabilities).toContain("storage");
  });

  it("delivers a fired event through the widget's queue, and logs its completion", async () => {
    const { frame, current, log } = previewPage("alert", {});
    await drain();
    expect(frame.fire("alert", { userName: "alice" })).toBe(false);
    expect(log.at(-1)).toEqual({
      kind: "problem",
      text: "alert not sent: the widget has not subscribed to events (widgetHost.onEvent)",
    });

    const received: DeliveredWidgetEvent[] = [];
    current().host.onEvent((event) => {
      received.push(event);
    });
    await drain();
    expect(frame.fire("alert", { userName: "alice" })).toBe(true);
    await drain();
    expect(received.map((event) => [event.type, event.data])).toEqual([["alert", { userName: "alice" }]]);
    expect(log.map((entry) => entry.text)).toContain(`completed ${received[0]!.eventId}`);
  });

  it("answers the widget's storage from what the author sets", async () => {
    const { current, storage } = previewPage("scene", {});
    await drain();
    const seen: unknown[] = [];
    current().host.storage.subscribe("count", (value) => {
      seen.push(value);
    });
    await drain();
    storage.set("count", 3);
    await drain();
    expect(seen).toEqual([null, 3]);
    expect(await current().host.storage.get("count")).toBe(3);
  });

  it("gives a widget playing in an alert no storage, as on stream", async () => {
    const { current } = previewPage("alert", {});
    await drain();
    expect(current().host.capabilities).not.toContain("storage");
  });

  it("patches in a setting the widget's script never read, and reloads for one it did", async () => {
    const { frame, frames, current, log } = previewPage("scene", { label: "a", color: "#fff" });
    await drain();
    expect(current().host.settings.label).toBe("a");
    await drain();

    expect(frame.applySettings({ label: "a", color: "#000" })).toBe("patch");
    await drain();
    expect(frames).toHaveLength(1);
    expect(current().host.settings.color).toBe("#000");

    expect(frame.applySettings({ label: "b", color: "#000" })).toBe("reload");
    await drain();
    expect(frames).toHaveLength(2);
    expect(frames[0]!.removed).toBe(true);
    expect(current().host.settings).toEqual({ label: "b", color: "#000" });
    expect(log.map((entry) => entry.text)).toContain("reloaded: its script read a setting that changed");

    expect(frame.applySettings({ label: "b", color: "#000" })).toBe("none");
  });

  it("reads the widget's own files through the asset cache, and logs what it could not read", async () => {
    const { current, log } = previewPage("scene", {});
    await drain();
    const asset = await current().host.assets.load("data.json");
    expect(asset.json()).toEqual({ answer: 42 });
    await expect(current().host.assets.load("missing.json")).rejects.toMatchObject({ code: "not_found" });
    await expect(current().host.assets.load("/assets/modules/other/1/x.json")).rejects.toMatchObject({
      code: "out_of_scope",
    });
    const texts = log.map((entry) => entry.text);
    expect(texts).toContain("read /assets/modules/mod/preview/widgets/w/data.json (application/json, 13 bytes)");
    expect(
      texts.some((text) => text.startsWith("could not read /assets/modules/mod/preview/widgets/w/missing.json"))
    ).toBe(true);
  });

  it("logs the widget's status reports", async () => {
    const { current, log } = previewPage("scene", {});
    await drain();
    current().host.reportStatus("progress", { done: 1 });
    await drain();
    expect(log).toContainEqual({ kind: "status", text: 'progress = {"done":1}' });
  });
});
