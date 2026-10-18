import { describe, expect, it, mock, setSystemTime } from "bun:test";
import { DeliveryStore } from "../../src/events/delivery-store";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function fakeController() {
  const frames: string[] = [];
  const controller = {
    enqueue: (chunk: Uint8Array) => {
      frames.push(new TextDecoder().decode(chunk));
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { controller, frames };
}

function parseFrame(raw: string): { eventId: string; instanceId: string; type: string; key: string; value: unknown } {
  const dataLine = raw.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(dataLine!.slice("data: ".length));
}

describe("DeliveryStore.recordEvent + subscribe", () => {
  it("persists then pushes a frame per target instance to connected subscribers", async () => {
    const db = {
      recordSceneEvent: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        sceneEvent: {
          id: "evt-1",
          sceneId: "scene-1",
          type: "widget.event",
          key: "count",
          value: "5",
          occurredAt: null,
          createdAt: null,
        },
      })),
    } as any;
    const store = new DeliveryStore(db, fakeLogger());
    const { controller, frames } = fakeController();
    store.subscribe("scene-1", controller);

    const eventId = await store.recordEvent({
      sceneId: "scene-1",
      type: "widget.event",
      key: "count",
      value: 5,
      targetInstanceIds: ["inst-a", "inst-b"],
    });

    expect(eventId).toBe("evt-1");
    expect(frames.length).toBe(2);
    const parsed = frames.map(parseFrame);
    expect(parsed.map((f) => f.instanceId).sort()).toEqual(["inst-a", "inst-b"]);
    expect(parsed[0]!.eventId).toBe("evt-1");
    expect(parsed[0]!.value).toBe(5);
  });

  it("replays every open delivery for a scene to a newly (re)connecting subscriber", async () => {
    const db = {
      recordSceneEvent: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        sceneEvent: {
          id: "evt-2",
          sceneId: "scene-1",
          type: "widget.event",
          key: "count",
          value: "1",
          occurredAt: null,
          createdAt: null,
        },
      })),
    } as any;
    const store = new DeliveryStore(db, fakeLogger());
    // No subscriber yet — event is still recorded and held open.
    await store.recordEvent({
      sceneId: "scene-1",
      type: "widget.event",
      key: "count",
      value: 1,
      targetInstanceIds: ["inst-a"],
    });

    const { controller, frames } = fakeController();
    store.subscribe("scene-1", controller);
    expect(frames.length).toBe(1);
    expect(parseFrame(frames[0]!)).toMatchObject({ eventId: "evt-2", instanceId: "inst-a" });
  });

  it("does not record an event with no fan-out targets", async () => {
    const recordSceneEvent = mock(async () => ({ status: { code: "OK" as const, message: "" }, sceneEvent: null }));
    const store = new DeliveryStore({ recordSceneEvent } as any, fakeLogger());
    const eventId = await store.recordEvent({
      sceneId: "scene-1",
      type: "widget.event",
      key: "count",
      value: 1,
      targetInstanceIds: [],
    });
    expect(eventId).toBeNull();
    expect(recordSceneEvent).not.toHaveBeenCalled();
  });
});

describe("DeliveryStore.ackCompleted", () => {
  it("removes the delivery from the open set so it's not replayed to a later subscriber", async () => {
    const db = {
      recordSceneEvent: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        sceneEvent: {
          id: "evt-3",
          sceneId: "scene-1",
          type: "widget.event",
          key: "count",
          value: "1",
          occurredAt: null,
          createdAt: null,
        },
      })),
      recordSceneEventCompletion: mock(async () => ({ code: "OK" as const, message: "" })),
    } as any;
    const store = new DeliveryStore(db, fakeLogger());
    await store.recordEvent({
      sceneId: "scene-1",
      type: "widget.event",
      key: "count",
      value: 1,
      targetInstanceIds: ["inst-a"],
    });

    const { closed } = await store.ackCompleted("scene-1", "evt-3", ["inst-a"]);
    expect(db.recordSceneEventCompletion).toHaveBeenCalledWith({ sceneEventId: "evt-3", instanceId: "inst-a" });
    expect(closed).toEqual([{ eventId: "evt-3", type: "widget.event", key: "count", value: 1, startedAt: null }]);
    expect((await store.ackCompleted("scene-1", "evt-3", ["inst-a"])).closed).toEqual([]);

    const { controller, frames } = fakeController();
    store.subscribe("scene-1", controller);
    expect(frames.length).toBe(0);
  });
});

describe("DeliveryStore.hydrate", () => {
  it("loads open deliveries from the DB and makes them available to a subscriber", async () => {
    const db = {
      listOpenSceneEventDeliveries: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        deliveries: [{ sceneEventId: "evt-4", sceneId: "scene-1", instanceId: "inst-a" }],
      })),
      getSceneEvent: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        sceneEvent: {
          id: "evt-4",
          sceneId: "scene-1",
          type: "widget.event",
          key: "count",
          value: "42",
        },
      })),
    } as any;
    const store = new DeliveryStore(db, fakeLogger());
    await store.hydrate();

    const { controller, frames } = fakeController();
    store.subscribe("scene-1", controller);
    expect(frames.length).toBe(1);
    expect(parseFrame(frames[0]!)).toMatchObject({ eventId: "evt-4", instanceId: "inst-a", value: 42 });
  });

  it("skips deliveries whose parent event can't be fetched, without throwing", async () => {
    const db = {
      listOpenSceneEventDeliveries: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        deliveries: [{ sceneEventId: "evt-missing", sceneId: "scene-1", instanceId: "inst-a" }],
      })),
      getSceneEvent: mock(async () => ({ status: { code: "NOT_FOUND" as const, message: "" }, sceneEvent: null })),
    } as any;
    const store = new DeliveryStore(db, fakeLogger());
    await store.hydrate();

    const { controller, frames } = fakeController();
    store.subscribe("scene-1", controller);
    expect(frames.length).toBe(0);
  });

  it("does not throw when the initial list call fails", async () => {
    const db = {
      listOpenSceneEventDeliveries: mock(async () => {
        throw new Error("db down");
      }),
    } as any;
    const store = new DeliveryStore(db, fakeLogger());
    await expect(store.hydrate()).resolves.toBeUndefined();
  });
});

describe("DeliveryStore delivered acks and the sweep", () => {
  function recordingDb(overrides: Record<string, unknown> = {}) {
    return {
      recordSceneEvent: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        sceneEvent: { id: "evt-9", sceneId: "scene-1", type: "alert", key: "k", value: "1" },
      })),
      recordSceneEventDelivery: mock(async () => ({})),
      recordSceneEventCompletion: mock(async () => ({})),
      ...overrides,
    } as any;
  }

  async function storeWithOne(db = recordingDb()) {
    const store = new DeliveryStore(db, fakeLogger());
    const page = fakeController();
    store.subscribe("scene-1", page.controller);
    await store.recordEvent({ sceneId: "scene-1", type: "alert", key: "k", value: 1, targetInstanceIds: ["inst-a"] });
    return { store, page, db };
  }

  /** Run the sweep as if `ms` had passed since the delivery was last sent. */
  function sweepAfter(store: DeliveryStore, ms: number): void {
    setSystemTime(new Date(Date.now() + ms));
    try {
      (store as unknown as { sweepOnce(): void }).sweepOnce();
    } finally {
      setSystemTime();
    }
  }

  it("sends an undelivered delivery again, and stops once a page says it queued it", async () => {
    const { store, page } = await storeWithOne();
    expect(page.frames).toHaveLength(1);

    sweepAfter(store, 6_000);
    expect(page.frames).toHaveLength(2);

    expect(await store.ackDelivered("scene-1", "evt-9", ["inst-a"])).toEqual([]);
    sweepAfter(store, 12_000);
    expect(page.frames).toHaveLength(2);
  });

  it("sends it again after a page subscribes until that page queues it too", async () => {
    const { store } = await storeWithOne();
    await store.ackDelivered("scene-1", "evt-9", ["inst-a"]);

    const reloaded = fakeController();
    store.subscribe("scene-1", reloaded.controller);
    expect(reloaded.frames).toHaveLength(1);

    sweepAfter(store, 6_000);
    expect(reloaded.frames).toHaveLength(2);
  });

  it("reports a delivery it could not record, and still stops sending it", async () => {
    const db = recordingDb({
      recordSceneEventDelivery: mock(async () => {
        throw new Error("db down");
      }),
    });
    const { store, page } = await storeWithOne(db);

    expect(await store.ackDelivered("scene-1", "evt-9", ["inst-a"])).toEqual(["inst-a"]);
    sweepAfter(store, 6_000);
    expect(page.frames).toHaveLength(1);
  });

  it("keeps a delivery open, and reports it, when its completion could not be recorded", async () => {
    const db = recordingDb({
      recordSceneEventCompletion: mock(async () => {
        throw new Error("db down");
      }),
    });
    const { store } = await storeWithOne(db);

    expect(await store.ackCompleted("scene-1", "evt-9", ["inst-a"])).toEqual({ closed: [], failed: ["inst-a"] });
    const later = fakeController();
    store.subscribe("scene-1", later.controller);
    expect(later.frames).toHaveLength(1);
  });
});
