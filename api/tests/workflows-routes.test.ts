import { describe, expect, mock, test } from "bun:test";
import { DbError } from "../src/db-client";
import { workflowsRoutes } from "../src/routes/workflows";

const commandWorkflow = {
  id: "wf-hug",
  name: "!hug",
  description: "",
  enabled: true,
  stepsJson: JSON.stringify([{ id: "say", type: "action", action: "print" }]),
  triggerJson: JSON.stringify({ type: "command", event: "chat.command.hug" }),
};

/**
 * The routes are a mixin over the api's route host; these touch only `db`,
 * `logger` and the webhook emitter.
 */
function setup() {
  const db = {
    findWorkflow: mock(async () => commandWorkflow),
    getWorkflow: mock(async () => commandWorkflow),
    createWorkflow: mock(async () => ({ id: "new" })),
    updateWorkflow: mock(async () => commandWorkflow),
    tryDeleteWorkflow: mock(async () => true),
  };
  const ctx = {
    db,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    emitWorkflowWebhook: mock(async () => {}),
  };
  return { db, ctx };
}

describe("a chat command's workflow", () => {
  test("cannot be created, changed, toggled or deleted as a workflow of its own", async () => {
    const { db, ctx } = setup();
    const definition = {
      id: "wf-hug",
      name: "!hug",
      trigger: { type: "command" as const, event: "chat.command.hug" },
      tasks: [{ id: "say", type: "action" as const, action: "print" }],
    };

    await expect(workflowsRoutes.createWorkflow.call(ctx as never, { definition })).rejects.toThrow(/command/);
    await expect(
      workflowsRoutes.updateWorkflow.call(ctx as never, "wf-hug", {
        definition: { ...definition, trigger: { type: "event", event: "chat.command.hug" } },
      })
    ).rejects.toThrow(/from the command/);
    await expect(workflowsRoutes.setWorkflowEnabled.call(ctx as never, "wf-hug", false)).rejects.toThrow(
      /from the command/
    );
    await expect(workflowsRoutes.deleteWorkflow.call(ctx as never, "wf-hug")).rejects.toThrow(/from the command/);

    expect(db.createWorkflow).not.toHaveBeenCalled();
    expect(db.updateWorkflow).not.toHaveBeenCalled();
    expect(db.tryDeleteWorkflow).not.toHaveBeenCalled();
  });
});

describe("updateWorkflow from an older copy", () => {
  const stored = {
    id: "wf-cheer",
    name: "Cheer",
    enabled: true,
    revision: 4,
    stepsJson: JSON.stringify([{ id: "a" }, { id: "b" }]),
    triggerJson: JSON.stringify({ type: "event", event: "cheer" }),
  };
  const sent = { id: "wf-cheer", name: "Cheer", trigger: { type: "event", event: "cheer" }, tasks: [{ id: "a", type: "action", action: "print" }] };

  function refusing(update: () => Promise<unknown>) {
    const db = {
      findWorkflow: mock(async () => stored),
      getWorkflow: mock(async () => stored),
      updateWorkflow: mock(update),
    };
    const emitWorkflowWebhook = mock(async () => {});
    const ctx = { db, emitWorkflowWebhook, logger: { info() {}, warn() {}, error() {}, debug() {} } };
    return { ctx, emitWorkflowWebhook };
  }

  test("answers with what is stored and sends no callback", async () => {
    const { ctx, emitWorkflowWebhook } = refusing(async () => {
      throw new DbError("updateWorkflow", "aborted", "workflow changed since it was read");
    });
    const result = await workflowsRoutes.updateWorkflow.call(ctx as never, "wf-cheer", {
      definition: sent as never,
      expectedRevision: 3,
    });
    expect(result).toMatchObject({
      conflict: true,
      current: { revision: 4, definition: { tasks: [{ id: "a" }, { id: "b" }] } },
    });
    expect(emitWorkflowWebhook).not.toHaveBeenCalled();
  });

  test("reports the stored steps when the save merged others in", async () => {
    const { ctx, emitWorkflowWebhook } = refusing(async () => stored);
    const result = await workflowsRoutes.updateWorkflow.call(ctx as never, "wf-cheer", { definition: sent as never });
    expect(result).toMatchObject({ revision: 4, definition: { tasks: [{ id: "a" }, { id: "b" }] } });
    expect(emitWorkflowWebhook.mock.calls[0]).toMatchObject([
      { workflow: { revision: 4, definition: { tasks: [{ id: "a" }, { id: "b" }] } } },
    ]);
  });
});
