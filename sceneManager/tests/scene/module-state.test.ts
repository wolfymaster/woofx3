import { describe, expect, it, mock } from "bun:test";
import {
  emptyResourceState,
  MODULE_STATE_EVENT,
  type ModuleStateDb,
  ModuleStateWatch,
} from "../../src/scene/module-state";

const logger = {
  debug: mock(() => undefined),
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
} as never;

const COUNTER = "woofx3:counter:deaths";
const COUNTER_KEY = `state:${COUNTER}`;

function fakeDb(stored: Record<string, unknown>, instances: Record<string, { kind: string; settingsJson: string }>) {
  const db: ModuleStateDb = {
    getModuleStorageValue: mock(async (_applicationId: string, namespace: string, key: string) => {
      return stored[`${namespace}/${key}`];
    }),
    getResourceInstance: mock(async (canonicalId: string) => instances[canonicalId] ?? null),
  };
  return db;
}

function fakeScenes(connected: string[]) {
  const pushed: Array<{ sceneId: string; event: string; data: unknown }> = [];
  return {
    pushed,
    connectedSceneIds: () => connected,
    broadcast: (sceneId: string, event: string, data: unknown) => {
      pushed.push({ sceneId, event, data });
    },
  };
}

describe("emptyResourceState", () => {
  it("reads a woofx3 counter as its starting value with no goal reached", () => {
    expect(emptyResourceState("woofx3", "counter", { initialValue: 10 })).toEqual({ value: 10, reached: {} });
  });

  it("starts a counter at 0 when its starting value is missing or not a number", () => {
    expect(emptyResourceState("woofx3", "counter", {})).toEqual({ value: 0, reached: {} });
    expect(emptyResourceState("woofx3", "counter", { initialValue: "" })).toEqual({ value: 0, reached: {} });
    expect(emptyResourceState("woofx3", "counter", { initialValue: "lots" })).toEqual({ value: 0, reached: {} });
  });

  it("knows nothing of another module's kinds", () => {
    expect(emptyResourceState("other", "counter", { initialValue: 10 })).toBeNull();
    expect(emptyResourceState("woofx3", "timer", {})).toBeNull();
  });
});

describe("ModuleStateWatch.read", () => {
  it("returns the stored value", async () => {
    const db = fakeDb({ [`woofx3/${COUNTER_KEY}`]: { value: 4, reached: {} } }, {});
    const watch = new ModuleStateWatch(db, fakeScenes([]), logger);
    expect(await watch.read("scene-1", "app-1", "woofx3", COUNTER_KEY)).toEqual({ value: 4, reached: {} });
  });

  it("reads a counter nothing has written as its starting value", async () => {
    const db = fakeDb({}, { [COUNTER]: { kind: "counter", settingsJson: '{"initialValue":7}' } });
    const watch = new ModuleStateWatch(db, fakeScenes([]), logger);
    expect(await watch.read("scene-1", "app-1", "woofx3", COUNTER_KEY)).toEqual({ value: 7, reached: {} });
  });

  it("reads an empty key that is no resource's state as null", async () => {
    const db = fakeDb({}, {});
    const watch = new ModuleStateWatch(db, fakeScenes([]), logger);
    expect(await watch.read("scene-1", "app-1", "woofx3", "something")).toBeNull();
    expect(db.getResourceInstance).not.toHaveBeenCalled();
  });

  it("does not read another module's instance through this module's storage", async () => {
    const db = fakeDb({}, { [COUNTER]: { kind: "counter", settingsJson: '{"initialValue":7}' } });
    const watch = new ModuleStateWatch(db, fakeScenes([]), logger);
    expect(await watch.read("scene-1", "app-1", "other", COUNTER_KEY)).toBeNull();
    expect(db.getResourceInstance).not.toHaveBeenCalled();
  });

  it("reads an empty counter as null when its instance cannot be looked up", async () => {
    const db = fakeDb({}, {});
    db.getResourceInstance = mock(async () => {
      throw new Error("db down");
    });
    const watch = new ModuleStateWatch(db, fakeScenes([]), logger);
    expect(await watch.read("scene-1", "app-1", "woofx3", COUNTER_KEY)).toBeNull();
  });
});

describe("ModuleStateWatch.publish", () => {
  it("pushes a change only to connected scenes that read the key", async () => {
    const scenes = fakeScenes(["scene-1", "scene-2", "scene-3"]);
    const watch = new ModuleStateWatch(fakeDb({}, {}), scenes, logger);
    await watch.read("scene-1", "app-1", "woofx3", COUNTER_KEY);
    await watch.read("scene-2", "app-1", "woofx3", "state:woofx3:counter:wins");
    await watch.read("scene-4", "app-1", "woofx3", COUNTER_KEY);

    await watch.publish("woofx3", COUNTER_KEY, { value: 5, reached: {} });

    expect(scenes.pushed).toEqual([
      {
        sceneId: "scene-1",
        event: MODULE_STATE_EVENT,
        data: { moduleId: "woofx3", key: COUNTER_KEY, value: { value: 5, reached: {} } },
      },
    ]);
  });

  it("pushes a cleared counter as its starting value", async () => {
    const scenes = fakeScenes(["scene-1"]);
    const db = fakeDb({}, { [COUNTER]: { kind: "counter", settingsJson: '{"initialValue":2}' } });
    const watch = new ModuleStateWatch(db, scenes, logger);
    await watch.read("scene-1", "app-1", "woofx3", COUNTER_KEY);

    await watch.publish("woofx3", COUNTER_KEY, null);

    expect(scenes.pushed.map((p) => p.data)).toEqual([
      { moduleId: "woofx3", key: COUNTER_KEY, value: { value: 2, reached: {} } },
    ]);
  });

  it("does not look anything up when no scene reads the key", async () => {
    const db = fakeDb({}, {});
    const scenes = fakeScenes(["scene-1"]);
    const watch = new ModuleStateWatch(db, scenes, logger);

    await watch.publish("woofx3", COUNTER_KEY, null);

    expect(scenes.pushed).toEqual([]);
    expect(db.getResourceInstance).not.toHaveBeenCalled();
  });
});
