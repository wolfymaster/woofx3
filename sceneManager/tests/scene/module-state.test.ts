import { describe, expect, it, mock } from "bun:test";
import {
  MODULE_STATE_EVENT,
  type ModuleStateDb,
  ModuleStateWatch,
  resourceReading,
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
    getModuleStorageValue: mock(async (namespace: string, key: string) => {
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

function counterInstance(settings: Record<string, unknown>) {
  return { [COUNTER]: { kind: "counter", settingsJson: JSON.stringify(settings) } };
}

describe("resourceReading", () => {
  it("reads a counter nothing has written as its starting value with no goal reached", () => {
    expect(resourceReading("woofx3", "counter", { initialValue: 10 }, null)).toEqual({
      value: 10,
      reached: {},
      goals: [],
    });
  });

  it("starts a counter at 0 when its starting value is missing or not a number", () => {
    for (const initialValue of [undefined, "", "lots"]) {
      expect(resourceReading("woofx3", "counter", { initialValue }, null)).toMatchObject({ value: 0 });
    }
  });

  it("reads a stored counter in either shape", () => {
    const reached = { "100": 1_700_000_000_000 };
    expect(resourceReading("woofx3", "counter", {}, { value: 120, reached })).toEqual({
      value: 120,
      reached,
      goals: [],
    });
    expect(resourceReading("woofx3", "counter", {}, 42)).toEqual({ value: 42, reached: {}, goals: [] });
  });

  it("carries the counter's goals, named and unnamed, smallest first", () => {
    const goals = [{ value: 100, name: "Emote" }, { value: 50 }, { value: "", name: "Unfinished" }];
    expect(resourceReading("woofx3", "counter", { goals }, 3)).toMatchObject({
      goals: [
        { value: 50, name: "" },
        { value: 100, name: "Emote" },
      ],
    });
  });

  it("reads goals written as a comma-separated string", () => {
    expect(resourceReading("woofx3", "counter", { goals: "250, 100, x" }, 3)).toMatchObject({
      goals: [
        { value: 100, name: "" },
        { value: 250, name: "" },
      ],
    });
  });

  it("names a repeated number by its first row that has a name", () => {
    const goals = [{ value: 10 }, { value: 10, name: "Ten" }, { value: 10, name: "Also ten" }];
    expect(resourceReading("woofx3", "counter", { goals }, 3)).toMatchObject({ goals: [{ value: 10, name: "Ten" }] });
  });

  it("passes another kind's stored value through unchanged", () => {
    expect(resourceReading("other", "counter", { initialValue: 10 }, null)).toBeNull();
    expect(resourceReading("woofx3", "queue", {}, { items: [] })).toEqual({ items: [] });
  });
});

describe("resourceReading of a timer", () => {
  it("reads a timer nothing has started as stopped at its full duration", () => {
    expect(resourceReading("woofx3", "timer", { duration: 90 }, null)).toEqual({
      running: false,
      remainingMs: 90_000,
      durationMs: 90_000,
    });
  });

  it("runs for 5 minutes when its duration is missing or not a number", () => {
    for (const duration of [undefined, "", "long"]) {
      expect(resourceReading("woofx3", "timer", { duration }, null)).toMatchObject({ durationMs: 300_000 });
    }
  });

  it("reads a running timer as its time left at the moment of reading", () => {
    const stored = { running: true, endsAt: 1_700_000_045_000 };
    expect(resourceReading("woofx3", "timer", { duration: 60 }, stored, 1_700_000_000_000)).toEqual({
      running: true,
      remainingMs: 45_000,
      durationMs: 60_000,
    });
  });

  it("reads a running timer past its end as having nothing left", () => {
    const stored = { running: true, endsAt: 1_700_000_000_000 };
    expect(resourceReading("woofx3", "timer", { duration: 60 }, stored, 1_700_000_002_000)).toMatchObject({
      running: true,
      remainingMs: 0,
    });
  });

  it("reads a stopped timer as what it has left", () => {
    expect(resourceReading("woofx3", "timer", { duration: 60 }, { running: false, remainingMs: 12_500 })).toEqual({
      running: false,
      remainingMs: 12_500,
      durationMs: 60_000,
    });
  });
});

describe("ModuleStateWatch.read", () => {
  it("reads a counter with its goals", async () => {
    const db = fakeDb(
      { [`woofx3/${COUNTER_KEY}`]: { value: 4, reached: {} } },
      counterInstance({ goals: [{ value: 10, name: "Ten" }] })
    );
    const watch = new ModuleStateWatch(db, fakeScenes([]), logger);
    expect(await watch.read("scene-1", "woofx3", COUNTER_KEY)).toEqual({
      value: 4,
      reached: {},
      goals: [{ value: 10, name: "Ten" }],
    });
  });

  it("reads a counter nothing has written as its starting value", async () => {
    const db = fakeDb({}, counterInstance({ initialValue: 7 }));
    const watch = new ModuleStateWatch(db, fakeScenes([]), logger);
    expect(await watch.read("scene-1", "woofx3", COUNTER_KEY)).toEqual({ value: 7, reached: {}, goals: [] });
  });

  it("reads a key that is no resource's state as it is stored", async () => {
    const db = fakeDb({ "woofx3/something": 3 }, {});
    const watch = new ModuleStateWatch(db, fakeScenes([]), logger);
    expect(await watch.read("scene-1", "woofx3", "something")).toBe(3);
    expect(await watch.read("scene-1", "woofx3", "nothing")).toBeNull();
    expect(db.getResourceInstance).not.toHaveBeenCalled();
  });

  it("does not read another module's instance through this module's storage", async () => {
    const db = fakeDb({}, counterInstance({ initialValue: 7 }));
    const watch = new ModuleStateWatch(db, fakeScenes([]), logger);
    expect(await watch.read("scene-1", "other", COUNTER_KEY)).toBeNull();
    expect(db.getResourceInstance).not.toHaveBeenCalled();
  });

  it("serves the stored value as is when the instance cannot be looked up", async () => {
    const db = fakeDb({ [`woofx3/${COUNTER_KEY}`]: { value: 4, reached: {} } }, {});
    db.getResourceInstance = mock(async () => {
      throw new Error("db down");
    });
    const watch = new ModuleStateWatch(db, fakeScenes([]), logger);
    expect(await watch.read("scene-1", "woofx3", COUNTER_KEY)).toEqual({ value: 4, reached: {} });
  });
});

describe("ModuleStateWatch.publish", () => {
  it("pushes a change only to connected scenes that read the key", async () => {
    const scenes = fakeScenes(["scene-1", "scene-2", "scene-3"]);
    const watch = new ModuleStateWatch(fakeDb({}, {}), scenes, logger);
    await watch.read("scene-1", "woofx3", COUNTER_KEY);
    await watch.read("scene-2", "woofx3", "state:woofx3:counter:wins");
    await watch.read("scene-4", "woofx3", COUNTER_KEY);

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
    const watch = new ModuleStateWatch(fakeDb({}, counterInstance({ initialValue: 2 })), scenes, logger);
    await watch.read("scene-1", "woofx3", COUNTER_KEY);

    await watch.publish("woofx3", COUNTER_KEY, null);

    expect(scenes.pushed.map((p) => p.data)).toEqual([
      { moduleId: "woofx3", key: COUNTER_KEY, value: { value: 2, reached: {}, goals: [] } },
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

describe("ModuleStateWatch.resourceUpdated", () => {
  it("pushes the counter again to each watching scene", async () => {
    const instances = counterInstance({ goals: [{ value: 10 }] });
    const db = fakeDb({ [`woofx3/${COUNTER_KEY}`]: { value: 4, reached: {} } }, instances);
    const scenes = fakeScenes(["scene-1", "scene-2"]);
    const watch = new ModuleStateWatch(db, scenes, logger);
    await watch.read("scene-1", "woofx3", COUNTER_KEY);

    instances[COUNTER] = { kind: "counter", settingsJson: JSON.stringify({ goals: [{ value: 10, name: "Ten" }] }) };
    await watch.resourceUpdated(COUNTER);

    expect(db.getModuleStorageValue).toHaveBeenLastCalledWith("woofx3", COUNTER_KEY);
    expect(scenes.pushed).toEqual([
      {
        sceneId: "scene-1",
        event: MODULE_STATE_EVENT,
        data: {
          moduleId: "woofx3",
          key: COUNTER_KEY,
          value: { value: 4, reached: {}, goals: [{ value: 10, name: "Ten" }] },
        },
      },
    ]);
  });

  it("pushes nothing for an instance no connected scene watches", async () => {
    const scenes = fakeScenes(["scene-1"]);
    const watch = new ModuleStateWatch(fakeDb({}, {}), scenes, logger);
    await watch.resourceUpdated(COUNTER);
    expect(scenes.pushed).toEqual([]);
  });
});
