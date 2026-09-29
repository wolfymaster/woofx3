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
});

describe("moduleProjectionKey", () => {
  test("is empty without a module owner or a manifest id", () => {
    expect(moduleProjectionKey({ createdByType: "MODULE", createdByRef: "", manifestId: "x" }, "trigger")).toBe("");
    expect(moduleProjectionKey({ createdByType: "MODULE", createdByRef: "m", manifestId: "" }, "action")).toBe("");
  });
});
