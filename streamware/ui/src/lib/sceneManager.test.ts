import { describe, expect, it } from "bun:test";
import { SceneManager } from "./sceneManager";
import type { SceneEventSource, SceneEventSink } from "./eventSource";
import type { WidgetBridge } from "./widgetBridge";
import type { WidgetEvent } from "@woofx3/module-sdk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal no-op event source. */
function makeNoopSource(): SceneEventSource {
  return {
    start(_sink: SceneEventSink): void {},
    stop(): void {},
    send(): void {},
  };
}

/** A fake WidgetBridge that records what was sent to it. */
function makeFakeBridge(): WidgetBridge & {
  receivedEvents: WidgetEvent[];
  receivedStorage: Array<{ moduleId: string; key: string; value: unknown }>;
} {
  const receivedEvents: WidgetEvent[] = [];
  const receivedStorage: Array<{ moduleId: string; key: string; value: unknown }> = [];

  return {
    receivedEvents,
    receivedStorage,
    attach() {},
    onFrameLoad() {},
    handleMessage() {},
    sendInit() {},
    sendReject() {},
    sendStorageChanged(moduleId: string, key: string, value: unknown): void {
      receivedStorage.push({ moduleId, key, value });
    },
    sendEvent(event: WidgetEvent): void {
      receivedEvents.push(event);
    },
    dispose() {},
    detach() {},
  } as unknown as WidgetBridge & {
    receivedEvents: WidgetEvent[];
    receivedStorage: Array<{ moduleId: string; key: string; value: unknown }>;
  };
}

function makeEvent(type: string): WidgetEvent {
  return { type, source: "test", time: new Date().toISOString(), data: null };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SceneManager.deliverEvent", () => {
  it("dispatches only to bridges with matching acceptedEvents", () => {
    const manager = new SceneManager({ eventSource: makeNoopSource() });
    manager.start();

    const bridgeA = makeFakeBridge();
    const bridgeB = makeFakeBridge();

    manager.registerBridge("a", bridgeA as unknown as WidgetBridge, ["twitch:trigger:follow"]);
    manager.registerBridge("b", bridgeB as unknown as WidgetBridge, ["twitch:trigger:cheer"]);

    manager.deliverEvent(makeEvent("twitch:trigger:follow"));

    expect(bridgeA.receivedEvents).toHaveLength(1);
    expect(bridgeA.receivedEvents[0].type).toBe("twitch:trigger:follow");
    expect(bridgeB.receivedEvents).toHaveLength(0);

    manager.stop();
  });

  it("does not dispatch to unregistered bridges", () => {
    const manager = new SceneManager({ eventSource: makeNoopSource() });
    manager.start();

    const bridge = makeFakeBridge();
    manager.registerBridge("a", bridge as unknown as WidgetBridge, ["twitch:trigger:follow"]);
    manager.unregisterBridge("a");

    manager.deliverEvent(makeEvent("twitch:trigger:follow"));

    expect(bridge.receivedEvents).toHaveLength(0);
    manager.stop();
  });
});

describe("SceneManager.addEventSubscription", () => {
  it("enables runtime subscription so bridge receives matching events", () => {
    const manager = new SceneManager({ eventSource: makeNoopSource() });
    manager.start();

    const bridge = makeFakeBridge();
    // Registered with no accepted events.
    manager.registerBridge("a", bridge as unknown as WidgetBridge, []);

    // Runtime subscription added after registration.
    manager.addEventSubscription("a", "twitch:trigger:follow");
    manager.deliverEvent(makeEvent("twitch:trigger:follow"));

    expect(bridge.receivedEvents).toHaveLength(1);
    manager.stop();
  });
});

describe("SceneManager.removeEventSubscription", () => {
  it("disables runtime subscription so bridge no longer receives events", () => {
    const manager = new SceneManager({ eventSource: makeNoopSource() });
    manager.start();

    const bridge = makeFakeBridge();
    manager.registerBridge("a", bridge as unknown as WidgetBridge, ["twitch:trigger:follow"]);

    // Remove the subscription.
    manager.removeEventSubscription("a", "twitch:trigger:follow");
    manager.deliverEvent(makeEvent("twitch:trigger:follow"));

    expect(bridge.receivedEvents).toHaveLength(0);
    manager.stop();
  });
});

describe("SceneManager.deliverStorage", () => {
  it("only delivers to subscribed bridges", () => {
    const manager = new SceneManager({ eventSource: makeNoopSource() });
    manager.start();

    const bridgeA = makeFakeBridge();
    const bridgeB = makeFakeBridge();

    manager.registerBridge("a", bridgeA as unknown as WidgetBridge, []);
    manager.registerBridge("b", bridgeB as unknown as WidgetBridge, []);

    // Only bridge A subscribes to storage.
    manager.addStorageSubscription("a", "my-module", "someKey");

    manager.deliverStorage("my-module", "someKey", 42);

    expect(bridgeA.receivedStorage).toHaveLength(1);
    expect(bridgeA.receivedStorage[0]).toEqual({ moduleId: "my-module", key: "someKey", value: 42 });
    expect(bridgeB.receivedStorage).toHaveLength(0);

    manager.stop();
  });

  it("does not deliver after storage subscription is removed", () => {
    const manager = new SceneManager({ eventSource: makeNoopSource() });
    manager.start();

    const bridge = makeFakeBridge();
    manager.registerBridge("a", bridge as unknown as WidgetBridge, []);
    manager.addStorageSubscription("a", "my-module", "someKey");
    manager.removeStorageSubscription("a", "my-module", "someKey");

    manager.deliverStorage("my-module", "someKey", 99);

    expect(bridge.receivedStorage).toHaveLength(0);
    manager.stop();
  });
});
