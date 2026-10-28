import { describe, expect, test } from "bun:test";
import { type AlertComposition, ENGINE_CAPABILITIES, type Scene, supportedEngineCapabilities } from "@woofx3/api";
import type { SceneSnapshot } from "@woofx3/api/webhooks";
import type * as scene from "@woofx3/db/scene.pb";
import { RPC_METHODS } from "../src/api-session";
import { compositionsRoutes } from "../src/routes/compositions";
import { scenesRoutes } from "../src/routes/scenes";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function row(id: string, kind: string, overrides: Partial<scene.Scene> = {}): scene.Scene {
  return {
    id,
    name: id,
    description: "",
    widgetsJson: "[]",
    layoutJson: "{}",
    createdByType: "USER",
    createdByRef: "",
    draftWidgetsJson: "",
    draftLayoutJson: "",
    hasDraft: false,
    editorStateJson: "",
    kind,
    behaviorsJson: "{}",
    draftBehaviorsJson: "",
    inputsJson: "[]",
    ...overrides,
  } as scene.Scene;
}

/** The slice of DbClient the scene and composition routes use, over a map of rows. */
function fakeDb(rows: scene.Scene[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const calls = {
    listed: [] as scene.ListScenesRequest[],
    created: [] as scene.CreateSceneRequest[],
    updated: [] as scene.UpdateSceneRequest[],
    deleted: [] as string[],
  };
  return {
    calls,
    async findComposition(id: string) {
      return byId.get(id) ?? null;
    },
    async listScenes(req: scene.ListScenesRequest) {
      calls.listed.push(req);
      const scenes = rows.filter((r) => r.kind === (req.kind || "scene"));
      return { scenes, totalCount: scenes.length, page: 1, pageSize: scenes.length };
    },
    async createScene(req: scene.CreateSceneRequest) {
      calls.created.push(req);
      return row("created-1", req.kind, { name: req.name, inputsJson: req.inputsJson });
    },
    async tryUpdateScene(req: scene.UpdateSceneRequest) {
      calls.updated.push(req);
      const existing = byId.get(req.id);
      return existing ? { ...existing, name: req.name || existing.name } : null;
    },
    async tryDeleteScene(req: scene.DeleteSceneRequest) {
      calls.deleted.push(req.id);
      return true;
    },
    async deleteScene(req: scene.DeleteSceneRequest) {
      calls.deleted.push(req.id);
    },
  };
}

function host(db: ReturnType<typeof fakeDb>) {
  return { db, logger: fakeLogger(), emitSceneWebhook: async () => {} };
}

function route<T>(routes: Record<string, unknown>, name: string, db: ReturnType<typeof fakeDb>) {
  const fn = routes[name] as (...args: unknown[]) => Promise<T>;
  return (...args: unknown[]) => fn.apply(host(db), args);
}

describe("alert compositions", () => {
  const rows = [
    row("scene-1", "scene"),
    row("alert-1", "alert", { inputsJson: '[{"id":"n","label":"N","type":"text"}]' }),
  ];

  test("are listed and read apart from scenes", async () => {
    const db = fakeDb(rows);
    const listed = await route<{ compositions: AlertComposition[] }>(compositionsRoutes, "listAlertCompositions", db)();
    expect(listed.compositions.map((c) => c.id)).toEqual(["alert-1"]);
    const alert = await route<AlertComposition | null>(compositionsRoutes, "getAlertComposition", db)("alert-1");
    expect(alert?.inputsJson).toBe('[{"id":"n","label":"N","type":"text"}]');
    expect(await route<AlertComposition | null>(compositionsRoutes, "getAlertComposition", db)("scene-1")).toBeNull();

    const scenes = await route<{ scenes: Scene[] }>(scenesRoutes, "getScenes", db)();
    expect(scenes.scenes.map((s) => s.id)).toEqual(["scene-1"]);
    expect(await route<Scene | null>(scenesRoutes, "getScene", db)("alert-1")).toBeNull();
  });

  test("are created as alerts", async () => {
    const db = fakeDb(rows);
    const created = await route<{ id: string }>(compositionsRoutes, "createAlertComposition", db)({ name: "Raid" });
    expect(created.id).toBe("created-1");
    expect(db.calls.created[0]?.kind).toBe("alert");
    expect(db.calls.created[0]?.inputsJson).toBe("[]");
  });

  test("never change through the scene routes, nor scenes through theirs", async () => {
    const db = fakeDb(rows);
    expect(await route(scenesRoutes, "updateScene", db)("alert-1", { name: "x" })).toEqual({ success: false });
    expect(await route(scenesRoutes, "deleteScene", db)("alert-1")).toEqual({ success: false });
    expect(await route(compositionsRoutes, "updateAlertComposition", db)("scene-1", { name: "x" })).toEqual({
      success: false,
    });
    expect(await route(compositionsRoutes, "deleteAlertComposition", db)("scene-1")).toEqual({ success: false });
    expect(db.calls.updated).toEqual([]);
    expect(db.calls.deleted).toEqual([]);
  });

  test("set inputs without writing the document", async () => {
    const db = fakeDb(rows);
    const inputs = '[{"id":"who","label":"Who","type":"text"}]';
    expect(await route(compositionsRoutes, "updateAlertComposition", db)("alert-1", { inputsJson: inputs })).toEqual({
      success: true,
    });
    const sent = db.calls.updated[0];
    expect(sent?.inputsJson).toBe(inputs);
    expect([sent?.widgetsJson, sent?.layoutJson, sent?.behaviorsJson, sent?.draftWidgetsJson]).toEqual([
      "",
      "",
      "",
      "",
    ]);
  });

  test("are deleted", async () => {
    const db = fakeDb(rows);
    expect(await route(compositionsRoutes, "deleteAlertComposition", db)("alert-1")).toEqual({ success: true });
    expect(db.calls.deleted).toEqual(["alert-1"]);
  });
});

describe("scene snapshots", () => {
  test("list every scene by name, past one page, and no alert", async () => {
    // More scenes than getScenes' default page of 10, stored out of name order.
    const scenes = Array.from({ length: 12 }, (_, i) => row(`scene-${String(12 - i).padStart(2, "0")}`, "scene"));
    const db = fakeDb([...scenes, row("alert-1", "alert")]);

    const listed = await route<{ scenes: SceneSnapshot[] }>(scenesRoutes, "listSceneSnapshots", db)();

    expect(listed.scenes.map((s) => s.name)).toEqual(
      Array.from({ length: 12 }, (_, i) => `scene-${String(i + 1).padStart(2, "0")}`)
    );
    expect(listed.scenes.every((s) => s.kind === "scene")).toBe(true);
    expect(db.calls.listed).toEqual([{ page: 0, pageSize: 0, sortBy: "name", sortDesc: false, kind: "scene" }]);
  });

  test("refuse a list db-proxy answered only in part", async () => {
    const db = fakeDb([row("scene-1", "scene")]);
    db.listScenes = async () => ({ scenes: [row("scene-1", "scene")], totalCount: 2, page: 1, pageSize: 1 });

    await expect(route(scenesRoutes, "listSceneSnapshots", db)()).rejects.toThrow("1 of 2 scenes");
  });

  test("read one scene as its whole stored record", async () => {
    const stored = row("scene-1", "scene", {
      name: "Starting soon",
      description: "Before the stream",
      widgetsJson: '[{"id":"w1"}]',
      layoutJson: '{"width":1920,"height":1080,"backgroundColor":"#000"}',
      behaviorsJson: '{"b1":{"kind":"fade"}}',
      inputsJson: "[]",
      createdByType: "MODULE",
      createdByRef: "module-1",
      createdAt: { seconds: 1_700_000_000n, nanos: 0 },
      updatedAt: { seconds: 1_700_000_060n, nanos: 0 },
    });
    const db = fakeDb([stored]);

    const found = await route<SceneSnapshot | null>(scenesRoutes, "getSceneSnapshot", db)("scene-1");

    expect(found).toEqual({
      id: "scene-1",
      kind: "scene",
      name: "Starting soon",
      description: "Before the stream",
      widgetsJson: '[{"id":"w1"}]',
      layoutJson: '{"width":1920,"height":1080,"backgroundColor":"#000"}',
      behaviorsJson: '{"b1":{"kind":"fade"}}',
      inputsJson: "[]",
      createdByType: "MODULE",
      createdByRef: "module-1",
      createdAt: "2023-11-14T22:13:20.000Z",
      updatedAt: "2023-11-14T22:14:20.000Z",
    });
    const listed = await route<{ scenes: SceneSnapshot[] }>(scenesRoutes, "listSceneSnapshots", db)();
    expect(listed.scenes).toEqual([found as SceneSnapshot]);
  });

  test("are null for an alert and for an unknown id", async () => {
    const db = fakeDb([row("scene-1", "scene"), row("alert-1", "alert")]);
    const get = route<SceneSnapshot | null>(scenesRoutes, "getSceneSnapshot", db);

    expect(await get("alert-1")).toBeNull();
    expect(await get("missing")).toBeNull();
  });

  test("are advertised as scenes.snapshots and reachable over RPC", () => {
    expect(supportedEngineCapabilities()).toContain(ENGINE_CAPABILITIES.scenesSnapshots);
    expect(RPC_METHODS as readonly string[]).toContain("listSceneSnapshots");
    expect(RPC_METHODS as readonly string[]).toContain("getSceneSnapshot");
  });
});
