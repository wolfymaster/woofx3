import { describe, expect, test } from "bun:test";
import { workflowsExecutionRoutes } from "../src/routes/workflows-execution";

type WorkflowRow = { id: string; name: string; description: string; enabled: boolean };

type TriggerResult = {
  executionId: string;
  status: string;
  message: string;
  triggerId: string;
  eventType?: string;
  unmetConditions?: Array<{ field: string; operator: string; value: unknown; error?: string }>;
};

type Published = {
  eventType: string;
  data: Record<string, unknown>;
  correlation?: { triggerId?: string; triggeredBy?: string };
};

type TriggerOptions = {
  triggerData?: Record<string, unknown>;
  platform?: string;
  skipConditions?: boolean;
  origin?: string;
  dryRun?: boolean;
};

/**
 * The route is a mixin over the api's route host. `triggerWorkflowByName`
 * touches only these three members, so the rest of the host is irrelevant here.
 */
function setup(workflows: WorkflowRow[], engineReply: Record<string, unknown> = { outcome: "started" }) {
  const published: Published[] = [];
  const requested: Published[] = [];
  let executeWorkflowCalls = 0;

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
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
    async requestEvent(
      eventType: string,
      data: Record<string, unknown>,
      correlation?: { triggerId?: string; triggeredBy?: string }
    ) {
      requested.push({ eventType, data, correlation });
      return engineReply;
    },
  };

  const route = workflowsExecutionRoutes.triggerWorkflowByName as unknown as (
    workflowNameOrId: string,
    parameters?: Record<string, string>,
    userId?: string,
    triggerId?: string,
    triggeredBy?: string,
    options?: TriggerOptions
  ) => Promise<TriggerResult>;

  return {
    published,
    requested,
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

describe("triggerWorkflowByName with sample trigger data", () => {
  const RAID = { fromBroadcasterName: "wolfy", viewers: 42 };

  // Sample data needs the engine's answer -- did the run start, and did the
  // sample match -- so it is a request rather than a publish.
  test("asks the engine and returns the run it started", async () => {
    const { trigger, published, requested } = setup(ROWS, {
      outcome: "started",
      executionId: "exec-9",
      eventType: "channel.raid",
    });
    const result = await trigger("wf-2", {}, undefined, "corr-1", undefined, {
      triggerData: RAID,
      platform: "twitch",
      origin: "test",
    });

    expect(published).toHaveLength(0);
    expect(requested).toHaveLength(1);
    expect(requested[0]?.eventType).toBe("workflow.execute");
    expect(requested[0]?.data).toMatchObject({ workflowId: "wf-2", triggerData: RAID, platform: "twitch" });
    expect(requested[0]?.data.skipConditions).toBeUndefined();
    expect(requested[0]?.correlation).toEqual({ triggerId: "corr-1", triggeredBy: "test" });
    expect(result).toMatchObject({
      executionId: "exec-9",
      status: "started",
      triggerId: "corr-1",
      eventType: "channel.raid",
    });
  });

  test("reports the conditions a sample failed instead of doing nothing", async () => {
    const unmet = [{ field: "${trigger.data.viewers}", operator: "gte", value: 10 }];
    const { trigger } = setup(ROWS, { outcome: "conditions_not_met", eventType: "channel.raid", unmet });
    const result = await trigger("wf-2", {}, undefined, undefined, "test", { triggerData: { viewers: 2 } });

    expect(result.status).toBe("conditions_not_met");
    expect(result.executionId).toBe("");
    expect(result.unmetConditions).toEqual(unmet);
    expect(result.message).toContain("${trigger.data.viewers} gte 10");
  });

  test("passes skipConditions through", async () => {
    const { trigger, requested } = setup(ROWS);
    await trigger("wf-2", {}, undefined, undefined, undefined, { triggerData: {}, skipConditions: true });
    expect(requested[0]?.data.skipConditions).toBe(true);
  });

  test("surfaces an engine refusal as an error", async () => {
    const { trigger } = setup(ROWS, { outcome: "refused", error: "workflow not found: wf-2" });
    expect(trigger("wf-2", {}, undefined, undefined, undefined, { triggerData: {} })).rejects.toThrow(
      "workflow not found: wf-2"
    );
  });

  test("refuses sample data over the size limit before sending it", async () => {
    const { trigger, requested } = setup(ROWS);
    const blob = "x".repeat(16 * 1024);
    await expect(trigger("wf-2", {}, undefined, undefined, undefined, { triggerData: { blob } })).rejects.toThrow(
      "byte limit"
    );
    expect(requested).toHaveLength(0);
  });

  test("refuses sample data that is not an object", async () => {
    const { trigger } = setup(ROWS);
    const notAnObject = [1, 2] as unknown as Record<string, unknown>;
    await expect(trigger("wf-2", {}, undefined, undefined, undefined, { triggerData: notAnObject })).rejects.toThrow(
      "must be a JSON object"
    );
  });

  test("refuses sample-only options without sample data", async () => {
    const { trigger } = setup(ROWS);
    await expect(trigger("wf-2", {}, undefined, undefined, undefined, { skipConditions: true })).rejects.toThrow(
      "only apply with options.triggerData"
    );
  });

  test("refuses an origin that contradicts triggeredBy", async () => {
    const { trigger } = setup(ROWS);
    await expect(trigger("wf-2", {}, undefined, undefined, "dashboard", { origin: "test" })).rejects.toThrow(
      "disagree"
    );
  });

  // origin alone is only provenance; it needs no answer from the engine.
  test("an origin without sample data still publishes", async () => {
    const { trigger, published, requested } = setup(ROWS);
    const result = await trigger("wf-2", {}, undefined, undefined, undefined, { origin: "test" });
    expect(requested).toHaveLength(0);
    expect(published[0]?.correlation?.triggeredBy).toBe("test");
    expect(result.status).toBe("requested");
  });
});

describe("triggerWorkflowByName dry run", () => {
  test("asks the engine for a dry run, even without sample data", async () => {
    const { trigger, published, requested } = setup(ROWS, { outcome: "started", executionId: "exec-3" });
    const result = await trigger("wf-1", {}, undefined, undefined, undefined, { dryRun: true });

    expect(published).toHaveLength(0);
    expect(requested[0]?.data.dryRun).toBe(true);
    expect(requested[0]?.data.triggerData).toBeUndefined();
    expect(result).toMatchObject({ status: "started", executionId: "exec-3", dryRun: true });
  });

  // Recorded, and labelled as a test, when the caller gave no origin.
  test("records a dry run as a test run by default", async () => {
    const { trigger, requested } = setup(ROWS);
    await trigger("wf-1", {}, undefined, undefined, undefined, { dryRun: true, triggerData: { viewers: 5 } });
    expect(requested[0]?.correlation?.triggeredBy).toBe("test");
    expect(requested[0]?.data).toMatchObject({ dryRun: true, triggerData: { viewers: 5 } });
  });

  test("keeps the caller's origin for a dry run", async () => {
    const { trigger, requested } = setup(ROWS);
    await trigger("wf-1", {}, undefined, undefined, "replay", { dryRun: true });
    expect(requested[0]?.correlation?.triggeredBy).toBe("replay");
  });

  test("a real run carries no dry-run flag", async () => {
    const { trigger, requested } = setup(ROWS);
    await trigger("wf-1", {}, undefined, undefined, undefined, { triggerData: {} });
    expect(requested[0]?.data.dryRun).toBeUndefined();
  });
});

describe("cancelWorkflow", () => {
  type Row = { id: string; status: string };

  function setupCancel(reply: Record<string, unknown>, row?: Row, updateFails = false) {
    const requests: Array<{ subject: string; body: unknown }> = [];
    const updates: Array<{ id: string; status: string; error: string }> = [];
    let current = row;
    const ctx = {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      db: {
        async getWorkflowExecution(req: { id: string }) {
          if (!current || current.id !== req.id) {
            throw new Error("not found");
          }
          return current;
        },
        async updateWorkflowRunStatus(req: { id: string; status: string; error: string }) {
          if (updateFails) {
            current = { id: req.id, status: "completed" };
            throw new Error("failed_precondition");
          }
          updates.push(req);
          current = { id: req.id, status: req.status };
          return current;
        },
      },
      async requestJson(subject: string, body: unknown) {
        requests.push({ subject, body });
        return reply;
      },
    };
    const route = workflowsExecutionRoutes.cancelWorkflow as unknown as (
      executionId: string,
      reason?: string
    ) => Promise<{ executionId: string; outcome: string; status: string; message: string }>;
    return { requests, updates, cancel: (id: string, reason?: string) => route.call(ctx, id, reason) };
  }

  test("asks the engine to stop the run", async () => {
    const { cancel, requests, updates } = setupCancel({ outcome: "cancelled", status: "cancelled" });
    const result = await cancel("run-1", "from the dashboard");
    expect(requests).toEqual([
      { subject: "workflow.cancel", body: { executionId: "run-1", reason: "from the dashboard" } },
    ]);
    expect(result).toMatchObject({ executionId: "run-1", outcome: "cancelled", status: "cancelled" });
    // The engine settles the row itself, through its recorder.
    expect(updates).toHaveLength(0);
  });

  test("reports a run that had already finished", async () => {
    const { cancel } = setupCancel({ outcome: "already_finished", status: "completed" });
    const result = await cancel("run-1");
    expect(result).toMatchObject({ outcome: "already_finished", status: "completed" });
  });

  test("gives the engine a default reason", async () => {
    const { cancel, requests } = setupCancel({ outcome: "cancelled", status: "cancelled" });
    await cancel("run-1");
    expect(requests[0]?.body).toEqual({ executionId: "run-1", reason: "Cancelled by user" });
  });

  // A run the engine lost to a restart reads as running forever unless its
  // row is settled here.
  test("settles a stranded run the engine does not know in the history", async () => {
    const { cancel, updates } = setupCancel({ outcome: "not_found" }, { id: "run-1", status: "running" });
    const result = await cancel("run-1", "stuck");
    expect(updates).toEqual([expect.objectContaining({ id: "run-1", status: "cancelled", error: "cancelled: stuck" })]);
    expect(result).toMatchObject({ outcome: "cancelled", status: "cancelled" });
  });

  test("leaves a settled row the engine does not know alone", async () => {
    const { cancel, updates } = setupCancel({ outcome: "not_found" }, { id: "run-1", status: "failed" });
    const result = await cancel("run-1");
    expect(updates).toHaveLength(0);
    expect(result).toMatchObject({ outcome: "already_finished", status: "failed" });
  });

  test("reports the row's own outcome when it settles during the cancel", async () => {
    const { cancel } = setupCancel({ outcome: "not_found" }, { id: "run-1", status: "running" }, true);
    const result = await cancel("run-1");
    expect(result).toMatchObject({ outcome: "already_finished", status: "completed" });
  });

  test("refuses an id no run has", async () => {
    const { cancel } = setupCancel({ outcome: "not_found" });
    await expect(cancel("nope")).rejects.toThrow("not found");
  });

  test("refuses an empty id", async () => {
    const { cancel, requests } = setupCancel({ outcome: "cancelled" });
    await expect(cancel("")).rejects.toThrow("executionId is required");
    expect(requests).toHaveLength(0);
  });
});

describe("replayWorkflowRun", () => {
  type ReplayPublished = {
    eventType: string;
    data: {
      workflowId: string;
      triggerEvent: string;
      fromTaskId: string;
      steps: Array<{ taskId: string; status: string; attempt: number; outputs: string }>;
    };
    correlation?: { triggerId?: string; triggeredBy?: string };
  };

  function setupReplay() {
    const published: ReplayPublished[] = [];
    const lookups: string[] = [];
    let dryRun = false;
    const ctx = {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      db: {
        async getWorkflowExecution(req: { id: string }) {
          lookups.push(req.id);
          return {
            id: req.id,
            workflowId: "wf-1",
            dryRun,
            triggerEventJson: '{"id":"ev-1","type":"channel.follow"}',
            steps: [
              { stepId: "fetch", status: "success", attempt: 1, outputsJson: '{"user":"x"}' },
              { stepId: "alert", status: "failed", attempt: 1, outputsJson: "{}" },
            ],
          };
        },
      },
      async publishEvent(
        eventType: string,
        data: ReplayPublished["data"],
        _subject?: string,
        _platform?: string,
        _source?: string,
        correlation?: { triggerId?: string; triggeredBy?: string }
      ) {
        published.push({ eventType, data, correlation });
      },
    };
    const route = workflowsExecutionRoutes.replayWorkflowRun as unknown as (
      engineRunId: string,
      fromTaskId?: string,
      triggerId?: string,
      triggeredBy?: string
    ) => Promise<{ triggerId: string }>;
    return {
      published,
      lookups,
      setDryRun: (value: boolean) => {
        dryRun = value;
      },
      replay: (...args: Parameters<typeof route>) => route.call(ctx, ...args),
    };
  }

  // The db proxy is the record of what happened, so the replay is built from
  // it rather than from whatever the dashboard happens to hold.
  test("reads the run from the db proxy", async () => {
    const { replay, lookups } = setupReplay();
    await replay("run-1");
    expect(lookups).toEqual(["run-1"]);
  });

  test("publishes the original trigger event and the recorded step outcomes", async () => {
    const { replay, published } = setupReplay();
    await replay("run-1", "alert", "corr-1", "dashboard");

    expect(published).toHaveLength(1);
    const [message] = published;
    expect(message?.eventType).toBe("workflow.replay");
    expect(message?.data.workflowId).toBe("wf-1");
    expect(message?.data.triggerEvent).toBe('{"id":"ev-1","type":"channel.follow"}');
    expect(message?.data.fromTaskId).toBe("alert");
    expect(message?.data.steps).toEqual([
      { taskId: "fetch", status: "success", attempt: 1, outputs: '{"user":"x"}' },
      { taskId: "alert", status: "failed", attempt: 1, outputs: "{}" },
    ]);
    expect(message?.correlation).toEqual({ triggerId: "corr-1", triggeredBy: "dashboard" });
  });

  test("replays a dry run as a dry run", async () => {
    const { replay, published, setDryRun } = setupReplay();
    setDryRun(true);
    await replay("run-1");
    expect((published[0]?.data as { dryRun?: boolean }).dryRun).toBe(true);
  });

  test("replays a real run without the dry-run flag", async () => {
    const { replay, published } = setupReplay();
    await replay("run-1");
    expect((published[0]?.data as { dryRun?: boolean }).dryRun).toBeUndefined();
  });

  // An empty resume step means the whole run; the engine reads it that way.
  test("replays the whole run when no step is named", async () => {
    const { replay, published } = setupReplay();
    await replay("run-1");
    expect(published[0]?.data.fromTaskId).toBe("");
  });

  test("mints a correlation id when the caller supplies none", async () => {
    const { replay, published } = setupReplay();
    const result = await replay("run-1");
    expect(result.triggerId).not.toBe("");
    expect(published[0]?.correlation?.triggerId).toBe(result.triggerId);
  });
});
