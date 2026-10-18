import { describe, expect, mock, test } from "bun:test";
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
