import { describe, expect, it } from "bun:test";
import type { AlertQueueState } from "@woofx3/api";
import {
  AlertReplays,
  clearQueuedAlerts,
  NO_OVERLAY_OPEN,
  REPLAY_DEDUPE_MS,
  readAlertQueue,
  replayAlert,
  skipCurrentAlerts,
} from "../../src/events/alert-controls";
import { dispatchAlert, presentAlertDeliveries } from "../../src/events/alert-dispatch";
import { DeliveryStore } from "../../src/events/delivery-store";
import type { AlertFraming } from "../../src/scene/frame-catalog";
import type { OverlayWidgetInstance } from "../../src/scene/scene-host";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
}

/** Frames every layout widget at a frame URL named after its widget. */
function fakeFraming(): AlertFraming {
  return {
    frameAlert: async (layout) =>
      Object.fromEntries(
        Object.entries(layout.widgets).map(([id, placement]) => [
          id,
          { frameUrl: `/frames/${placement.widget}?v=1`, linkedResources: {} },
        ])
      ),
  };
}

/** The db proxy as the controls and the delivery store see it, recording every write. */
function fakeDb(alertRows: Record<string, { payload: string; workflowId?: string; sourceEventId?: string }> = {}) {
  let nextEventId = 0;
  const writes = {
    completions: [] as Array<{ sceneEventId: string; instanceId: string }>,
    lifecycle: [] as Array<{ id: string; envelopeId: string; status: string; error: string }>,
    created: [] as Array<{ payload: string; workflowId: string; sourceEventId: string; envelopeId: string }>,
    replayed: [] as Array<{ id: string }>,
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
    updateAlertLifecycle: async (req: { id: string; envelopeId: string; status: string; error: string }) => {
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
      return { alert: { id: `row-${req.envelopeId}` } };
    },
    markAlertReplayed: async (req: { id: string }) => {
      writes.replayed.push(req);
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
    cancels: () => frames.filter((frame) => frame.event === "cancel").map((frame) => frame.data),
    deliveries: () => frames.filter((frame) => frame.event === "delivery").map((frame) => frame.data),
  };
}

/** Queue an alert as dispatchAlert does; without `rowId`, as one recorded before deliveries carried it. */
async function queueAlert(
  store: DeliveryStore,
  sceneId: string,
  alertId: string,
  instanceIds: string[],
  rowId?: string
) {
  return store.recordEvent({
    sceneId,
    type: "alert",
    key: alertId,
    value: rowId ? { alertId, rowId } : { alertId },
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
    visible: true,
  };
}

const catalog = [
  { moduleKey: "woofx3", manifestId: "text", entry: "index.html", surfaces: ["alert"], hostsSurface: "" },
];

/** A host over scenes by id; ids in `alerts` load as alert compositions. */
function fakeHost(scenes: Record<string, OverlayWidgetInstance[]>, alerts: ReadonlySet<string> = new Set()) {
  return {
    loadWidgetCatalog: async () => catalog,
    loadSceneById: async (sceneId: string) =>
      scenes[sceneId]
        ? {
            sceneId,
            name: sceneId,
            kind: alerts.has(sceneId) ? "alert" : "scene",
            behaviors: {},
            inputs: [],
            layout: {},
            instances: scenes[sceneId]!,
          }
        : null,
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

/** Every scene's alert widgets, as the scene host would load them. */
const sceneWidgets: Record<string, OverlayWidgetInstance[]> = {
  "scene-1": [alertInstance("left", "default"), alertInstance("right", "default"), alertInstance("inst-1", "default")],
  "scene-2": [alertInstance("inst-2", "default")],
};

function queueDeps(db: ReturnType<typeof fakeDb>["db"], store: DeliveryStore) {
  return {
    db,
    host: fakeHost(sceneWidgets) as any,
    deliveryStore: store,
    framing: fakeFraming(),
    logger: fakeLogger(),
  };
}

/** What each alert widget still has open, by instance, as event ids. */
function openIds(store: DeliveryStore, sceneId: string) {
  const out: Record<string, string[]> = {};
  for (const [instanceId, open] of store.openDeliveriesByInstance(sceneId, "alert")) {
    out[instanceId] = open.map((delivery) => delivery.eventId);
  }
  return out;
}

describe("skipCurrentAlerts", () => {
  it("ends the playing alert on every alert widget and marks it skipped", async () => {
    const { db, writes } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    const obs = fakeOverlay(store, "scene-1");
    await queueAlert(store, "scene-1", "alert-a", ["left", "right"]);
    await queueAlert(store, "scene-1", "alert-b", ["left", "right"]);
    store.markStarted("scene-1", "evt-1", ["left", "right"]);

    const result = await skipCurrentAlerts(queueDeps(db, store));

    expect(result).toEqual({ ok: true, skipped: 1 });
    expect(obs.cancels()).toEqual([
      { instanceId: "left", eventIds: ["evt-1"] },
      { instanceId: "right", eventIds: ["evt-1"] },
    ]);
    expect(writes.completions).toEqual([
      { sceneEventId: "evt-1", instanceId: "left" },
      { sceneEventId: "evt-1", instanceId: "right" },
    ]);
    expect(writes.lifecycle).toEqual([{ id: "", envelopeId: "alert-a", status: "skipped", error: "" }]);
    expect(openIds(store, "scene-1")).toEqual({ left: ["evt-2"], right: ["evt-2"] });
  });

  // A workflow that pins the envelope id plays it more than once; two plays on
  // different scenes can be on screen together, and each is its own row.
  it("marks each overlapping play of one envelope skipped against its own row", async () => {
    const { db, writes } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    fakeOverlay(store, "scene-1");
    fakeOverlay(store, "scene-2");
    await queueAlert(store, "scene-1", "alert-a", ["left", "right"], "row-1");
    await queueAlert(store, "scene-2", "alert-a", ["inst-2"], "row-2");
    store.markStarted("scene-1", "evt-1", ["left", "right"]);
    store.markStarted("scene-2", "evt-2", ["inst-2"]);

    expect(await skipCurrentAlerts(queueDeps(db, store))).toEqual({ ok: true, skipped: 2 });
    expect(writes.lifecycle).toEqual([
      { id: "row-1", envelopeId: "alert-a", status: "skipped", error: "" },
      { id: "row-2", envelopeId: "alert-a", status: "skipped", error: "" },
    ]);
  });

  // The page acks an alert's end separately from the next one's start, so for
  // a moment both are open and started.
  it("skips the alert started last, not one that finished but is not acked yet", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    const obs = fakeOverlay(store, "scene-1");
    await queueAlert(store, "scene-1", "alert-a", ["inst-1"]);
    await queueAlert(store, "scene-1", "alert-b", ["inst-1"]);
    store.markStarted("scene-1", "evt-1", ["inst-1"], 1_000);
    store.markStarted("scene-1", "evt-2", ["inst-1"], 6_000);

    expect(await skipCurrentAlerts(queueDeps(db, store))).toEqual({ ok: true, skipped: 1 });
    expect(obs.cancels()).toEqual([{ instanceId: "inst-1", eventIds: ["evt-2"] }]);
  });

  // A double-clicked Skip arrives as two overlapping requests. Each must see
  // the other's effect whole, or the two widgets end different alerts.
  it("keeps alert widgets in step when two skips overlap", async () => {
    const { db } = fakeDb();
    const recordCompletion = db.recordSceneEventCompletion;
    db.recordSceneEventCompletion = async (req) => {
      await Bun.sleep(5);
      return recordCompletion(req);
    };
    const store = new DeliveryStore(db as any, fakeLogger());
    const obs = fakeOverlay(store, "scene-1");
    await queueAlert(store, "scene-1", "alert-a", ["left", "right"]);
    await queueAlert(store, "scene-1", "alert-b", ["left", "right"]);
    store.markStarted("scene-1", "evt-1", ["left", "right"]);

    const [first, second] = await Promise.all([
      skipCurrentAlerts(queueDeps(db, store)),
      skipCurrentAlerts(queueDeps(db, store)),
    ]);

    expect([first.skipped, second.skipped].sort()).toEqual([0, 1]);
    expect(obs.cancels()).toEqual([
      { instanceId: "left", eventIds: ["evt-1"] },
      { instanceId: "right", eventIds: ["evt-1"] },
    ]);
    expect(openIds(store, "scene-1")).toEqual({ left: ["evt-2"], right: ["evt-2"] });
  });

  it("acts on every open scene", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    const first = fakeOverlay(store, "scene-1");
    const second = fakeOverlay(store, "scene-2");
    await queueAlert(store, "scene-1", "alert-a", ["inst-1"]);
    await queueAlert(store, "scene-2", "alert-b", ["inst-2"]);
    store.markStarted("scene-1", "evt-1", ["inst-1"]);
    store.markStarted("scene-2", "evt-2", ["inst-2"]);

    expect(await skipCurrentAlerts(queueDeps(db, store))).toEqual({ ok: true, skipped: 2 });
    expect(first.cancels()).toEqual([{ instanceId: "inst-1", eventIds: ["evt-1"] }]);
    expect(second.cancels()).toEqual([{ instanceId: "inst-2", eventIds: ["evt-2"] }]);
  });

  it("skips nothing when no page has started an alert", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    const obs = fakeOverlay(store, "scene-1");
    await queueAlert(store, "scene-1", "alert-a", ["inst-1"]);

    expect(await skipCurrentAlerts(queueDeps(db, store))).toEqual({ ok: true, skipped: 0 });
    expect(obs.cancels()).toEqual([]);
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
    store.markStarted("scene-1", "evt-1", ["c"]);

    expect(await skipCurrentAlerts(queueDeps(db, store))).toEqual({ ok: true, skipped: 0 });
    expect(obs.cancels()).toEqual([]);
  });

  it("refuses when no overlay is open", async () => {
    const { db, writes } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());

    expect(await skipCurrentAlerts(queueDeps(db, store))).toEqual({ ok: false, skipped: 0, reason: NO_OVERLAY_OPEN });
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
    store.markStarted("scene-1", "evt-1", ["inst-1"]);

    expect(await skipCurrentAlerts(queueDeps(db, store))).toEqual({ ok: true, skipped: 1 });
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
    store.markStarted("scene-1", "evt-1", ["inst-1"]);

    const result = await clearQueuedAlerts(queueDeps(db, store));

    expect(result).toEqual({ ok: true, cleared: 2 });
    expect(obs.cancels()).toEqual([{ instanceId: "inst-1", eventIds: ["evt-2", "evt-3"] }]);
    expect(writes.lifecycle.map((write) => write.envelopeId)).toEqual(["alert-b", "alert-c"]);
    expect(writes.lifecycle.every((write) => write.status === "skipped")).toBe(true);
    expect(openIds(store, "scene-1")).toEqual({ "inst-1": ["evt-1"] });
  });

  it("neither cancels nor counts deliveries to a widget the scene no longer has", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    const obs = fakeOverlay(store, "scene-1");
    await queueAlert(store, "scene-1", "alert-a", ["removed"]);

    expect(await clearQueuedAlerts(queueDeps(db, store))).toEqual({ ok: true, cleared: 0 });
    expect(obs.cancels()).toEqual([]);
  });

  it("closed deliveries are not replayed to an overlay that reconnects", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    fakeOverlay(store, "scene-1");
    await queueAlert(store, "scene-1", "alert-a", ["inst-1"]);
    await queueAlert(store, "scene-1", "alert-b", ["inst-1"]);
    store.markStarted("scene-1", "evt-1", ["inst-1"]);
    await clearQueuedAlerts(queueDeps(db, store));

    const reconnected = fakeOverlay(store, "scene-1");

    expect(reconnected.deliveries().map((delivery) => delivery.key)).toEqual(["alert-a"]);
  });

  it("refuses when no overlay is open", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());

    expect(await clearQueuedAlerts(queueDeps(db, store))).toEqual({ ok: false, cleared: 0, reason: NO_OVERLAY_OPEN });
  });
});

describe("readAlertQueue", () => {
  const at = (ms: number) => new Date(ms).toISOString();

  type QueueSetup = (store: DeliveryStore) => Promise<void>;
  const cases: Array<{ name: string; open: string[]; setup: QueueSetup; expected: AlertQueueState }> = [
    {
      name: "refuses when no overlay is open",
      open: [],
      setup: async () => {},
      expected: { ok: false, playing: [], waiting: [], reason: NO_OVERLAY_OPEN },
    },
    {
      name: "is empty when nothing is queued",
      open: ["scene-1"],
      setup: async () => {},
      expected: { ok: true, playing: [], waiting: [] },
    },
    {
      name: "lists the playing alert and the ones waiting behind it",
      open: ["scene-1"],
      setup: async (store) => {
        await queueAlert(store, "scene-1", "alert-a", ["inst-1"], "row-a");
        await queueAlert(store, "scene-1", "alert-b", ["inst-1"], "row-b");
        await queueAlert(store, "scene-1", "alert-c", ["inst-1"]);
        store.markStarted("scene-1", "evt-1", ["inst-1"], 1_000);
      },
      expected: {
        ok: true,
        playing: [{ alertId: "row-a", envelopeId: "alert-a", startedAt: at(1_000) }],
        waiting: [
          { alertId: "row-b", envelopeId: "alert-b" },
          { alertId: "", envelopeId: "alert-c" },
        ],
      },
    },
    {
      name: "counts an alert on several widgets once, with its earliest start",
      open: ["scene-1"],
      setup: async (store) => {
        await queueAlert(store, "scene-1", "alert-a", ["left", "right"], "row-a");
        store.markStarted("scene-1", "evt-1", ["right"], 2_000);
        store.markStarted("scene-1", "evt-1", ["left"], 3_000);
      },
      expected: { ok: true, playing: [{ alertId: "row-a", envelopeId: "alert-a", startedAt: at(2_000) }], waiting: [] },
    },
    {
      name: "lists an alert playing on one widget and queued on another as playing",
      open: ["scene-1"],
      setup: async (store) => {
        await queueAlert(store, "scene-1", "alert-a", ["left", "right"], "row-a");
        store.markStarted("scene-1", "evt-1", ["left"], 1_000);
      },
      expected: { ok: true, playing: [{ alertId: "row-a", envelopeId: "alert-a", startedAt: at(1_000) }], waiting: [] },
    },
    {
      name: "keeps two plays of one envelope apart by their rows",
      open: ["scene-1", "scene-2"],
      setup: async (store) => {
        await queueAlert(store, "scene-1", "alert-a", ["inst-1"], "row-1");
        await queueAlert(store, "scene-2", "alert-a", ["inst-2"], "row-2");
        store.markStarted("scene-2", "evt-2", ["inst-2"], 1_000);
      },
      expected: {
        ok: true,
        playing: [{ alertId: "row-2", envelopeId: "alert-a", startedAt: at(1_000) }],
        waiting: [{ alertId: "row-1", envelopeId: "alert-a" }],
      },
    },
    {
      name: "leaves out deliveries that are not alerts and widgets the scene no longer has",
      open: ["scene-1"],
      setup: async (store) => {
        await store.recordEvent({
          sceneId: "scene-1",
          type: "widget.event",
          key: "k",
          value: 1,
          targetInstanceIds: ["c"],
        });
        await queueAlert(store, "scene-1", "alert-a", ["removed"], "row-a");
      },
      expected: { ok: true, playing: [], waiting: [] },
    },
  ];

  for (const { name, open, setup, expected } of cases) {
    it(name, async () => {
      const { db, writes } = fakeDb();
      const store = new DeliveryStore(db as any, fakeLogger());
      for (const sceneId of open) {
        fakeOverlay(store, sceneId);
      }
      await setup(store);

      expect(await readAlertQueue({ host: fakeHost(sceneWidgets) as any, deliveryStore: store })).toEqual(expected);
      expect(writes.lifecycle).toEqual([]);
      expect(writes.completions).toEqual([]);
    });
  }
});

describe("DeliveryStore bookkeeping", () => {
  it("forgets a scene once its last open delivery closes", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    fakeOverlay(store, "scene-1");
    await queueAlert(store, "scene-1", "alert-a", ["left", "right"]);
    await queueAlert(store, "scene-1", "alert-b", ["left"]);

    await store.cancel("scene-1", "left", ["evt-1", "evt-2"]);
    expect(store.scenesWithOpenDeliveries()).toEqual(["scene-1"]);
    await store.ackCompleted("scene-1", "evt-1", ["right"]);

    expect(store.scenesWithOpenDeliveries()).toEqual([]);
  });

  it("reports only the first start of each delivery", async () => {
    const { db } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    await queueAlert(store, "scene-1", "alert-a", ["left", "right"]);

    expect(store.markStarted("scene-1", "evt-1", ["left"], 5).map((d) => d.key)).toEqual(["alert-a"]);
    expect(store.markStarted("scene-1", "evt-1", ["left"], 6)).toEqual([]);
    expect(store.markStarted("scene-1", "evt-unknown", ["left"], 7)).toEqual([]);
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
      framing: fakeFraming(),
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
    const stored = JSON.parse(writes.created[0]!.payload);
    expect(stored.id).toBe("env-replay");
    expect(stored.rowId).toBeUndefined();
    const delivered = overlays[0]!.deliveries();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ instanceId: "inst-1", type: "alert", key: "env-replay" });
    expect(delivered[0].value.event).toEqual({ type: "channel.raid", data: { raiders: 50 } });
    expect(delivered[0].value.rowId).toBe("row-env-replay");
    expect(writes.replayed).toEqual([{ id: "row-1" }]);
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
      {
        id: "row-env-replay",
        envelopeId: "env-replay",
        status: "failed",
        error: 'no alert widget named "sidebar" on a running scene',
      },
    ]);
    expect(writes.replayed).toEqual([]);
  });
});

describe("dispatchAlert", () => {
  function setup(scenes: Record<string, OverlayWidgetInstance[]>, alerts: ReadonlySet<string> = new Set()) {
    const { db, writes } = fakeDb();
    const store = new DeliveryStore(db as any, fakeLogger());
    const overlays = Object.keys(scenes).map((sceneId) => fakeOverlay(store, sceneId));
    return {
      writes,
      overlays,
      deps: {
        db,
        host: fakeHost(scenes, alerts) as any,
        deliveryStore: store,
        framing: fakeFraming(),
        logger: fakeLogger(),
      },
    };
  }

  it("never delivers to an alert composition, even one with a stream open on it", async () => {
    const { overlays, deps } = setup(
      {
        "scene-1": [alertInstance("inst-1", "default")],
        "alert-1": [alertInstance("inst-2", "default")],
      },
      new Set(["alert-1"])
    );

    await dispatchAlert({ ...JSON.parse(envelope()), rowId: "row-9" }, deps);

    expect(overlays[0]!.deliveries()).toHaveLength(1);
    expect(overlays[1]!.deliveries()).toEqual([]);
  });

  it("logs where the dispatch's time went, read from the injected clock", async () => {
    const { deps } = setup({ "scene-1": [alertInstance("inst-1", "default")] });
    const logged: Array<{ message: string; fields: Record<string, unknown> }> = [];
    let time = 0;

    await dispatchAlert(
      { ...JSON.parse(envelope()), rowId: "row-9" },
      {
        ...deps,
        logger: {
          ...fakeLogger(),
          info: (message: string, fields: Record<string, unknown>) => logged.push({ message, fields }),
        },
        now: () => {
          time += 5;
          return time;
        },
      }
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]).toEqual({
      message: "ui.notify.alert: dispatched",
      fields: { alertId: "env-original", scenes: 1, layoutMs: 5, framesMs: 5, scenesMs: 5, recordMs: 5, totalMs: 45 },
    });
  });

  it("records where each layout widget's frame loads from", async () => {
    const { overlays, deps } = setup({ "scene-1": [alertInstance("inst-1", "default")] });

    await dispatchAlert({ ...JSON.parse(envelope()), rowId: "row-9" }, deps);

    const value = overlays[0]!.deliveries()[0].value as {
      layout: { widgets: Record<string, { widget: string }> };
      frames: unknown;
    };
    const expected = Object.fromEntries(
      Object.entries(value.layout.widgets).map(([id, placement]) => [
        id,
        { frameUrl: `/frames/${placement.widget}?v=1`, linkedResources: {} },
      ])
    );
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    expect(value.frames).toEqual(expected);
  });

  it("carries the engine's row id into the delivery", async () => {
    const { overlays, deps } = setup({ "scene-1": [alertInstance("inst-1", "default")] });

    await dispatchAlert({ ...JSON.parse(envelope()), rowId: "row-9" }, deps);

    expect(overlays[0]!.deliveries()[0].value).toMatchObject({ alertId: "env-original", rowId: "row-9" });
  });

  it("records a refusal against the engine's row", async () => {
    const { writes, deps } = setup({ "scene-1": [alertInstance("inst-1", "default")] });

    await dispatchAlert({ ...JSON.parse(envelope("sidebar")), rowId: "row-9" }, deps);

    expect(writes.lifecycle).toEqual([
      {
        id: "row-9",
        envelopeId: "env-original",
        status: "failed",
        error: 'no alert widget named "sidebar" on a running scene',
      },
    ]);
  });

  it("delivers a composition, converting a list-shaped layout", async () => {
    const { overlays, deps } = setup({ "scene-1": [alertInstance("inst-1", "default")] });

    await dispatchAlert(JSON.parse(envelope()), deps);

    const { layout } = overlays[0]!.deliveries()[0].value as { layout: Record<string, any> };
    expect(layout.layout).toEqual({ width: 1920, height: 1080 });
    expect(layout.behaviors).toEqual({});
    expect(layout.widgets.t1).toMatchObject({ widget: "woofx3:widget:text", visible: true });
  });

  it("refuses a layout whose every widget is hidden, since a hidden widget does not play", async () => {
    const { writes, overlays, deps } = setup({ "scene-1": [alertInstance("inst-1", "default")] });
    const hidden = {
      widget: "woofx3:widget:text",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      visible: false,
      z: "a0",
      settings: {},
      name: "",
      rotation: 0,
      opacity: 1,
      locked: false,
      extra: {},
    };

    const outcome = await dispatchAlert(
      {
        id: "env-hidden",
        rowId: "row-3",
        parameters: { layout: { layout: { width: 100, height: 100 }, widgets: { t1: hidden }, behaviors: {} } },
      },
      deps
    );

    expect(outcome).toEqual({ ok: false, reason: "every widget in the layout is hidden" });
    expect(overlays[0]!.deliveries()).toEqual([]);
    expect(writes.lifecycle).toEqual([
      { id: "row-3", envelopeId: "env-hidden", status: "failed", error: "every widget in the layout is hidden" },
    ]);
  });
});

describe("AlertReplays", () => {
  function counting(result: { ok: boolean; replayEnvelopeId?: string; reason?: string }) {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { db } = fakeDb({ "row-1": { payload: envelope() } });
    const store = new DeliveryStore(db as any, fakeLogger());
    fakeOverlay(store, "scene-1");
    db.getAlert = async (req) => {
      calls += 1;
      await gate;
      if (!result.ok) {
        throw new Error(result.reason);
      }
      return { alert: { id: req.id, payload: envelope(), workflowId: "", sourceEventId: "" } };
    };
    const deps = {
      db,
      host: fakeHost({ "scene-1": [alertInstance("inst-1", "default")] }) as any,
      deliveryStore: store,
      framing: fakeFraming(),
      logger: fakeLogger(),
      newEnvelopeId: () => `env-${calls}`,
    };
    return { deps, calls: () => calls, release };
  }

  // The api gives up on a slow replay and the operator presses Replay again.
  it("answers a repeat request with the replay already under way", async () => {
    const { deps, calls, release } = counting({ ok: true });
    let now = 0;
    const replays = new AlertReplays(deps, () => now);

    const first = replays.replay("row-1");
    const second = replays.replay("row-1");
    release();

    expect(await second).toEqual(await first);
    expect(calls()).toBe(1);

    now = REPLAY_DEDUPE_MS - 1;
    expect(await replays.replay("row-1")).toEqual(await first);
    expect(calls()).toBe(1);

    now = REPLAY_DEDUPE_MS * 2;
    await replays.replay("row-1");
    expect(calls()).toBe(2);
  });

  it("does not remember a refused replay", async () => {
    const { deps, calls, release } = counting({ ok: false, reason: "db down" });
    const replays = new AlertReplays(deps, () => 0);
    release();

    expect((await replays.replay("row-1")).ok).toBe(false);
    await replays.replay("row-1");

    expect(calls()).toBe(2);
  });
});

describe("presentAlertDeliveries", () => {
  it("presents only alert deliveries through the media proxy", () => {
    const present = presentAlertDeliveries({ alertDelivery: (value) => ({ signed: value }) });
    const base = { eventId: "e1", instanceId: "i1", key: "k" };

    expect(present({ ...base, type: "alert", value: 1 }).value).toEqual({ signed: 1 });
    expect(present({ ...base, type: "widget.event", value: 1 }).value).toBe(1);
  });
});
