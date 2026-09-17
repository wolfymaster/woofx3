import { describe, expect, test } from "bun:test";
import { workflowsExecutionRoutes } from "../src/routes/workflows-execution";

type WorkflowRow = { id: string; name: string; description: string; enabled: boolean };

type TriggerResult = {
  executionId: string;
  status: string;
  message: string;
  triggerId: string;
};

type Published = {
  eventType: string;
  data: Record<string, unknown>;
  correlation?: { triggerId?: string; triggeredBy?: string };
};

/**
 * The route is a mixin over the api's route host. `triggerWorkflowByName`
 * touches only these four members, so the rest of the host is irrelevant here.
 */
function setup(workflows: WorkflowRow[]) {
  const published: Published[] = [];
  let executeWorkflowCalls = 0;

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    async ensureApplicationId() {
      return "app-1";
    },
    db: {
      async listWorkflows() {
        return { workflows };
      },
      // Present so the test would notice the route reaching for it again.
      async executeWorkflow() {
        executeWorkflowCalls += 1;
        return { executionId: "exec-from-db", async: true };
      },
    },
    async publishEvent(
      eventType: string,
      data: Record<string, unknown>,
      _subject?: string,
      _platform?: string,
      _source?: string,
      correlation?: { triggerId?: string; triggeredBy?: string }
    ) {
      published.push({ eventType, data, correlation });
    },
  };

  const route = workflowsExecutionRoutes.triggerWorkflowByName as unknown as (
    workflowNameOrId: string,
    parameters?: Record<string, string>,
    userId?: string,
    triggerId?: string,
    triggeredBy?: string
  ) => Promise<TriggerResult>;

  return {
    published,
    executeWorkflowCalls: () => executeWorkflowCalls,
    trigger: (...args: Parameters<typeof route>) => route.call(ctx, ...args),
  };
}

const ROWS: WorkflowRow[] = [
  { id: "wf-1", name: "Follow Alert", description: "", enabled: true },
  { id: "wf-2", name: "Raid Alert", description: "", enabled: true },
  { id: "wf-3", name: "Disabled One", description: "", enabled: false },
];

describe("triggerWorkflowByName", () => {
  // The dashboard holds ids, not names. Matching only on name is why every
  // call from it failed to find a workflow that was sitting right there.
  test("matches a workflow by id", async () => {
    const { trigger, published } = setup(ROWS);
    await trigger("wf-2");
    expect(published[0]?.data.workflowId).toBe("wf-2");
  });

  test("matches a workflow by name, ignoring case", async () => {
    const { trigger, published } = setup(ROWS);
    await trigger("follow alert");
    expect(published[0]?.data.workflowId).toBe("wf-1");
  });

  // Id is exact; a name match is case-insensitive and need not be unique. When
  // a string could be either, the exact one has to win.
  test("prefers an id match over a name match", async () => {
    const { trigger, published } = setup([
      { id: "wf-1", name: "other", description: "", enabled: true },
      { id: "collide", name: "wf-1", description: "", enabled: true },
    ]);
    await trigger("wf-1");
    expect(published[0]?.data.workflowId).toBe("wf-1");
  });

  test("refuses a workflow it cannot find", async () => {
    const { trigger } = setup(ROWS);
    expect(trigger("nope")).rejects.toThrow('Workflow "nope" not found');
  });

  test("refuses a disabled workflow", async () => {
    const { trigger } = setup(ROWS);
    expect(trigger("wf-3")).rejects.toThrow("is disabled");
  });

  // The regression guard. db-proxy's ExecuteWorkflow wrote a pending row that
  // nothing ever consumed: it recorded a run that never happened and handed
  // back an id matching nothing. The engine owns execution now.
  test("publishes a run request instead of writing an execution row", async () => {
    const { trigger, published, executeWorkflowCalls } = setup(ROWS);
    await trigger("wf-1");
    expect(executeWorkflowCalls()).toBe(0);
    expect(published).toHaveLength(1);
    expect(published[0]?.eventType).toBe("workflow.execute");
  });

  test("carries the caller's correlation attributes onto the event", async () => {
    const { trigger, published } = setup(ROWS);
    const result = await trigger("wf-1", {}, undefined, "corr-1", "dashboard");
    expect(published[0]?.correlation).toEqual({ triggerId: "corr-1", triggeredBy: "dashboard" });
    expect(result.triggerId).toBe("corr-1");
  });

  test("mints a correlation id when the caller supplies none", async () => {
    const { trigger, published } = setup(ROWS);
    const result = await trigger("wf-1");
    expect(result.triggerId).not.toBe("");
    expect(published[0]?.correlation?.triggerId).toBe(result.triggerId);
  });

  // Empty rather than invented: the engine mints the execution id when the run
  // begins, after this call has returned. A fabricated one matches no run.
  test("returns no execution id, because there is not one yet", async () => {
    const { trigger } = setup(ROWS);
    const result = await trigger("wf-1");
    expect(result.executionId).toBe("");
    expect(result.status).toBe("requested");
  });

  test("passes the inputs through to the engine", async () => {
    const { trigger, published } = setup(ROWS);
    await trigger("wf-1", { user: "wolfy" });
    expect(published[0]?.data.inputs).toEqual({ user: "wolfy" });
  });
});
