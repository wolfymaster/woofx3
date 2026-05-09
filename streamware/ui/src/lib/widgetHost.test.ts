import { describe, expect, it, mock } from "bun:test";
import { createWidgetHost, type StorageChangeStream, type StorageChangedFrame } from "./widgetHost";

function makeStream(initial: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>();
  for (const [k, v] of Object.entries(initial)) {
    cache.set(k, v);
  }
  const subscribers = new Set<(p: StorageChangedFrame) => void>();
  const stream: StorageChangeStream = {
    peek(moduleId: string, key: string): unknown {
      return cache.get(`${moduleId}:${key}`);
    },
    subscribe(cb): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };
  function push(frame: StorageChangedFrame) {
    cache.set(`${frame.moduleId}:${frame.key}`, frame.value);
    for (const sub of subscribers) {
      sub(frame);
    }
  }
  return { stream, push, subscribers };
}

describe("createWidgetHost", () => {
  it("freezes settings so widgets can't mutate them", () => {
    const { stream } = makeStream();
    const host = createWidgetHost({
      moduleId: "counter",
      settings: { label: "count", accent: "#fff" },
      stream,
    });
    expect(host.settings.label).toBe("count");
    expect(() => {
      (host.settings as any).label = "MUTATED";
    }).toThrow();
  });

  it("storage.get returns the cached value", async () => {
    const { stream } = makeStream({ "counter:count": 7 });
    const host = createWidgetHost({ moduleId: "counter", settings: {}, stream });
    const v = await host.storage.get("count");
    expect(v).toBe(7);
  });

  it("storage.get returns null when no value cached", async () => {
    const { stream } = makeStream();
    const host = createWidgetHost({ moduleId: "counter", settings: {}, stream });
    expect(await host.storage.get("count")).toBeNull();
  });

  it("storage.subscribe filters by moduleId and key", async () => {
    const { stream, push } = makeStream();
    const host = createWidgetHost({ moduleId: "counter", settings: {}, stream });
    const cb = mock(() => {});
    host.storage.subscribe("count", cb);

    // Wrong module — should be ignored.
    push({ moduleId: "other", key: "count", value: 1 });
    // Wrong key — should be ignored.
    push({ moduleId: "counter", key: "other-key", value: 2 });
    // Match — should fire.
    push({ moduleId: "counter", key: "count", value: 3 });

    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(3);
  });

  it("storage.subscribe fires once with the cached initial value", async () => {
    const { stream, push } = makeStream({ "counter:count": 42 });
    const host = createWidgetHost({ moduleId: "counter", settings: {}, stream });
    const cb = mock(() => {});
    host.storage.subscribe("count", cb);

    // Wait for the queued microtask delivering the initial value.
    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith(42);

    // Subsequent pushes still fire normally.
    push({ moduleId: "counter", key: "count", value: 43 });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledWith(43);
  });

  it("storage.subscribe returns an unsubscribe that stops further callbacks", async () => {
    const { stream, push } = makeStream();
    const host = createWidgetHost({ moduleId: "counter", settings: {}, stream });
    const cb = mock(() => {});
    const unsub = host.storage.subscribe("count", cb);

    push({ moduleId: "counter", key: "count", value: 1 });
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    push({ moduleId: "counter", key: "count", value: 2 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not fire the initial callback when no value is cached", async () => {
    const { stream } = makeStream();
    const host = createWidgetHost({ moduleId: "counter", settings: {}, stream });
    const cb = mock(() => {});
    host.storage.subscribe("count", cb);
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });
});
