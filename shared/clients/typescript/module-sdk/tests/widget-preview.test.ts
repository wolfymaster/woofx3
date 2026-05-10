import { afterEach, describe, expect, it, mock } from "bun:test";
import { createMockHost } from "../src/preview/widget-preview";

describe("createMockHost", () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    if (restore) {
      restore();
      restore = null;
    }
  });

  it("exposes the configured identity + frozen settings", () => {
    const ctrl = createMockHost({
      moduleId: "counter",
      instanceId: "inst-7",
      settings: { label: "watchers", accent: "#fff" },
    });
    expect(ctrl.host.moduleId).toBe("counter");
    expect(ctrl.host.instanceId).toBe("inst-7");
    expect(ctrl.host.settings.label).toBe("watchers");
    expect(() => {
      (ctrl.host.settings as Record<string, unknown>).label = "MUTATED";
    }).toThrow();
  });

  it("storage.get returns initial cached value, null when absent", async () => {
    const ctrl = createMockHost({
      moduleId: "counter",
      storage: { count: 7 },
    });
    expect(await ctrl.host.storage.get("count")).toBe(7);
    expect(await ctrl.host.storage.get("nope")).toBeNull();
  });

  it("storage.subscribe fires once with the cached value, then on every setStorage", async () => {
    const ctrl = createMockHost({
      moduleId: "counter",
      storage: { count: 1 },
    });
    const cb = mock(() => {});
    ctrl.host.storage.subscribe("count", cb);
    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith(1);

    ctrl.setStorage("count", 2);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledWith(2);

    ctrl.setStorage("other-key", 99);
    expect(cb).toHaveBeenCalledTimes(2); // still
  });

  it("fireEvent dispatches to every onEvent subscriber", () => {
    const ctrl = createMockHost();
    const a = mock(() => {});
    const b = mock(() => {});
    ctrl.host.onEvent(a);
    ctrl.host.onEvent(b);
    ctrl.fireEvent({
      type: "twitch_platform:trigger:follow.user.twitch",
      source: "twitch",
      time: "2026-05-09T00:00:00Z",
      data: { userName: "alice" },
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("onEvent unsubscribe stops further callbacks", () => {
    const ctrl = createMockHost();
    const cb = mock(() => {});
    const off = ctrl.host.onEvent(cb);
    ctrl.fireEvent({ type: "x", source: "y", time: "t", data: null });
    off();
    ctrl.fireEvent({ type: "x", source: "y", time: "t", data: null });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("reportStatus and reportComplete surface to onReport", () => {
    const ctrl = createMockHost({ moduleId: "counter", instanceId: "inst-1" });
    const reports: any[] = [];
    ctrl.onReport((r) => reports.push(r));
    ctrl.host.reportStatus("count", 42);
    ctrl.host.reportComplete("goal hit");
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      kind: "widget.event",
      moduleId: "counter",
      instanceId: "inst-1",
      key: "count",
      value: 42,
    });
    expect(reports[1]).toMatchObject({
      key: "complete",
      value: { reason: "goal hit" },
    });
  });

  it("install() replaces window.widgetHost; uninstall restores", () => {
    const ctrl = createMockHost({ moduleId: "counter" });
    restore = ctrl.install();
    expect((globalThis.window as any).widgetHost).toBe(ctrl.host);
    restore();
    restore = null;
    expect((globalThis.window as any).widgetHost).toBeUndefined();
  });

  it("reset() clears subscribers and cache", () => {
    const ctrl = createMockHost({ storage: { x: 1 } });
    const cb = mock(() => {});
    ctrl.host.storage.subscribe("x", cb);
    ctrl.host.onEvent(cb);
    ctrl.onReport(cb);
    ctrl.reset();
    ctrl.fireEvent({ type: "x", source: "y", time: "t", data: null });
    ctrl.setStorage("x", 9);
    ctrl.host.reportStatus("k", 1);
    // The fire-on-subscribe microtask may have already run from the
    // initial subscribe; reset() also drops the cached value.
    expect(cb).toHaveBeenCalledTimes(0);
  });
});
