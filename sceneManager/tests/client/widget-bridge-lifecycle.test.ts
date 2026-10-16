import { describe, expect, it } from "bun:test";
import { PROTOCOL_VERSION, WIDGET_PROTOCOL } from "@woofx3/module-sdk";
import { AssetLoadError, type LoadedAsset } from "../../public/scene-manager/asset-loader";
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
    onAssetLoad: () => Promise.reject(new AssetLoadError("not_found", "")),
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

describe("WidgetBridge assets", () => {
  const NONCE = "n-2";

  function setup(onAssetLoad: (path: string) => Promise<LoadedAsset>) {
    const posted: Record<string, unknown>[] = [];
    const contentWindow = {
      postMessage: (message: Record<string, unknown>) => posted.push(message),
    };
    const noop = () => {};
    const bridge = new WidgetBridge("inst-1", NONCE, {
      onStorageGet: () => null,
      onStorageSubscribe: noop,
      onStorageUnsubscribe: noop,
      onStatusReport: noop,
      onAssetLoad,
      onEventsSubscribe: noop,
      onEventsUnsubscribe: noop,
      onEventComplete: noop,
      onDispose: noop,
    });
    bridge.attach({ contentWindow } as unknown as HTMLIFrameElement);
    const fromWidget = (type: string, extra: Record<string, unknown> = {}) =>
      bridge.handleMessage({
        source: contentWindow,
        data: { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: NONCE, type, moduleId: "mod", ...extra },
      } as unknown as MessageEvent);
    return { bridge, posted, fromWidget };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("answers a read with the file's bytes under the request's id", async () => {
    const bytes = new TextEncoder().encode("{}").buffer;
    const asked: string[] = [];
    const { posted, fromWidget } = setup(async (path) => {
      asked.push(path);
      return { contentType: "application/json", bytes };
    });
    fromWidget("hello");
    fromWidget("asset.load", { id: "asset-1", path: "/assets/user/r/a.json" });
    await flush();
    expect(asked).toEqual(["/assets/user/r/a.json"]);
    expect(posted.at(-1)).toMatchObject({ type: "asset.value", id: "asset-1", contentType: "application/json" });
    expect(posted.at(-1)!.bytes).toBe(bytes);
  });

  it("answers a refused read with the reason", async () => {
    const { posted, fromWidget } = setup(() => Promise.reject(new AssetLoadError("out_of_scope", "/x")));
    fromWidget("hello");
    fromWidget("asset.load", { id: "asset-1", path: "/assets/modules/other/v/a.json" });
    await flush();
    expect(posted.at(-1)).toMatchObject({ type: "asset.error", id: "asset-1", code: "out_of_scope" });
  });

  it("reports any other failure as unavailable", async () => {
    const { posted, fromWidget } = setup(() => Promise.reject(new Error("boom")));
    fromWidget("hello");
    fromWidget("asset.load", { id: "asset-1", path: "/assets/user/r/a.json" });
    await flush();
    expect(posted.at(-1)).toMatchObject({ type: "asset.error", code: "unavailable" });
  });

  it("ignores reads before the handshake", async () => {
    let asked = 0;
    const { fromWidget } = setup(async () => {
      asked += 1;
      return { contentType: "", bytes: new ArrayBuffer(0) };
    });
    fromWidget("asset.load", { id: "asset-1", path: "/assets/user/r/a.json" });
    await flush();
    expect(asked).toBe(0);
  });

  it("never answers a read into the document that replaced the one that asked", async () => {
    let finish: (asset: LoadedAsset) => void = () => {};
    const { bridge, posted, fromWidget } = setup(
      () =>
        new Promise<LoadedAsset>((resolve) => {
          finish = resolve;
        })
    );
    fromWidget("hello");
    fromWidget("asset.load", { id: "asset-1", path: "/assets/user/r/a.json" });
    bridge.onFrameLoad();
    fromWidget("hello");
    finish({ contentType: "", bytes: new ArrayBuffer(0) });
    await flush();
    expect(posted.some((m) => m.type === "asset.value")).toBe(false);
  });
});
