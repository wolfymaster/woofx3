// Shim round-trip tests over a simulated parent/child window pair —
// no jsdom; the shim takes injectable `windowRef` / `parentRef`.

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  HELLO_RETRY_INTERVAL_MS,
  SDK_VERSION,
  installWidgetHostShim,
  type ShimMessageEvent,
  type ShimParentWindow,
  type ShimWindow,
} from "../src/widget-host-shim";
import {
  PROTOCOL_VERSION,
  WIDGET_PROTOCOL,
  isWidgetProtocolEnvelope,
  type WidgetBootPayload,
} from "../src/widget-protocol";

const NONCE = "nonce-test-1234";

function makeBoot(overrides: Partial<WidgetBootPayload> = {}): WidgetBootPayload {
  return {
    v: PROTOCOL_VERSION,
    nonce: NONCE,
    instanceId: "inst-1",
    moduleId: "mod-1",
    widgetCanonicalId: "mod-1:widget:w1",
    settings: { label: "watchers", accent: "#fff" },
    capabilities: ["storage", "events", "status"],
    ...overrides,
  };
}

interface Harness {
  windowRef: ShimWindow;
  parent: ShimParentWindow & { messages: Array<{ data: unknown; origin: string }> };
  /** Simulate a message arriving in the child window. */
  deliver(data: unknown, source?: unknown): void;
  /** Messages of a given P1 type the child has posted to the parent. */
  sent(type: string): Array<Record<string, unknown>>;
  listenerCount(): number;
}

function makeHarness(boot: unknown): Harness {
  const listeners: Array<(event: ShimMessageEvent) => void> = [];
  const parent = {
    messages: [] as Array<{ data: unknown; origin: string }>,
    postMessage(message: unknown, targetOrigin: string): void {
      parent.messages.push({ data: message, origin: targetOrigin });
    },
  };
  const windowRef: ShimWindow = {
    __WOOFX3_WIDGET_BOOT__: boot,
    addEventListener(_type, listener): void {
      listeners.push(listener);
    },
    removeEventListener(_type, listener): void {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) {
        listeners.splice(idx, 1);
      }
    },
  };
  return {
    windowRef,
    parent,
    deliver(data: unknown, source: unknown = parent): void {
      for (const listener of listeners.slice()) {
        listener({ source, data });
      }
    },
    sent(type: string): Array<Record<string, unknown>> {
      return parent.messages
        .map((m) => m.data as Record<string, unknown>)
        .filter((m) => m !== null && typeof m === "object" && m.type === type);
    },
    listenerCount(): number {
      return listeners.length;
    },
  };
}

function fromParent(body: Record<string, unknown>): Record<string, unknown> {
  return { proto: WIDGET_PROTOCOL, v: PROTOCOL_VERSION, nonce: NONCE, ...body };
}

function initMsg(): Record<string, unknown> {
  return fromParent({ type: "init", settings: {}, capabilities: [], acceptedEvents: [] });
}

function install(h: Harness) {
  return installWidgetHostShim({ windowRef: h.windowRef, parentRef: h.parent });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  mock.restore();
});

describe("installWidgetHostShim — boot + handshake", () => {
  it("defines widgetHost synchronously with frozen boot settings", () => {
    const h = makeHarness(makeBoot());
    const host = install(h);
    expect(host).not.toBeNull();
    expect(h.windowRef.widgetHost).toBe(host!);
    expect(host!.moduleId).toBe("mod-1");
    expect(host!.instanceId).toBe("inst-1");
    expect(host!.settings.label).toBe("watchers");
    expect(Object.isFrozen(host!.settings)).toBe(true);
  });

  it("posts a valid hello immediately with targetOrigin '*'", () => {
    const h = makeHarness(makeBoot());
    install(h);
    expect(h.parent.messages.length).toBe(1);
    expect(h.parent.messages[0]!.origin).toBe("*");
    const hello = h.sent("hello")[0]!;
    expect(isWidgetProtocolEnvelope(hello)).toBe(true);
    expect(hello.nonce).toBe(NONCE);
    expect(hello.instanceId).toBe("inst-1");
    expect(hello.sdkVersion).toBe(SDK_VERSION);
    expect(hello.wants).toEqual(["storage", "events", "status"]);
  });

  it("re-posts hello every 250ms until init arrives, then stops", async () => {
    const h = makeHarness(makeBoot());
    install(h);
    await sleep(HELLO_RETRY_INTERVAL_MS * 2 + 80);
    const before = h.sent("hello").length;
    expect(before).toBeGreaterThanOrEqual(2);

    h.deliver(initMsg());
    await sleep(HELLO_RETRY_INTERVAL_MS + 80);
    expect(h.sent("hello").length).toBe(before);
  });

  it("fails loud and installs nothing when the boot payload is missing", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const h = makeHarness(undefined);
    const host = install(h);
    expect(host).toBeNull();
    expect(h.windowRef.widgetHost).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(h.parent.messages.length).toBe(0);
  });

  it("rejects a malformed boot payload (wrong v / missing nonce)", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const h = makeHarness({ ...makeBoot(), v: 99 });
    expect(install(h)).toBeNull();
    const h2 = makeHarness({ ...makeBoot(), nonce: "" });
    expect(install(h2)).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("init.reject is terminal: hello stops and the queue is dropped", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const h = makeHarness(makeBoot());
    const host = install(h)!;
    host.reportStatus("count", 1);
    h.deliver(
      fromParent({ type: "init.reject", reason: "unsupported version", supportedVersions: [2] })
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    await sleep(HELLO_RETRY_INTERVAL_MS + 80);
    const helloCount = h.sent("hello").length;
    expect(helloCount).toBe(1);
    // A late init must not flush the dropped queue.
    h.deliver(initMsg());
    expect(h.sent("status.report").length).toBe(0);
  });
});

describe("installWidgetHostShim — queueing", () => {
  it("queues outgoing calls before init and flushes them in order on init", () => {
    const h = makeHarness(makeBoot());
    const host = install(h)!;
    host.reportStatus("count", 1);
    void host.storage.get("count");
    host.storage.subscribe("goal", () => {});
    // Only the hello has gone out so far.
    expect(h.parent.messages.length).toBe(1);

    h.deliver(initMsg());
    const types = h.parent.messages
      .map((m) => (m.data as Record<string, unknown>).type)
      .filter((t) => t !== "hello");
    expect(types).toEqual(["status.report", "storage.get", "storage.subscribe"]);
  });
});

describe("installWidgetHostShim — storage", () => {
  it("storage.get correlates concurrent reads by id", async () => {
    const h = makeHarness(makeBoot());
    const host = install(h)!;
    h.deliver(initMsg());

    const pCount = host.storage.get("count");
    const pGoal = host.storage.get("goal");
    const gets = h.sent("storage.get");
    expect(gets.length).toBe(2);
    const countId = gets.find((g) => g.key === "count")!.id as string;
    const goalId = gets.find((g) => g.key === "goal")!.id as string;
    expect(countId).not.toBe(goalId);

    // Answer out of order to prove correlation is by id, not arrival.
    h.deliver(fromParent({ type: "storage.value", id: goalId, key: "goal", value: 100 }));
    h.deliver(fromParent({ type: "storage.value", id: countId, key: "count", value: 7 }));
    expect(await pCount).toBe(7);
    expect(await pGoal).toBe(100);
  });

  it("storage.subscribe delivers changed frames and unsubscribe stops them", () => {
    const h = makeHarness(makeBoot());
    const host = install(h)!;
    h.deliver(initMsg());

    const cb = mock(() => {});
    const unsubscribe = host.storage.subscribe("count", cb);
    const sub = h.sent("storage.subscribe")[0]!;
    expect(sub.key).toBe("count");
    const subId = sub.subId as string;

    h.deliver(
      fromParent({
        type: "storage.changed",
        subId,
        key: "count",
        value: 3,
        occurredAt: "2026-06-12T00:00:00Z",
      })
    );
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(3);

    unsubscribe();
    const unsub = h.sent("storage.unsubscribe")[0]!;
    expect(unsub.subId).toBe(subId);

    h.deliver(
      fromParent({
        type: "storage.changed",
        subId,
        key: "count",
        value: 4,
        occurredAt: "2026-06-12T00:00:01Z",
      })
    );
    expect(cb).toHaveBeenCalledTimes(1);
    // Unsubscribe is idempotent: a second call posts nothing new.
    unsubscribe();
    expect(h.sent("storage.unsubscribe").length).toBe(1);
  });
});

describe("installWidgetHostShim — events", () => {
  it("event.deliver fires the matching onEvent handler with the typed event", () => {
    const h = makeHarness(makeBoot());
    const host = install(h)!;
    h.deliver(initMsg());

    const handler = mock(() => {});
    const unsubscribe = host.onEvent(handler);
    const subId = h.sent("events.subscribe")[0]!.subId as string;

    const event = {
      type: "twitch_platform:trigger:follow.user.twitch",
      source: "twitch",
      time: "2026-06-12T00:00:00Z",
      data: { userName: "wolfy" },
      parameters: { text: "thanks!" },
    };
    h.deliver(fromParent({ type: "event.deliver", subId, event }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);

    unsubscribe();
    expect(h.sent("events.unsubscribe")[0]!.subId).toBe(subId);
    h.deliver(fromParent({ type: "event.deliver", subId, event }));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("installWidgetHostShim — status reporting", () => {
  it("reportStatus emits status.report with key/value/ts", () => {
    const h = makeHarness(makeBoot());
    const host = install(h)!;
    h.deliver(initMsg());

    host.reportStatus("count", 5);
    const report = h.sent("status.report")[0]!;
    expect(report.key).toBe("count");
    expect(report.value).toBe(5);
    expect(typeof report.ts).toBe("string");
    expect(Number.isNaN(Date.parse(report.ts as string))).toBe(false);
  });

  it("reportComplete sugars to status.report('complete', {reason})", () => {
    const h = makeHarness(makeBoot());
    const host = install(h)!;
    h.deliver(initMsg());

    host.reportComplete("goal hit");
    host.reportComplete();
    const reports = h.sent("status.report");
    expect(reports.length).toBe(2);
    expect(reports[0]!.key).toBe("complete");
    expect(reports[0]!.value).toEqual({ reason: "goal hit" });
    expect(reports[1]!.value).toBeNull();
  });
});

describe("installWidgetHostShim — inbound validation", () => {
  it("ignores messages with a wrong nonce", () => {
    const h = makeHarness(makeBoot());
    const host = install(h)!;
    h.deliver({ ...initMsg(), nonce: "wrong-nonce" });

    // Still uninitialized: outgoing traffic stays queued.
    host.reportStatus("count", 1);
    expect(h.sent("status.report").length).toBe(0);

    h.deliver(initMsg());
    expect(h.sent("status.report").length).toBe(1);

    const cb = mock(() => {});
    host.storage.subscribe("count", cb);
    const subId = h.sent("storage.subscribe")[0]!.subId as string;
    h.deliver({
      ...fromParent({
        type: "storage.changed",
        subId,
        key: "count",
        value: 9,
        occurredAt: "2026-06-12T00:00:00Z",
      }),
      nonce: "wrong-nonce",
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores messages whose source is not the parent window", () => {
    const h = makeHarness(makeBoot());
    const host = install(h)!;
    const stranger = { postMessage: () => {} };
    h.deliver(initMsg(), stranger);
    host.reportStatus("count", 1);
    expect(h.sent("status.report").length).toBe(0);
  });

  it("ignores non-protocol data and unknown message types without breaking", () => {
    const h = makeHarness(makeBoot());
    const host = install(h)!;
    h.deliver(initMsg());

    h.deliver("just a string");
    h.deliver(null);
    h.deliver({ random: true });
    h.deliver(fromParent({ type: "future.fancy.thing", payload: 42 }));

    // Channel still works afterwards.
    host.reportStatus("count", 2);
    expect(h.sent("status.report").length).toBe(1);
  });

  it("answers ping with pong echoing ts", () => {
    const h = makeHarness(makeBoot());
    install(h);
    h.deliver(initMsg());
    h.deliver(fromParent({ type: "ping", ts: 1718150400000 }));
    const pong = h.sent("pong")[0]!;
    expect(pong.ts).toBe(1718150400000);
    expect(pong.nonce).toBe(NONCE);
  });
});

describe("installWidgetHostShim — dispose", () => {
  it("dispose tears down subscriptions, resolves pending gets null, and goes inert", async () => {
    const h = makeHarness(makeBoot());
    const host = install(h)!;
    h.deliver(initMsg());

    const storageCb = mock(() => {});
    const eventCb = mock(() => {});
    host.storage.subscribe("count", storageCb);
    host.onEvent(eventCb);
    const storageSubId = h.sent("storage.subscribe")[0]!.subId as string;
    const eventSubId = h.sent("events.subscribe")[0]!.subId as string;
    const pending = host.storage.get("count");

    h.deliver(fromParent({ type: "dispose", reason: "scene updated" }));
    expect(await pending).toBeNull();
    expect(h.listenerCount()).toBe(0);

    const sentBefore = h.parent.messages.length;
    h.deliver(
      fromParent({
        type: "storage.changed",
        subId: storageSubId,
        key: "count",
        value: 1,
        occurredAt: "2026-06-12T00:00:00Z",
      })
    );
    h.deliver(
      fromParent({
        type: "event.deliver",
        subId: eventSubId,
        event: { type: "t", source: "s", time: "now", data: null },
      })
    );
    expect(storageCb).not.toHaveBeenCalled();
    expect(eventCb).not.toHaveBeenCalled();

    // Outgoing surface is inert but never throws.
    host.reportStatus("count", 9);
    expect(await host.storage.get("count")).toBeNull();
    expect(h.parent.messages.length).toBe(sentBefore);
  });
});
