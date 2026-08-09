import { describe, expect, it, mock } from "bun:test";
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
        sceneEvent: { id: "evt-1", sceneId: "scene-1", applicationId: "app-1", type: "widget.event", key: "count", value: "5", occurredAt: null, createdAt: null },
      })),
    } as any;
    const store = new DeliveryStore(db, fakeLogger());
    const { controller, frames } = fakeController();
    store.subscribe("scene-1", controller);

    const eventId = await store.recordEvent({
      sceneId: "scene-1",
      applicationId: "app-1",
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
        sceneEvent: { id: "evt-2", sceneId: "scene-1", applicationId: "app-1", type: "widget.event", key: "count", value: "1", occurredAt: null, createdAt: null },
      })),
    } as any;
    const store = new DeliveryStore(db, fakeLogger());
    // No subscriber yet — event is still recorded and held open.
    await store.recordEvent({
      sceneId: "scene-1",
      applicationId: "app-1",
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
      applicationId: "app-1",
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
        sceneEvent: { id: "evt-3", sceneId: "scene-1", applicationId: "app-1", type: "widget.event", key: "count", value: "1", occurredAt: null, createdAt: null },
      })),
      recordSceneEventCompletion: mock(async () => ({ code: "OK" as const, message: "" })),
    } as any;
    const store = new DeliveryStore(db, fakeLogger());
    await store.recordEvent({
      sceneId: "scene-1",
      applicationId: "app-1",
      type: "widget.event",
      key: "count",
      value: 1,
      targetInstanceIds: ["inst-a"],
    });

    await store.ackCompleted("scene-1", "evt-3", ["inst-a"]);
    expect(db.recordSceneEventCompletion).toHaveBeenCalledWith({ sceneEventId: "evt-3", instanceId: "inst-a" });

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
        sceneEvent: { id: "evt-4", sceneId: "scene-1", applicationId: "app-1", type: "widget.event", key: "count", value: "42" },
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
    const db = { listOpenSceneEventDeliveries: mock(async () => { throw new Error("db down"); }) } as any;
    const store = new DeliveryStore(db, fakeLogger());
    await expect(store.hydrate()).resolves.toBeUndefined();
  });
});
