import { describe, expect, test } from "bun:test";
import { moduleProjectionKey, triggersRoutes } from "../src/routes/triggers";

/** The route is a mixin over the api's route host; `listTriggers` is all it touches. */
function getTriggers(rows: unknown[]): Promise<Record<string, unknown>[]> {
  const ctx = {
    db: {
      async listTriggers() {
        return rows;
      },
    },
  };
  const route = triggersRoutes.getTriggers as unknown as () => Promise<Record<string, unknown>[]>;
  return route.call(ctx);
}

describe("getTriggers", () => {
  // The UI keys webhook endpoints by this. Without it, its sync took every
  // webhook trigger for gone and disabled their public URLs.
  test("gives a module trigger the projectionKey the registration webhook gives it", async () => {
    const [trigger] = await getTriggers([
      {
        id: "t1",
        createdByType: "MODULE",
        createdByRef: "woofx3_throne",
        manifestId: "throne_webhook",
        event: "webhook.woofx3_throne.throne_webhook",
        transport: "webhook",
        handler: "woofx3_throne:function:handle_webhook",
      },
    ]);
    expect(trigger?.projectionKey).toBe("woofx3_throne:trigger:throne_webhook");
    expect(trigger).not.toHaveProperty("handler");
  });

  test("gives a trigger no module owns no projectionKey", async () => {
    const [trigger] = await getTriggers([
      { id: "t2", createdByType: "USER", createdByRef: "", manifestId: "", handler: "" },
    ]);
    expect(trigger).not.toHaveProperty("projectionKey");
  });

  test("carries a declared sentence and drops the empty column default", async () => {
    const [declared, undeclared] = await getTriggers([
      { id: "t3", createdByType: "MODULE", createdByRef: "m", manifestId: "sub", sentence: "Someone subs at {tier}" },
      { id: "t4", createdByType: "MODULE", createdByRef: "m", manifestId: "cheer", sentence: "" },
    ]);
    expect(declared?.sentence).toBe("Someone subs at {tier}");
    expect(undeclared).not.toHaveProperty("sentence");
  });
});

/** The route is a mixin over the api's route host; `listActions` is all it touches. */
function getActions(rows: unknown[]): Promise<Record<string, unknown>[]> {
  const ctx = {
    db: {
      async listActions() {
        return rows;
      },
    },
  };
  const route = triggersRoutes.getActions as unknown as () => Promise<Record<string, unknown>[]>;
  return route.call(ctx);
}

describe("getActions", () => {
  // The UI finds a resource page's actions (a counter's +1) by this key. Without
  // it, each sync erased the key the registration webhook had stored.
  test("gives a module action the projectionKey the registration webhook gives it", async () => {
    const [action] = await getActions([
      {
        id: "a1",
        createdByType: "MODULE",
        createdByRef: "woofx3",
        manifestId: "counter.increment",
        call: "woofx3:function:counter.increment",
      },
    ]);
    expect(action?.projectionKey).toBe("woofx3:action:counter.increment");
  });

  test("gives an action no module owns no projectionKey", async () => {
    const [action] = await getActions([{ id: "a2", createdByType: "USER", createdByRef: "", manifestId: "" }]);
    expect(action).not.toHaveProperty("projectionKey");
  });

  test("carries a declared sentence and drops the empty column default", async () => {
    const [declared, undeclared] = await getActions([
      {
        id: "a3",
        createdByType: "MODULE",
        createdByRef: "m",
        manifestId: "increment",
        sentence: "Add {amount} to {counter}",
      },
      { id: "a4", createdByType: "MODULE", createdByRef: "m", manifestId: "reset", sentence: "" },
    ]);
    expect(declared?.sentence).toBe("Add {amount} to {counter}");
    expect(undeclared).not.toHaveProperty("sentence");
  });
});

describe("moduleProjectionKey", () => {
  test("is empty without a module owner or a manifest id", () => {
    expect(moduleProjectionKey({ createdByType: "MODULE", createdByRef: "", manifestId: "x" }, "trigger")).toBe("");
    expect(moduleProjectionKey({ createdByType: "MODULE", createdByRef: "m", manifestId: "" }, "action")).toBe("");
  });
});

/** getWorkflowCatalog reads triggers, actions and modules; a reader that throws stands for db-proxy failing. */
function getWorkflowCatalog(db: { triggers?: unknown[]; actions?: unknown[]; modules?: unknown[]; failing?: string }) {
  const read = (name: string, rows: unknown[] | undefined) => async () => {
    if (db.failing === name) {
      throw new Error(`db.${name} failed`);
    }
    return rows ?? [];
  };
  const ctx = {
    db: {
      listTriggers: read("listTriggers", db.triggers),
      listActions: read("listActions", db.actions),
      listModules: read("listModules", db.modules),
    },
  };
  const route = triggersRoutes.getWorkflowCatalog as unknown as () => Promise<{
    triggers: Record<string, unknown>[];
    actions: Record<string, unknown>[];
    functions: Record<string, unknown>[];
  }>;
  return route.call(ctx);
}

describe("getWorkflowCatalog", () => {
  test("lists triggers and actions as getTriggers and getActions do, and every module function", async () => {
    const catalog = await getWorkflowCatalog({
      triggers: [
        {
          id: "t1",
          createdByType: "MODULE",
          createdByRef: "twitch",
          manifestId: "follow",
          transport: "eventbus",
          handler: "",
        },
      ],
      actions: [
        { id: "a1", createdByType: "MODULE", createdByRef: "woofx3", manifestId: "counter.increment", sentence: "" },
      ],
      modules: [
        {
          id: "mod-1",
          name: "counter",
          functions: [
            { id: "f1", manifestId: "increment", name: "Increment", runtime: "lua" },
            { id: "f2", manifestId: "", name: "Unnamed", runtime: "lua" },
          ],
        },
      ],
    });

    expect(catalog.triggers).toEqual([
      {
        id: "t1",
        createdByType: "MODULE",
        createdByRef: "twitch",
        manifestId: "follow",
        transport: "eventbus",
        projectionKey: "twitch:trigger:follow",
      },
    ]);
    expect(catalog.actions).toEqual([
      {
        id: "a1",
        createdByType: "MODULE",
        createdByRef: "woofx3",
        manifestId: "counter.increment",
        projectionKey: "woofx3:action:counter.increment",
      },
    ]);
    expect(catalog.functions).toEqual([
      {
        id: "f1",
        moduleId: "mod-1",
        moduleName: "counter",
        manifestId: "increment",
        name: "Increment",
        qualifiedName: "counter/increment",
        runtime: "lua",
      },
    ]);
  });

  // A webhook trigger is fired by its module's handler; the builder cannot bind to it.
  test("leaves out triggers fired by inbound HTTP", async () => {
    const catalog = await getWorkflowCatalog({
      triggers: [
        { id: "hook", createdByType: "MODULE", createdByRef: "throne", manifestId: "gift", transport: "webhook" },
        { id: "bus", createdByType: "MODULE", createdByRef: "twitch", manifestId: "raid", transport: "eventbus" },
        { id: "old", createdByType: "SYSTEM", createdByRef: "", manifestId: "" },
      ],
    });

    expect(catalog.triggers.map((trigger) => trigger.id)).toEqual(["bus", "old"]);
  });

  for (const failing of ["listTriggers", "listActions", "listModules"]) {
    test(`fails whole when ${failing} fails, rather than answering part of the catalog`, async () => {
      await expect(getWorkflowCatalog({ failing })).rejects.toThrow(`db.${failing} failed`);
    });
  }
});
