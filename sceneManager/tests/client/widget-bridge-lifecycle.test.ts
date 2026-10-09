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
    onDispose: noop,
  };

  function setup(extra: Partial<WidgetBridgeCallbacks> = {}) {
    const posted: Record<string, unknown>[] = [];
    const contentWindow = {
      postMessage: (message: Record<string, unknown>) => posted.push(message),
    };
    const bridge = new WidgetBridge("inst-1", NONCE, { ...callbacks, ...extra });
    bridge.attach({ contentWindow } as unknown as HTMLIFrameElement);
    const fromWidget = (type: string, extra: Record<string, unknown> = {}) =>
      bridge.handleMessage({
        source: contentWindow,
        data: { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: NONCE, type, moduleId: "mod", ...extra },
      } as unknown as MessageEvent);
    return { bridge, posted, fromWidget };
  }

  it("knows nothing about a widget's reads before its handshake", () => {
    const { bridge } = setup();
    expect(bridge.settingsReads()).toBeNull();
  });

  it("collects the settings a widget reports reading", () => {
    const { bridge, fromWidget } = setup();
    fromWidget("hello");
    fromWidget("settings.reads", { keys: ["duration"], all: false });
    fromWidget("settings.reads", { keys: ["src", 7], all: false });
    expect([...bridge.settingsReads()!.keys]).toEqual(["duration", "src"]);
    expect(bridge.settingsReads()!.all).toBe(false);
    fromWidget("settings.reads", { keys: [], all: true });
    expect(bridge.settingsReads()!.all).toBe(true);
  });

  it("sends settings once the widget is connected", () => {
    const { bridge, posted, fromWidget } = setup();
    bridge.sendSettings({ text: "early" });
    expect(posted.some((m) => m.type === "settings.changed")).toBe(false);
    fromWidget("hello");
    bridge.sendSettings({ text: "hi" });
    expect(posted.at(-1)).toMatchObject({ type: "settings.changed", nonce: NONCE, settings: { text: "hi" } });
  });

  it("sends a transition asked for before the handshake once the widget says hello, and later ones at once", () => {
    const { bridge, posted, fromWidget } = setup();
    const typewriter = { phase: "out" as const, type: "typewriter", durationMs: 400, easing: "ease-in" as const };
    bridge.sendTransition(typewriter);
    expect(posted.some((m) => m.type === "transition")).toBe(false);
    fromWidget("hello");
    expect(posted.filter((m) => m.type === "transition")).toEqual([
      expect.objectContaining({ nonce: NONCE, transition: typewriter }),
    ]);
    bridge.sendTransition(null);
    expect(posted.at(-1)).toMatchObject({ type: "transition", transition: null });
  });

  it("forgets the reads when the frame navigates", () => {
    const { bridge, fromWidget } = setup();
    fromWidget("hello");
    fromWidget("settings.reads", { keys: ["a"], all: true });
    bridge.onFrameLoad();
    expect(bridge.settingsReads()).toBeNull();
  });

  it("passes on rendered", () => {
    let rendered = 0;
    const { fromWidget } = setup({ onRendered: () => rendered++ });
    fromWidget("rendered");
    expect(rendered).toBe(1);
  });
});
