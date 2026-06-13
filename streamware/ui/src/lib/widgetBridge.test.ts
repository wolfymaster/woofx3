import { describe, expect, it, mock } from "bun:test";
import { WidgetBridge, type WidgetBridgeCallbacks } from "./widgetBridge";
import { WIDGET_PROTOCOL, PROTOCOL_VERSION } from "../../../../shared/clients/typescript/module-sdk/src/widget-protocol";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCallbacks(overrides: Partial<WidgetBridgeCallbacks> = {}): WidgetBridgeCallbacks {
  return {
    onStorageGet: overrides.onStorageGet ?? (() => null),
    onStorageSubscribe: overrides.onStorageSubscribe ?? (() => {}),
    onStorageUnsubscribe: overrides.onStorageUnsubscribe ?? (() => {}),
    onStatusReport: overrides.onStatusReport ?? (() => {}),
    onDispose: overrides.onDispose ?? (() => {}),
  };
}

function makeBridge(
  instanceId = "inst-1",
  nonce = "test-nonce",
  callbacks: Partial<WidgetBridgeCallbacks> = {},
): WidgetBridge {
  return new WidgetBridge(instanceId, nonce, makeCallbacks(callbacks));
}

/** Build a fake iframe whose contentWindow is a distinct object so
 *  source-identity checks work. */
function makeFakeIframe(): { iframe: HTMLIFrameElement; win: Window } {
  const win = {} as Window;
  const iframe = { contentWindow: win } as unknown as HTMLIFrameElement;
  return { iframe, win };
}

/** Construct a MessageEvent with the given source window and data. */
function makeMessageEvent(source: unknown, data: unknown): MessageEvent {
  return { source, data } as unknown as MessageEvent;
}

/** A minimal valid hello payload. */
function helloPayload(nonce: string, v = PROTOCOL_VERSION): Record<string, unknown> {
  return {
    proto: WIDGET_PROTOCOL,
    v,
    type: "hello",
    nonce,
    instanceId: "inst-1",
    moduleId: "my-module",
    sdkVersion: "1.0.0",
    wants: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WidgetBridge.handleMessage", () => {
  it("ignores messages from the wrong source", () => {
    const { iframe } = makeFakeIframe();
    const otherWin = {} as Window;
    const bridge = makeBridge();
    bridge.attach(iframe);

    const posted: unknown[] = [];
    (iframe.contentWindow as unknown as { postMessage: (...args: unknown[]) => void }).postMessage =
      (...args: unknown[]) => posted.push(args);

    // Message from a different window — should be silently dropped.
    bridge.handleMessage(makeMessageEvent(otherWin, helloPayload("test-nonce")));
    expect(posted).toHaveLength(0);
  });

  it("ignores messages with the wrong nonce", () => {
    const { iframe, win } = makeFakeIframe();
    const bridge = makeBridge("inst-1", "correct-nonce");
    bridge.attach(iframe);

    const posted: unknown[] = [];
    (win as unknown as { postMessage: (...args: unknown[]) => void }).postMessage = (
      ...args: unknown[]
    ) => posted.push(args);

    bridge.handleMessage(makeMessageEvent(win, helloPayload("wrong-nonce")));
    expect(posted).toHaveLength(0);
  });

  it("sends init after a valid hello with correct nonce", () => {
    const { iframe, win } = makeFakeIframe();
    const bridge = makeBridge("inst-1", "test-nonce");
    bridge.attach(iframe);

    const posted: unknown[] = [];
    (win as unknown as { postMessage: (...args: unknown[]) => void }).postMessage = (
      ...args: unknown[]
    ) => posted.push(args[0]);

    bridge.handleMessage(makeMessageEvent(win, helloPayload("test-nonce")));

    expect(posted).toHaveLength(1);
    const msg = posted[0] as Record<string, unknown>;
    expect(msg.type).toBe("init");
    expect(msg.proto).toBe(WIDGET_PROTOCOL);
    expect(msg.nonce).toBe("test-nonce");
  });

  it("sends init.reject for an unsupported protocol version", () => {
    const { iframe, win } = makeFakeIframe();
    const bridge = makeBridge("inst-1", "test-nonce");
    bridge.attach(iframe);

    const posted: unknown[] = [];
    (win as unknown as { postMessage: (...args: unknown[]) => void }).postMessage = (
      ...args: unknown[]
    ) => posted.push(args[0]);

    // hello with v = 99 (unsupported).
    bridge.handleMessage(makeMessageEvent(win, helloPayload("test-nonce", 99 as 1)));

    expect(posted).toHaveLength(1);
    const msg = posted[0] as Record<string, unknown>;
    expect(msg.type).toBe("init.reject");
    expect((msg.supportedVersions as number[]).includes(PROTOCOL_VERSION)).toBe(true);
  });

  it("ignores messages with wrong proto field", () => {
    const { iframe, win } = makeFakeIframe();
    const bridge = makeBridge("inst-1", "test-nonce");
    bridge.attach(iframe);

    const posted: unknown[] = [];
    (win as unknown as { postMessage: (...args: unknown[]) => void }).postMessage = (
      ...args: unknown[]
    ) => posted.push(args[0]);

    // proto is wrong.
    bridge.handleMessage(
      makeMessageEvent(win, {
        proto: "wrong.proto",
        v: PROTOCOL_VERSION,
        type: "hello",
        nonce: "test-nonce",
        moduleId: "m",
        sdkVersion: "1",
        wants: [],
      }),
    );
    expect(posted).toHaveLength(0);
  });
});

describe("WidgetBridge.onFrameLoad", () => {
  it("resets initialized state so a fresh hello is required", () => {
    const { iframe, win } = makeFakeIframe();
    const bridge = makeBridge("inst-1", "test-nonce");
    bridge.attach(iframe);

    const posted: unknown[] = [];
    (win as unknown as { postMessage: (...args: unknown[]) => void }).postMessage = (
      ...args: unknown[]
    ) => posted.push(args[0]);

    // Initialize via hello.
    bridge.handleMessage(makeMessageEvent(win, helloPayload("test-nonce")));
    expect((posted[0] as Record<string, unknown>).type).toBe("init");

    // Frame navigates — session invalidated.
    bridge.onFrameLoad();

    // A storage.get arriving before the next hello should be dropped.
    bridge.handleMessage(
      makeMessageEvent(win, {
        proto: WIDGET_PROTOCOL,
        v: PROTOCOL_VERSION,
        type: "storage.get",
        nonce: "test-nonce",
        id: "req-1",
        key: "myKey",
      }),
    );
    // Only the init from the first hello, no storage.value.
    expect(posted).toHaveLength(1);
  });
});
