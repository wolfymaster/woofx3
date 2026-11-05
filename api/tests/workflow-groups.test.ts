import { describe, expect, mock, test } from "bun:test";
import { ENGINE_CAPABILITIES, supportedEngineCapabilities } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import { RPC_METHODS } from "../src/api-session";
import { DbError } from "../src/db-client";
import { workflowGroupsRoutes } from "../src/routes/workflow-groups";
import { workflowsRoutes } from "../src/routes/workflows";
import {
  initWorkflowGroupHandlers,
  parseWorkflowGroupDeleted,
  parseWorkflowGroupUpdated,
} from "../src/workflow-group-event-handlers";

const stored = { id: "g-1", name: "Holiday", description: "", enabled: true, memberIds: ["wf-1", "wf-2"] };

/** The routes are a mixin over the api's route host; these touch only `db` and the webhook emitter. */
function setup(db: Record<string, unknown>) {
  const emitWorkflowGroupWebhook = mock(async (_event: unknown) => {});
  const ctx = { db, emitWorkflowGroupWebhook, logger: { info() {}, warn() {}, error() {}, debug() {} } };
  return { ctx, emitWorkflowGroupWebhook };
}

describe("workflow group methods", () => {
  test("are advertised as workflows.groups and reachable over RPC", () => {
    expect(supportedEngineCapabilities()).toContain(ENGINE_CAPABILITIES.workflowsGroups);
    for (const method of [
      "listWorkflowGroups",
      "createWorkflowGroup",
      "updateWorkflowGroup",
      "deleteWorkflowGroup",
      "setWorkflowGroupEnabled",
      "addWorkflowGroupMembers",
      "removeWorkflowGroupMembers",
    ]) {
      expect(RPC_METHODS as readonly string[]).toContain(method);
    }
  });

  test("switching a group echoes it with the caller's correlation key", async () => {
    const setWorkflowGroupEnabled = mock(async () => stored);
    const { ctx, emitWorkflowGroupWebhook } = setup({ setWorkflowGroupEnabled });

    const group = await workflowGroupsRoutes.setWorkflowGroupEnabled.call(ctx as never, "g-1", true, "corr-1");

    expect(setWorkflowGroupEnabled).toHaveBeenCalledWith({ id: "g-1", enabled: true });
    expect(group).toEqual(stored);
    expect(emitWorkflowGroupWebhook.mock.calls[0]?.[0]).toEqual({
      type: EngineEventType.WORKFLOW_GROUP_UPDATED,
      correlationKey: "corr-1",
      group: stored,
    });
  });

  test("adding members passes the ids through and echoes the group", async () => {
    const addWorkflowGroupMembers = mock(async () => stored);
    const { ctx, emitWorkflowGroupWebhook } = setup({ addWorkflowGroupMembers });

    await workflowGroupsRoutes.addWorkflowGroupMembers.call(ctx as never, "g-1", ["wf-1", "wf-2"], "corr-2");

    expect(addWorkflowGroupMembers).toHaveBeenCalledWith({ groupId: "g-1", workflowIds: ["wf-1", "wf-2"] });
    expect(emitWorkflowGroupWebhook).toHaveBeenCalledTimes(1);
  });

  test("a refusal from db-proxy reaches the caller and sends no callback", async () => {
    const { ctx, emitWorkflowGroupWebhook } = setup({
      addWorkflowGroupMembers: mock(async () => {
        throw new DbError("addWorkflowGroupMembers", "failed_precondition", "runs a chat command");
      }),
    });

    await expect(workflowGroupsRoutes.addWorkflowGroupMembers.call(ctx as never, "g-1", ["wf-cmd"])).rejects.toThrow(
      /chat command/
    );
    expect(emitWorkflowGroupWebhook).not.toHaveBeenCalled();
  });

  test("deleting a group echoes its id", async () => {
    const { ctx, emitWorkflowGroupWebhook } = setup({ deleteWorkflowGroup: mock(async () => {}) });

    expect(await workflowGroupsRoutes.deleteWorkflowGroup.call(ctx as never, "g-1", "corr-3")).toEqual({
      deleted: true,
    });
    expect(emitWorkflowGroupWebhook.mock.calls[0]?.[0]).toEqual({
      type: EngineEventType.WORKFLOW_GROUP_DELETED,
      correlationKey: "corr-3",
      groupId: "g-1",
    });
  });
});

describe("setWorkflowEnabled", () => {
  const row = {
    id: "wf-1",
    name: "Cheer",
    enabled: false,
    revision: 2,
    stepsJson: "[]",
    triggerJson: JSON.stringify({ type: "event", event: "cheer" }),
    groupIds: ["g-1"],
  };

  test("reports the switch db-proxy stored, not the one asked for", async () => {
    // A stored value differing from the request is what a later engine rule
    // could produce; the callback must mirror the row, never the argument.
    const db = {
      getWorkflow: mock(async () => row),
      updateWorkflow: mock(async () => ({ ...row, enabled: false })),
    };
    const emitWorkflowWebhook = mock(async (_event: unknown) => {});
    const ctx = { db, emitWorkflowWebhook, logger: { info() {}, warn() {}, error() {}, debug() {} } };

    const result = await workflowsRoutes.setWorkflowEnabled.call(ctx as never, "wf-1", true);

    expect(result).toEqual({ id: "wf-1", isEnabled: false });
    expect(emitWorkflowWebhook.mock.calls[0]?.[0]).toMatchObject({
      workflow: { isEnabled: false, groupIds: ["g-1"] },
    });
  });

  test("an editor save does not send a switch", async () => {
    const db = {
      findWorkflow: mock(async () => row),
      getWorkflow: mock(async () => row),
      updateWorkflow: mock(async (_req: Record<string, unknown>) => row),
    };
    const ctx = {
      db,
      emitWorkflowWebhook: mock(async () => {}),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    };

    await workflowsRoutes.updateWorkflow.call(ctx as never, "wf-1", {
      definition: {
        id: "wf-1",
        name: "Cheer",
        trigger: { type: "event", event: "cheer" },
        tasks: [{ id: "a", type: "action", action: "print" }],
      } as never,
    });

    expect(db.updateWorkflow.mock.calls[0]?.[0]).not.toHaveProperty("enabled");
  });
});

describe("workflow group outbox", () => {
  const data = { id: "g-1", name: "Holiday", description: "d", enabled: true, member_ids: ["wf-1"] };

  test("maps the snake_case payload to a workflow_group.updated event", () => {
    expect(parseWorkflowGroupUpdated({ data })).toEqual({
      type: EngineEventType.WORKFLOW_GROUP_UPDATED,
      group: { id: "g-1", name: "Holiday", description: "d", enabled: true, memberIds: ["wf-1"] },
    });
  });

  test("drops a payload without its switch or members", () => {
    expect(parseWorkflowGroupUpdated({ data: { id: "g-1", name: "Holiday" } })).toBeNull();
  });

  test("reads a deleted group's id, falling back to the entity id", () => {
    expect(parseWorkflowGroupDeleted({ data: {}, entity_id: "g-9" })).toEqual({
      type: EngineEventType.WORKFLOW_GROUP_DELETED,
      groupId: "g-9",
    });
  });

  test("subscribes each subject and sends its webhook", async () => {
    const handlers = new Map<string, (msg: { json(): unknown }) => Promise<void>>();
    const nats = {
      subscribe: async (subject: string, handler: (msg: { json(): unknown }) => Promise<void>) => {
        handlers.set(subject, handler);
      },
    };
    const sent: Array<{ type: string }> = [];
    const webhook = { send: async (event: { type: string }) => void sent.push(event) };
    const logger = { debug() {}, info() {}, warn() {}, error() {} };

    await initWorkflowGroupHandlers(nats as never, webhook as never, logger as never);
    await handlers.get("db.workflow_group.created.*")?.({ json: () => ({ data }) });
    await handlers.get("db.workflow_group.deleted.*")?.({ json: () => ({ data: { id: "g-1" } }) });

    expect(sent.map((event) => event.type)).toEqual([
      EngineEventType.WORKFLOW_GROUP_CREATED,
      EngineEventType.WORKFLOW_GROUP_DELETED,
    ]);
  });
});
