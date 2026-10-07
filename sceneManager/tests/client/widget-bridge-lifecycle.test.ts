import { describe, expect, it } from "bun:test";
import { PROTOCOL_VERSION, WIDGET_PROTOCOL } from "@woofx3/module-sdk";
import {
  createFrameLoadHandler,
  WidgetBridge,
  type WidgetBridgeCallbacks,
} from "../../public/scene-manager/widget-bridge";

describe("createFrameLoadHandler", () => {
  it("ignores the first load so it cannot wipe a completed handshake", () => {
    // The shim is a classic script: it sends `hello` during parsing,
    // long before the iframe's first `load`. Resetting on that first
    // fire drops the handshake the widget will never redo, and every
    // later events.subscribe is silently ignored.
    let resets = 0;
    const handler = createFrameLoadHandler({
      onFrameLoad: () => {
        resets += 1;
      },
    });
    handler();
    expect(resets).toBe(0);
  });

  it("resets on a subsequent load (in-frame navigation needs a fresh handshake)", () => {
    let resets = 0;
    const handler = createFrameLoadHandler({
      onFrameLoad: () => {
        resets += 1;
      },
    });
    handler();
    handler();
    handler();
    expect(resets).toBe(2);
  });

  it("tracks each frame independently", () => {
    let a = 0;
    let b = 0;
    const handlerA = createFrameLoadHandler({
      onFrameLoad: () => {
        a += 1;
      },
    });
    const handlerB = createFrameLoadHandler({
      onFrameLoad: () => {
        b += 1;
      },
    });
    handlerA();
    handlerA();
    handlerB();
    expect(a).toBe(1);
    expect(b).toBe(0);
  });
});

describe("WidgetBridge settings", () => {
  const NONCE = "n-1";
  const noop = () => {};
  const callbacks: WidgetBridgeCallbacks = {
    onStorageGet: () => null,
    onStorageSubscribe: noop,
    onStorageUnsubscribe: noop,
    onStatusReport: noop,
    onEventsSubscribe: noop,
    onEventsUnsubscribe: noop,
    onEventComplete: noop,
    onMediaGet: async () => null,
    onDispose: noop,
  };

  function setup() {
    const posted: Record<string, unknown>[] = [];
    const contentWindow = {
      postMessage: (message: Record<string, unknown>) => posted.push(message),
    };
    const bridge = new WidgetBridge("inst-1", NONCE, callbacks);
    bridge.attach({ contentWindow } as unknown as HTMLIFrameElement);
    const fromWidget = (type: string, extra: Record<string, unknown> = {}) =>
      bridge.handleMessage({
        source: contentWindow,
        data: { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: NONCE, type, moduleId: "mod", ...extra },
      } as unknown as MessageEvent);
    return { bridge, posted, fromWidget };
  }

  it("sends nothing to a widget that never subscribed", () => {
    const { bridge, posted, fromWidget } = setup();
    fromWidget("hello");
    expect(bridge.acceptsSettings()).toBe(false);
    expect(bridge.sendSettings({ text: "hi" })).toBe(false);
    expect(posted.some((m) => m.type === "settings.changed")).toBe(false);
  });

  it("sends a subscribed widget its settings until it unsubscribes", () => {
    const { bridge, posted, fromWidget } = setup();
    fromWidget("hello");
    fromWidget("settings.subscribe");
    expect(bridge.sendSettings({ text: "hi" })).toBe(true);
    expect(posted.at(-1)).toMatchObject({ type: "settings.changed", nonce: NONCE, settings: { text: "hi" } });

    fromWidget("settings.unsubscribe");
    expect(bridge.sendSettings({ text: "bye" })).toBe(false);
  });

  it("forgets the subscription when the frame navigates", () => {
    const { bridge, fromWidget } = setup();
    fromWidget("hello");
    fromWidget("settings.subscribe");
    bridge.onFrameLoad();
    expect(bridge.acceptsSettings()).toBe(false);
  });
});

describe("WidgetBridge media", () => {
  const NONCE = "n-1";
  const noop = () => {};

  function setup(onMediaGet: WidgetBridgeCallbacks["onMediaGet"]) {
    const posted: Record<string, unknown>[] = [];
    const contentWindow = {
      postMessage: (message: Record<string, unknown>) => posted.push(message),
    };
    const bridge = new WidgetBridge("inst-1", NONCE, {
      onStorageGet: () => null,
      onStorageSubscribe: noop,
      onStorageUnsubscribe: noop,
      onStatusReport: noop,
      onEventsSubscribe: noop,
      onEventsUnsubscribe: noop,
      onEventComplete: noop,
      onMediaGet,
      onDispose: noop,
    });
    bridge.attach({ contentWindow } as unknown as HTMLIFrameElement);
    const fromWidget = (type: string, extra: Record<string, unknown> = {}) =>
      bridge.handleMessage({
        source: contentWindow,
        data: { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: NONCE, type, moduleId: "mod", ...extra },
      } as unknown as MessageEvent);
    return { posted, fromWidget };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("advertises the media capability", () => {
    const { posted, fromWidget } = setup(async () => null);
    fromWidget("hello");
    expect(posted.find((m) => m.type === "init")?.capabilities).toContain("media");
  });

  it("answers media.get with the page's cached bytes", async () => {
    const blob = new Blob(["abc"]);
    const { posted, fromWidget } = setup(async (url) => (url === "https://s.test/assets/user/r1/a.mp3" ? blob : null));
    fromWidget("hello");
    fromWidget("media.get", { id: "media-1", url: "https://s.test/assets/user/r1/a.mp3" });
    await settle();
    expect(posted.at(-1)).toMatchObject({ type: "media.value", id: "media-1", blob });
  });

  it("answers null when the cache fails, so the widget never waits forever", async () => {
    const { posted, fromWidget } = setup(async () => {
      throw new Error("boom");
    });
    fromWidget("hello");
    fromWidget("media.get", { id: "media-1", url: "https://s.test/assets/user/r1/a.mp3" });
    await settle();
    expect(posted.at(-1)).toMatchObject({ type: "media.value", id: "media-1", blob: null });
  });
});
