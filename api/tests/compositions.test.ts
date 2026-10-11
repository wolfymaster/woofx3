import { describe, expect, test } from "bun:test";
import type { AlertComposition, CompositionLinkInfo, DeleteAlertCompositionResult, Scene } from "@woofx3/api";
import type * as scene from "@woofx3/db/scene.pb";
import { DbError } from "../src/db-client";
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

function link(stepId: string): scene.CompositionLink {
  return {
    id: `l-${stepId}`,
    compositionId: "alert-1",
    ownerKind: "workflow",
    ownerId: "wf-1",
    stepId,
  } as scene.CompositionLink;
}

/** The slice of DbClient the scene and composition routes use, over a map of rows. */
function fakeDb(rows: scene.Scene[], links: scene.CompositionLink[] = []) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const calls = {
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
      if (links.length > 0) {
        throw new DbError("deleteScene", "failed_precondition", "linked");
      }
      calls.deleted.push(req.id);
    },
    async listCompositionLinks() {
      return links;
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
    expect(await route(compositionsRoutes, "deleteAlertComposition", db)("scene-1")).toEqual({
      success: false,
      links: [],
    });
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

  test("are not deleted while steps play them, and the answer names the steps", async () => {
    const db = fakeDb(rows, [link("s1"), link("s2")]);
    const result = await route<DeleteAlertCompositionResult>(
      compositionsRoutes,
      "deleteAlertComposition",
      db
    )("alert-1");
    expect(result.success).toBe(false);
    expect(result.success === false && result.links.map((l: CompositionLinkInfo) => l.stepId)).toEqual(["s1", "s2"]);
    expect(db.calls.deleted).toEqual([]);

    const free = fakeDb(rows);
    expect(await route(compositionsRoutes, "deleteAlertComposition", free)("alert-1")).toEqual({ success: true });
    expect(free.calls.deleted).toEqual(["alert-1"]);
  });
});
