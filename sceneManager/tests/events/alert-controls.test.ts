import { describe, expect, it } from "bun:test";
import { clearQueuedAlerts, NO_OVERLAY_OPEN, replayAlert, skipCurrentAlerts } from "../../src/events/alert-controls";
import { CANCEL_EVENT, DeliveryStore } from "../../src/events/delivery-store";
import type { OverlayWidgetInstance } from "../../src/scene/scene-host";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
}

/** The db proxy as the controls and the delivery store see it, recording every write. */
function fakeDb(alertRows: Record<string, { payload: string; workflowId?: string; sourceEventId?: string }> = {}) {
  let nextEventId = 0;
  const writes = {
    completions: [] as Array<{ sceneEventId: string; instanceId: string }>,
    lifecycle: [] as Array<{ envelopeId: string; status: string; error: string }>,
    created: [] as Array<{ payload: string; workflowId: string; sourceEventId: string; envelopeId: string }>,
    statuses: [] as Array<{ id: string; status: string }>,
  };
  const db = {
    recordSceneEvent: async (req: { sceneId: string; type: string; key: string }) => {
      nextEventId += 1;
      return {
        status: { code: "OK" as const, message: "" },
        sceneEvent: { id: `evt-${nextEventId}`, sceneId: req.sceneId, type: req.type, key: req.key, value: "" },
      };
    },
    recordSceneEventCompletion: async (req: { sceneEventId: string; instanceId: string }) => {
      writes.completions.push(req);
      return {};
    },
    updateAlertLifecycle: async (req: { envelopeId: string; status: string; error: string }) => {
      writes.lifecycle.push(req);
      return {};
    },
    getAlert: async (req: { id: string }) => {
      const row = alertRows[req.id];
      if (!row) {
        throw new Error("db.getAlert: not_found: alert not found");
      }
      return {
        alert: {
          id: req.id,
          payload: row.payload,
          workflowId: row.workflowId ?? "",
          sourceEventId: row.sourceEventId ?? "",
        },
      };
    },
    createAlert: async (req: { payload: string; workflowId: string; sourceEventId: string; envelopeId: string }) => {
      writes.created.push(req);
      return {};
    },
    updateAlertStatus: async (req: { id: string; status: string }) => {
      writes.statuses.push(req);
      return {};
    },
  };
  return { db, writes };
}

/** One open overlay page: every SSE frame the server pushed to it, parsed. */
function fakeOverlay(store: DeliveryStore, sceneId: string) {
  const frames: Array<{ event: string; data: any }> = [];
  const controller = {
    enqueue: (chunk: Uint8Array) => {
      const raw = new TextDecoder().decode(chunk);
      const event = raw
        .split("\n")
        .find((line) => line.startsWith("event: "))!
        .slice("event: ".length);
      const data = JSON.parse(
        raw
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice("data: ".length)
      );
      frames.push({ event, data });
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  store.subscribe(sceneId, controller);
  return {
    frames,
    cancels: () => frames.filter((frame) => frame.event === CANCEL_EVENT).map((frame) => frame.data),
    deliveries: () => frames.filter((frame) => frame.event === "delivery").map((frame) => frame.data),
  };
}

async function queueAlert(store: DeliveryStore, sceneId: string, alertId: string, instanceIds: string[]) {
  return store.recordEvent({
    sceneId,
    type: "alert",
    key: alertId,
    value: { alertId },
    targetInstanceIds: instanceIds,
  });
}

function alertInstance(id: string, name: string): OverlayWidgetInstance {
  return {
    id,
    widgetCanonicalId: "woofx3:widget:alert",
    moduleId: "woofx3",
    manifestId: "alert",
    position: { x: 0, y: 0, width: 100, height: 100 },
    settings: { name },
    hostsSurface: "alert",
    frameUrl: "",
    resolved: true,
  };
}

const catalog = [
  { moduleKey: "woofx3", manifestId: "text", entry: "index.html", surfaces: ["alert"], hostsSurface: "" },
];

function fakeHost(scenes: Record<string, OverlayWidgetInstance[]>) {
  return {
    loadWidgetCatalog: async () => catalog,
    loadSceneById: async (sceneId: string) =>
      scenes[sceneId] ? { sceneId, name: sceneId, layout: {}, instances: scenes[sceneId]! } : null,
  };
}

function envelope(target = "default") {
  return JSON.stringify({
    id: "env-original",
    parameters: {
      target,
      layout: {
        width: 1920,
        height: 1080,
        widgets: [{ id: "t1", widgetCanonicalId: "woofx3:widget:text", position: { x: 0, y: 0 }, settings: {} }],
      },
    },
    event: { type: "channel.raid", data: { raiders: 50 } },
  });
}

describe("skipCurrentAlerts", () => {
  it("ends the playing alert on every alert widget and marks it skipped", async () => {
    const { db, writes } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    const obs = fakeOverlay(store, "scene-1");
    await queueAlert(store, "scene-1", "alert-a", ["left", "right"]);
    await queueAlert(store, "scene-1", "alert-b", ["left", "right"]);

    const result = await skipCurrentAlerts({ db, deliveryStore: store, logger: fakeLogger() });

    expect(result).toEqual({ ok: true, skipped: 1 });
    expect(obs.cancels()).toEqual([
      { instanceId: "left", eventIds: ["evt-1"] },
      { instanceId: "right", eventIds: ["evt-1"] },
    ]);
    expect(writes.completions).toEqual([
      { sceneEventId: "evt-1", instanceId: "left" },
      { sceneEventId: "evt-1", instanceId: "right" },
    ]);
    expect(writes.lifecycle).toEqual([{ envelopeId: "alert-a", status: "skipped", error: "" }]);
    // The next alert is now the one playing.
    expect([...store.openDeliveriesByInstance("scene-1", "alert").get("left")!]).toEqual([
      { eventId: "evt-2", key: "alert-b" },
    ]);
  });

  it("acts on every open scene", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    const first = fakeOverlay(store, "scene-1");
    const second = fakeOverlay(store, "scene-2");
    await queueAlert(store, "scene-1", "alert-a", ["inst-1"]);
    await queueAlert(store, "scene-2", "alert-b", ["inst-2"]);

    const result = await skipCurrentAlerts({ db, deliveryStore: store, logger: fakeLogger() });

    expect(result).toEqual({ ok: true, skipped: 2 });
    expect(first.cancels()).toEqual([{ instanceId: "inst-1", eventIds: ["evt-1"] }]);
    expect(second.cancels()).toEqual([{ instanceId: "inst-2", eventIds: ["evt-2"] }]);
  });

  it("leaves deliveries that are not alerts alone", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    const obs = fakeOverlay(store, "scene-1");
    await store.recordEvent({
      sceneId: "scene-1",
      type: "widget.event",
      key: "count",
      value: 1,
      targetInstanceIds: ["c"],
    });

    const result = await skipCurrentAlerts({ db, deliveryStore: store, logger: fakeLogger() });

    expect(result).toEqual({ ok: true, skipped: 0 });
    expect(obs.cancels()).toEqual([]);
  });

  it("reports nothing playing as zero skipped", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    fakeOverlay(store, "scene-1");

    expect(await skipCurrentAlerts({ db, deliveryStore: store, logger: fakeLogger() })).toEqual({
      ok: true,
      skipped: 0,
    });
  });

  it("refuses when no overlay is open", async () => {
    const { db, writes } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());

    expect(await skipCurrentAlerts({ db, deliveryStore: store, logger: fakeLogger() })).toEqual({
      ok: false,
      skipped: 0,
      reason: NO_OVERLAY_OPEN,
    });
    expect(writes.lifecycle).toEqual([]);
  });

  it("still answers when the alert row is missing", async () => {
    const { db } = fakeDb();
    db.updateAlertLifecycle = async () => {
      throw new Error("db.updateAlertLifecycle: not_found");
    };
    const store = new DeliveryStore(db as any, fakeLogger());
    fakeOverlay(store, "scene-1");
    await queueAlert(store, "scene-1", "alert-a", ["inst-1"]);

    expect(await skipCurrentAlerts({ db, deliveryStore: store, logger: fakeLogger() })).toEqual({
      ok: true,
      skipped: 1,
    });
  });
});

describe("clearQueuedAlerts", () => {
  it("drops the waiting alerts, keeps the playing one, and marks each dropped alert skipped", async () => {
    const { db, writes } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    const obs = fakeOverlay(store, "scene-1");
    await queueAlert(store, "scene-1", "alert-a", ["inst-1"]);
    await queueAlert(store, "scene-1", "alert-b", ["inst-1"]);
    await queueAlert(store, "scene-1", "alert-c", ["inst-1"]);

    const result = await clearQueuedAlerts({ db, deliveryStore: store, logger: fakeLogger() });

    expect(result).toEqual({ ok: true, cleared: 2 });
    expect(obs.cancels()).toEqual([{ instanceId: "inst-1", eventIds: ["evt-2", "evt-3"] }]);
    expect(writes.lifecycle.map((write) => write.envelopeId)).toEqual(["alert-b", "alert-c"]);
    expect(writes.lifecycle.every((write) => write.status === "skipped")).toBe(true);
    expect([...store.openDeliveriesByInstance("scene-1", "alert").get("inst-1")!]).toEqual([
      { eventId: "evt-1", key: "alert-a" },
    ]);
  });

  it("closed deliveries are not replayed to an overlay that reconnects", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    fakeOverlay(store, "scene-1");
    await queueAlert(store, "scene-1", "alert-a", ["inst-1"]);
    await queueAlert(store, "scene-1", "alert-b", ["inst-1"]);
    await clearQueuedAlerts({ db, deliveryStore: store, logger: fakeLogger() });

    const reconnected = fakeOverlay(store, "scene-1");

    expect(reconnected.deliveries().map((delivery) => delivery.key)).toEqual(["alert-a"]);
  });

  it("refuses when no overlay is open", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());

    expect(await clearQueuedAlerts({ db, deliveryStore: store, logger: fakeLogger() })).toEqual({
      ok: false,
      cleared: 0,
      reason: NO_OVERLAY_OPEN,
    });
  });
});

describe("replayAlert", () => {
  function setup(rows: Parameters<typeof fakeDb>[0], scenes: Record<string, OverlayWidgetInstance[]>) {
    const { db, writes } = fakeDb(rows);
    const store = new DeliveryStore(db as any, fakeLogger());
    const overlays = Object.keys(scenes).map((sceneId) => fakeOverlay(store, sceneId));
    const deps = {
      db,
      host: fakeHost(scenes) as any,
      deliveryStore: store,
      logger: fakeLogger(),
      newEnvelopeId: () => "env-replay",
    };
    return { writes, overlays, deps };
  }

  it("re-dispatches the stored envelope under a fresh id and marks the original replayed", async () => {
    const { writes, overlays, deps } = setup(
      { "row-1": { payload: envelope(), workflowId: "run-1", sourceEventId: "ce-1" } },
      { "scene-1": [alertInstance("inst-1", "default")] }
    );

    const result = await replayAlert("row-1", deps);

    expect(result).toEqual({ ok: true, replayEnvelopeId: "env-replay" });
    expect(writes.created).toHaveLength(1);
    expect(writes.created[0]).toMatchObject({ envelopeId: "env-replay", workflowId: "run-1", sourceEventId: "ce-1" });
    expect(JSON.parse(writes.created[0]!.payload).id).toBe("env-replay");
    const delivered = overlays[0]!.deliveries();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ instanceId: "inst-1", type: "alert", key: "env-replay" });
    expect(delivered[0].value.event).toEqual({ type: "channel.raid", data: { raiders: 50 } });
    expect(writes.statuses).toEqual([{ id: "row-1", status: "replayed" }]);
  });

  it("refuses when no overlay is open, before touching the alert log", async () => {
    const { writes, deps } = setup({ "row-1": { payload: envelope() } }, {});

    expect(await replayAlert("row-1", deps)).toEqual({ ok: false, reason: NO_OVERLAY_OPEN });
    expect(writes.created).toEqual([]);
  });

  it("refuses an unknown alert", async () => {
    const { deps } = setup({}, { "scene-1": [alertInstance("inst-1", "default")] });

    const result = await replayAlert("row-missing", deps);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("row-missing");
  });

  it("refuses a row with no usable envelope", async () => {
    const { deps } = setup({ "row-1": { payload: "not json" } }, { "scene-1": [alertInstance("inst-1", "default")] });

    expect(await replayAlert("row-1", deps)).toEqual({
      ok: false,
      reason: "alert row-1 has no stored envelope to replay",
    });
  });

  it("says so, records the replay failed, and leaves the original alone when no alert widget matches", async () => {
    const { writes, deps } = setup(
      { "row-1": { payload: envelope("sidebar") } },
      { "scene-1": [alertInstance("inst-1", "default")] }
    );

    const result = await replayAlert("row-1", deps);

    expect(result).toEqual({ ok: false, reason: 'no alert widget named "sidebar" on a running scene' });
    expect(writes.lifecycle).toEqual([
      { envelopeId: "env-replay", status: "failed", error: 'no alert widget named "sidebar" on a running scene' },
    ]);
    expect(writes.statuses).toEqual([]);
  });
});
