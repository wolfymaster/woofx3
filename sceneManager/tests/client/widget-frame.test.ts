import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { WidgetBridge, WidgetBridgeCallbacks } from "../../public/scene-manager/widget-bridge";
import { generateNonce, mountWidgetFrame } from "../../public/scene-manager/widget-frame";

interface FakeIframe {
  className: string;
  src: string;
  style: { opacity: string };
  attributes: Record<string, string>;
  removed: boolean;
  contentWindow: { postMessage(message: unknown): void };
  posted: unknown[];
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: () => void): void;
  remove(): void;
}

function fakeIframe(): FakeIframe {
  const frame: FakeIframe = {
    className: "",
    src: "",
    style: { opacity: "" },
    attributes: {},
    removed: false,
    posted: [],
    contentWindow: { postMessage: (message) => frame.posted.push(message) },
    setAttribute: (name, value) => {
      frame.attributes[name] = value;
    },
    addEventListener: () => {},
    remove: () => {
      frame.removed = true;
    },
  };
  return frame;
}

const noop = () => {};
const callbacks = (): WidgetBridgeCallbacks => ({
  onStatusReport: noop,
  onAssetLoad: () => Promise.reject(new Error("none")),
  onEventsSubscribe: noop,
  onEventsUnsubscribe: noop,
  onEventComplete: noop,
  onDispose: noop,
});

let created: FakeIframe[] = [];
const realDocument = (globalThis as { document?: unknown }).document;

beforeEach(() => {
  created = [];
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const frame = fakeIframe();
      created.push(frame);
      return frame;
    },
  };
});

afterEach(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

describe("mountWidgetFrame", () => {
  it("mounts a sandboxed frame booted with its own nonce, and registers its bridge", () => {
    const appended: unknown[] = [];
    const bridges = new Set<WidgetBridge>();
    const frame = mountWidgetFrame({
      slot: { appendChild: (child: unknown) => appended.push(child) } as unknown as HTMLElement,
      instanceId: "inst-1",
      bridges,
      src: (nonce) => `/frames/woofx3/text#nonce=${nonce}`,
      callbacks,
    });
    const iframe = created[0]!;
    expect(iframe.attributes.sandbox).toBe("allow-scripts");
    expect(iframe.src).toBe(`/frames/woofx3/text#nonce=${frame.nonce}`);
    expect(appended).toEqual([iframe]);
    expect(bridges.has(frame.bridge)).toBe(true);
  });

  it("starts a frame that replaces another transparent until revealed", () => {
    const frame = mountWidgetFrame({
      slot: { appendChild: noop } as unknown as HTMLElement,
      instanceId: "inst-1",
      bridges: new Set(),
      hidden: true,
      src: () => "/f",
      callbacks,
    });
    expect(created[0]!.style.opacity).toBe("0");
    frame.reveal();
    expect(created[0]!.style.opacity).toBe("");
  });

  it("tears down once: disposes the widget, drops its bridge, runs the page's teardown, removes the frame", () => {
    const bridges = new Set<WidgetBridge>();
    let pageTeardowns = 0;
    const frame = mountWidgetFrame({
      slot: { appendChild: noop } as unknown as HTMLElement,
      instanceId: "inst-1",
      bridges,
      src: () => "/f",
      callbacks,
      onUnmount: () => {
        pageTeardowns += 1;
      },
    });
    frame.unmount();
    frame.unmount();
    const iframe = created[0]!;
    expect(iframe.removed).toBe(true);
    expect(bridges.size).toBe(0);
    expect(pageTeardowns).toBe(1);
  });

  it("gives callbacks the frame's bridge and nonce", () => {
    let seen = null as { nonce: string; bridge: WidgetBridge } | null;
    const frame = mountWidgetFrame({
      slot: { appendChild: noop } as unknown as HTMLElement,
      instanceId: "inst-1",
      bridges: new Set(),
      src: () => "/f",
      callbacks: (context) => ({
        ...callbacks(),
        onDispose: () => {
          seen = { nonce: context.nonce, bridge: context.bridge() };
        },
      }),
    });
    frame.unmount();
    expect(seen).toEqual({ nonce: frame.nonce, bridge: frame.bridge });
  });
});

describe("generateNonce", () => {
  it("is 128 random bits, base64url, different each time", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generateNonce()).not.toBe(a);
  });
});
