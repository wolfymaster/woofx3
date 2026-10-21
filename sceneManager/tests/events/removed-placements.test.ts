import { describe, expect, it, mock } from "bun:test";
import { DeliveryStore } from "../../src/events/delivery-store";
import { closeDeliveriesToRemovedPlacements } from "../../src/events/removed-placements";
import { OverlayHost } from "../../src/scene/scene-host";
import { OverlayTokenResolver } from "../../src/scene/token-resolver";

const quiet = { debug() {}, info() {}, warn() {}, error() {} } as never;
const OK = { code: "OK" as const, message: "" };

/** A store holding open deliveries to `a` (two events) and `gone` (one), and what it closed. */
async function storeWithDeliveries() {
  let next = 0;
  const completions: Array<{ sceneEventId: string; instanceId: string }> = [];
  const db = {
    recordSceneEvent: mock(async () => ({
      status: OK,
      sceneEvent: { id: `evt-${++next}`, sceneId: "s1", type: "alert", key: "k", value: "null", occurredAt: "" },
    })),
    recordSceneEventCompletion: mock(async (req: { sceneEventId: string; instanceId: string }) => {
      completions.push(req);
      return OK;
    }),
  } as never;
  const store = new DeliveryStore(db, quiet);
  await store.recordEvent({ sceneId: "s1", type: "alert", key: "k", value: null, targetInstanceIds: ["a", "gone"] });
  await store.recordEvent({ sceneId: "s1", type: "alert", key: "k", value: null, targetInstanceIds: ["a"] });
  return { store, completions };
}

describe("DeliveryStore.closeAbsent", () => {
  it("closes only the deliveries to placements not present, and records each closed", async () => {
    const { store, completions } = await storeWithDeliveries();
    expect(await store.closeAbsent("s1", new Set(["a"]))).toBe(1);
    expect(completions).toEqual([{ sceneEventId: "evt-1", instanceId: "gone" }]);
    expect(await store.closeAbsent("s1", new Set(["a"]))).toBe(0);
    expect(store.openDeliveriesByInstance("s1", "alert").get("a")?.length).toBe(2);
  });
});

describe("closeDeliveriesToRemovedPlacements", () => {
  it("closes deliveries to placements the scene no longer has", async () => {
    const { store, completions } = await storeWithDeliveries();
    const host = { placementIds: async () => new Set(["a"]) };
    await closeDeliveriesToRemovedPlacements("s1", { host, deliveryStore: store, logger: quiet });
    expect(completions.map((c) => c.instanceId)).toEqual(["gone"]);
  });

  it("closes nothing for a scene it cannot read, or that is not there", async () => {
    const { store, completions } = await storeWithDeliveries();
    const unreadable = {
      placementIds: async () => {
        throw new Error("db down");
      },
    };
    await closeDeliveriesToRemovedPlacements("s1", { host: unreadable, deliveryStore: store, logger: quiet });
    await closeDeliveriesToRemovedPlacements("s1", {
      host: { placementIds: async () => null },
      deliveryStore: store,
      logger: quiet,
    });
    expect(completions).toEqual([]);
  });
});

describe("OverlayHost.placementIds", () => {
  function hostWith(scene: Record<string, unknown> | null) {
    const db = {
      getScene: async () =>
        scene
          ? { status: OK, scene: { id: "s1", name: "S", layoutJson: "{}", ...scene } }
          : { status: { code: "NOT_FOUND", message: "" } },
      listWidgets: async () => ({ status: OK, widgets: [] }),
    };
    return new OverlayHost(
      new OverlayTokenResolver({ resolveOverlayToken: async () => ({}) } as never, quiet),
      db as never,
      quiet
    );
  }

  it("counts every stored placement of either version, parseable or not", async () => {
    const host = hostWith({
      widgetsJson: JSON.stringify([{ id: "a", widgetCanonicalId: "w:text" }, { id: "broken" }]),
      hasDraft: true,
      draftWidgetsJson: JSON.stringify([{ id: "d", widgetCanonicalId: "w:text" }]),
    });
    expect([...(await host.placementIds("s1"))!].sort()).toEqual(["a", "broken", "d"]);
  });

  it("ignores a stale draft column on a scene with no draft", async () => {
    const host = hostWith({ widgetsJson: "[]", hasDraft: false, draftWidgetsJson: JSON.stringify([{ id: "old" }]) });
    expect([...(await host.placementIds("s1"))!]).toEqual([]);
  });

  it("answers null for a missing scene or placements it cannot read as a list", async () => {
    expect(await hostWith(null).placementIds("s1")).toBeNull();
    expect(await hostWith({ widgetsJson: "{not json" }).placementIds("s1")).toBeNull();
    expect(await hostWith({ widgetsJson: '{"a":1}' }).placementIds("s1")).toBeNull();
  });
});

describe("DeliveryStore.ackCompleted racing a cancel", () => {
  it("does not report as completed a delivery a skip closed during the completion write", async () => {
    let releaseWrite: (() => void) | null = null;
    let next = 0;
    const db = {
      recordSceneEvent: mock(async () => ({
        status: OK,
        sceneEvent: { id: `evt-${++next}`, sceneId: "s1", type: "alert", key: "k", value: "null", occurredAt: "" },
      })),
      recordSceneEventCompletion: mock(
        () =>
          new Promise<typeof OK>((resolve) => {
            if (releaseWrite === null) {
              releaseWrite = () => resolve(OK);
            } else {
              resolve(OK);
            }
          })
      ),
    } as never;
    const store = new DeliveryStore(db, quiet);
    await store.recordEvent({ sceneId: "s1", type: "alert", key: "k", value: null, targetInstanceIds: ["a"] });

    const acking = store.ackCompleted("s1", "evt-1", ["a"]);
    await store.cancel("s1", "a", ["evt-1"]);
    releaseWrite!();

    expect((await acking).closed).toEqual([]);
  });
});
