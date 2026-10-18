import { describe, expect, it, mock } from "bun:test";
import type { OverlayWidgetInstance } from "../../src/scene/scene-host";
import { WidgetCatalog } from "../../src/scene/widget-catalog";

const logger = { debug: () => {}, info: () => {}, warn: mock(() => {}), error: () => {} };

function db(widgets: Array<Record<string, unknown>> | Error) {
  return {
    listWidgets: mock(async () => {
      if (widgets instanceof Error) {
        throw widgets;
      }
      return { status: { code: "OK" as const, message: "" }, widgets } as never;
    }),
  };
}

function placement(id: string, widgetCanonicalId: string): OverlayWidgetInstance {
  return { id, widgetCanonicalId, hostsSurface: "", resolved: true } as unknown as OverlayWidgetInstance;
}

describe("WidgetCatalog", () => {
  it("reads the catalog once per TTL", async () => {
    let now = 0;
    const store = db([{ moduleId: "woofx3", manifestId: "text" }]);
    const catalog = new WidgetCatalog(store, logger as never, { ttlMs: 100, now: () => now });
    await catalog.rows();
    await catalog.rows();
    now = 150;
    await catalog.rows();
    expect(store.listWidgets).toHaveBeenCalledTimes(2);
  });

  it("resolves placements, marking the ones naming no installed widget", async () => {
    const catalog = new WidgetCatalog(
      db([{ moduleId: "woofx3", manifestId: "text", hostsSurface: "" }]),
      logger as never
    );
    const resolved = await catalog.resolve(
      [placement("a", "woofx3:widget:text"), placement("b", "gone:widget:x")],
      "s1"
    );
    expect(resolved.map((p) => [p.id, p.resolved])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("assumes every placement resolves when the catalog cannot be read", async () => {
    const catalog = new WidgetCatalog(db(new Error("db down")), logger as never);
    const resolved = await catalog.resolve([placement("a", "woofx3:widget:text")], "s1");
    expect(resolved[0]!.resolved).toBe(true);
  });
});
