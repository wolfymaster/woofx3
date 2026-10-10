import { describe, expect, it, mock } from "bun:test";
import {
  linkedResources,
  listSettingRows,
  MODULE_STATE_EVENT,
  type ModuleStateDb,
  ModuleStateWatch,
  storageModuleFor,
} from "../../src/scene/module-state";

const logger = {
  debug: mock(() => undefined),
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
} as never;

const COUNTER = "woofx3:counter:deaths";
const COUNTER_KEY = `state:${COUNTER}`;
const COUNTER_RESOURCE = `resource:${COUNTER}`;
const NOW = 1_700_000_000_000;

type SettingRow = { key: string; value: string; valueType: string };

function fakeDb(
  stored: Record<string, unknown>,
  instances: Record<string, { settingsJson: string }>,
  settings: Record<string, SettingRow[]> = {}
) {
  const db: ModuleStateDb = {
    getModuleStorageValue: mock(async (namespace: string, key: string) => {
      return stored[`${namespace}/${key}`];
    }),
    getResourceInstance: mock(async (canonicalId: string) => instances[canonicalId] ?? null),
    listModuleSettings: mock(async (moduleId: string) => settings[moduleId] ?? []),
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
  return { [COUNTER]: { settingsJson: JSON.stringify(settings) } };
}

function watchOf(db: ModuleStateDb, scenes = fakeScenes([])) {
  return new ModuleStateWatch(db, scenes, logger, () => NOW);
}

describe("storageModuleFor", () => {
  const settings = (rows: Record<string, { key: string; value: string; valueType: string }[]>) => ({
    listModuleSettings: async (moduleId: string) => rows[moduleId] ?? [],
  });

  it("reads a module's own keys and own instances from its own storage", async () => {
    const db = settings({});
    expect(await storageModuleFor(db, "woofx3", COUNTER_KEY)).toBe("woofx3");
    expect(await storageModuleFor(db, "hype_board", "board")).toBe("hype_board");
  });

  it("reads an instance the module's settings link from its owner's storage", async () => {
    const db = settings({ hype_board: [{ key: "counter", value: COUNTER, valueType: "resource_ref" }] });
    expect(await storageModuleFor(db, "hype_board", COUNTER_KEY)).toBe("woofx3");
  });

  it("reads a linked instance as a whole from its owner's storage too", async () => {
    const db = settings({ hype_board: [{ key: "counter", value: COUNTER, valueType: "resource_ref" }] });
    expect(await storageModuleFor(db, "hype_board", COUNTER_RESOURCE)).toBe("woofx3");
    expect(await storageModuleFor(db, "hype_board", "resource:woofx3:counter:other")).toBe("hype_board");
  });

  it("keeps an instance nothing links in the module's own storage, where nothing is", async () => {
    const db = settings({ hype_board: [{ key: "counter", value: "woofx3:counter:other", valueType: "resource_ref" }] });
    expect(await storageModuleFor(db, "hype_board", COUNTER_KEY)).toBe("hype_board");
  });

  it("lists only resource_ref settings that hold a value as linked", async () => {
    const db = settings({
      hype_board: [
        { key: "counter", value: COUNTER, valueType: "resource_ref" },
        { key: "empty", value: "", valueType: "resource_ref" },
        { key: "note", value: "woofx3:counter:x", valueType: "text" },
      ],
    });
    expect(await linkedResources(db, "hype_board")).toEqual({ counter: COUNTER });
  });
});

describe("ModuleStateWatch.read", () => {
  it("reads an instance's value as it is stored, whatever its kind", async () => {
    const db = fakeDb({ [`woofx3/${COUNTER_KEY}`]: { value: 4, reached: {} } }, counterInstance({ initialValue: 7 }));
    const watch = watchOf(db);
    expect(await watch.read("scene-1", "woofx3", COUNTER_KEY)).toEqual({ value: 4, reached: {} });
    expect(await watch.read("scene-1", "woofx3", "state:woofx3:counter:unwritten")).toBeNull();
    expect(db.getResourceInstance).not.toHaveBeenCalled();
  });

  it("reads an instance as a whole: its value, its settings and when it was read", async () => {
    const db = fakeDb(
      { [`woofx3/${COUNTER_KEY}`]: { value: 4, reached: {} } },
      counterInstance({ goals: [{ value: 10, name: "Ten" }] })
    );
    expect(await watchOf(db).read("scene-1", "woofx3", COUNTER_RESOURCE)).toEqual({
      value: { value: 4, reached: {} },
      settings: { goals: [{ value: 10, name: "Ten" }] },
      readAt: NOW,
    });
  });

  it("reads an instance nothing has written with no value, and its settings", async () => {
    const db = fakeDb({}, counterInstance({ initialValue: 7 }));
    expect(await watchOf(db).read("scene-1", "woofx3", COUNTER_RESOURCE)).toEqual({
      value: null,
      settings: { initialValue: 7 },
      readAt: NOW,
    });
  });

  it("reads an instance that does not exist as nothing", async () => {
    expect(await watchOf(fakeDb({}, {})).read("scene-1", "woofx3", COUNTER_RESOURCE)).toBeNull();
  });

  it("reads settings that are broken or not an object as none", async () => {
    for (const settingsJson of ["{", "[1]", ""]) {
      const db = fakeDb({}, { [COUNTER]: { settingsJson } });
      expect(await watchOf(db).read("scene-1", "woofx3", COUNTER_RESOURCE)).toMatchObject({ settings: {} });
    }
  });

  it("does not read another module's instance through this module's storage", async () => {
    const db = fakeDb({}, counterInstance({ initialValue: 7 }));
    expect(await watchOf(db).read("scene-1", "other", COUNTER_RESOURCE)).toBeNull();
    expect(db.getResourceInstance).not.toHaveBeenCalled();
  });

  it("fails the read when the instance cannot be looked up", async () => {
    const db = fakeDb({}, {});
    db.getResourceInstance = mock(async () => {
      throw new Error("db down");
    });
    await expect(watchOf(db).read("scene-1", "woofx3", COUNTER_RESOURCE)).rejects.toThrow("db down");
  });
});

describe("ModuleStateWatch.publish", () => {
  it("pushes a change only to connected scenes that read the key", async () => {
    const scenes = fakeScenes(["scene-1", "scene-2", "scene-3"]);
    const watch = watchOf(fakeDb({}, {}), scenes);
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

  it("pushes a changed value to scenes reading the instance as a whole, with its settings", async () => {
    const scenes = fakeScenes(["scene-1"]);
    const db = fakeDb({}, counterInstance({ initialValue: 2 }));
    const watch = watchOf(db, scenes);
    await watch.read("scene-1", "woofx3", COUNTER_RESOURCE);

    await watch.publish("woofx3", COUNTER_KEY, null);

    expect(scenes.pushed.map((p) => p.data)).toEqual([
      { moduleId: "woofx3", key: COUNTER_RESOURCE, value: { value: null, settings: { initialValue: 2 }, readAt: NOW } },
    ]);
    expect(db.getModuleStorageValue).toHaveBeenCalledTimes(1);
  });

  it("pushes a linked instance's change as the module of the widget that read it", async () => {
    const scenes = fakeScenes(["scene-1"]);
    const watch = watchOf(fakeDb({}, {}), scenes);
    await watch.read("scene-1", "woofx3", COUNTER_KEY, "hype_board");

    await watch.publish("woofx3", COUNTER_KEY, { value: 5, reached: {} });

    expect(scenes.pushed.map((p) => p.data)).toEqual([
      { moduleId: "hype_board", key: COUNTER_KEY, value: { value: 5, reached: {} } },
    ]);
  });

  it("pushes to the owner's own widget and to a linking one alike", async () => {
    const scenes = fakeScenes(["scene-1"]);
    const watch = watchOf(fakeDb({}, {}), scenes);
    await watch.read("scene-1", "woofx3", COUNTER_KEY);
    await watch.read("scene-1", "woofx3", COUNTER_KEY, "hype_board");

    await watch.publish("woofx3", COUNTER_KEY, 1);

    expect(scenes.pushed.map((p) => (p.data as { moduleId: string }).moduleId).sort()).toEqual([
      "hype_board",
      "woofx3",
    ]);
  });

  it("does not look anything up when no scene reads the instance as a whole", async () => {
    const db = fakeDb({}, {});
    const scenes = fakeScenes(["scene-1"]);
    const watch = watchOf(db, scenes);
    await watch.read("scene-1", "woofx3", COUNTER_KEY);

    await watch.publish("woofx3", COUNTER_KEY, null);

    expect(scenes.pushed).toHaveLength(1);
    expect(db.getResourceInstance).not.toHaveBeenCalled();
  });

  it("ignores a storage write under the resource prefix", async () => {
    const scenes = fakeScenes(["scene-1"]);
    const watch = watchOf(fakeDb({}, counterInstance({})), scenes);
    await watch.read("scene-1", "woofx3", COUNTER_RESOURCE);

    await watch.publish("woofx3", COUNTER_RESOURCE, "forged");

    expect(scenes.pushed).toEqual([]);
  });
});

describe("ModuleStateWatch.resourceUpdated", () => {
  it("pushes the instance again, with its new settings, to each scene reading it as a whole", async () => {
    const instances = counterInstance({ goals: [{ value: 10 }] });
    const db = fakeDb({ [`woofx3/${COUNTER_KEY}`]: { value: 4, reached: {} } }, instances);
    const scenes = fakeScenes(["scene-1", "scene-2"]);
    const watch = watchOf(db, scenes);
    await watch.read("scene-1", "woofx3", COUNTER_RESOURCE);
    await watch.read("scene-2", "woofx3", COUNTER_KEY);

    instances[COUNTER] = { settingsJson: JSON.stringify({ goals: [{ value: 10, name: "Ten" }] }) };
    await watch.resourceUpdated(COUNTER);

    expect(scenes.pushed).toEqual([
      {
        sceneId: "scene-1",
        event: MODULE_STATE_EVENT,
        data: {
          moduleId: "woofx3",
          key: COUNTER_RESOURCE,
          value: { value: { value: 4, reached: {} }, settings: { goals: [{ value: 10, name: "Ten" }] }, readAt: NOW },
        },
      },
    ]);
  });

  it("pushes nothing for an instance no connected scene watches", async () => {
    const scenes = fakeScenes(["scene-1"]);
    const watch = watchOf(fakeDb({}, {}), scenes);
    await watch.resourceUpdated(COUNTER);
    expect(scenes.pushed).toEqual([]);
  });
});

const WHEEL = "woofx3_wheel_spin";

function wheelSettings(items: string, valueType = "list"): Record<string, SettingRow[]> {
  return {
    [WHEEL]: [
      { key: "items", value: items, valueType },
      { key: "password", value: "", valueType: "secret" },
    ],
  };
}

describe("listSettingRows", () => {
  it("reads a list setting as its rows", () => {
    expect(listSettingRows(wheelSettings('[{"label":"Pizza"}]')[WHEEL]!, "items")).toEqual([{ label: "Pizza" }]);
  });

  it("reads an empty or broken list as no rows, and drops rows that are not objects", () => {
    expect(listSettingRows(wheelSettings("")[WHEEL]!, "items")).toEqual([]);
    expect(listSettingRows(wheelSettings("nope")[WHEEL]!, "items")).toEqual([]);
    expect(listSettingRows(wheelSettings('[{"label":"A"},"B",null]')[WHEEL]!, "items")).toEqual([{ label: "A" }]);
  });

  it("serves nothing for a setting that is not a list", () => {
    expect(listSettingRows(wheelSettings("[]")[WHEEL]!, "password")).toBeNull();
    expect(listSettingRows(wheelSettings('[{"label":"A"}]', "text")[WHEEL]!, "items")).toBeNull();
    expect(listSettingRows(wheelSettings("[]")[WHEEL]!, "missing")).toBeNull();
  });
});

describe("ModuleStateWatch list settings", () => {
  it("reads a list setting from the settings, not from storage", async () => {
    const db = fakeDb({ [`${WHEEL}/setting:items`]: "from storage" }, {}, wheelSettings('[{"label":"Pizza"}]'));
    const watch = new ModuleStateWatch(db, fakeScenes([]), logger);

    expect(await watch.read("scene-1", WHEEL, "setting:items")).toEqual([{ label: "Pizza" }]);
    expect(db.getModuleStorageValue).not.toHaveBeenCalled();
  });

  it("never serves a secret setting", async () => {
    const watch = new ModuleStateWatch(fakeDb({}, {}, wheelSettings("[]")), fakeScenes([]), logger);

    expect(await watch.read("scene-1", WHEEL, "setting:password")).toBeNull();
  });

  it("pushes a changed list setting to each connected scene watching it", async () => {
    const settings = wheelSettings('[{"label":"Pizza"}]');
    const scenes = fakeScenes(["scene-1", "scene-2"]);
    const watch = new ModuleStateWatch(fakeDb({}, {}, settings), scenes, logger);
    await watch.read("scene-1", WHEEL, "setting:items");

    settings[WHEEL]![0]!.value = '[{"label":"Pizza"},{"label":"Tacos"}]';
    await watch.settingUpdated(WHEEL, "items");

    expect(scenes.pushed).toEqual([
      {
        sceneId: "scene-1",
        event: MODULE_STATE_EVENT,
        data: { moduleId: WHEEL, key: "setting:items", value: [{ label: "Pizza" }, { label: "Tacos" }] },
      },
    ]);
  });

  it("reads nothing when no scene watches the changed setting", async () => {
    const db = fakeDb({}, {}, wheelSettings("[]"));
    const scenes = fakeScenes(["scene-1"]);
    const watch = new ModuleStateWatch(db, scenes, logger);

    await watch.settingUpdated(WHEEL, "items");

    expect(scenes.pushed).toEqual([]);
    expect(db.listModuleSettings).not.toHaveBeenCalled();
  });

  it("ignores a storage write under the setting prefix", async () => {
    const scenes = fakeScenes(["scene-1"]);
    const watch = new ModuleStateWatch(fakeDb({}, {}, wheelSettings("[]")), scenes, logger);
    await watch.read("scene-1", WHEEL, "setting:items");

    await watch.publish(WHEEL, "setting:items", "spoofed");

    expect(scenes.pushed).toEqual([]);
  });
});
