import { describe, expect, test } from "bun:test";
import { ENGINE_CAPABILITIES, WORKFLOW_RUN_SNAPSHOT_MAX_LIMIT } from "@woofx3/api";
import type { WorkflowRunSnapshot } from "@woofx3/api/webhooks";
import type * as workflow from "@woofx3/db/workflow.pb";
import { RPC_METHODS } from "../src/api-session";
import { engineRoutes } from "../src/routes/engine";
import { workflowsExecutionRoutes } from "../src/routes/workflows-execution";
import { runSnapshotFromRow } from "../src/stored-snapshots";

const EARLY = { seconds: 1_792_497_600n, nanos: 0 };
const LATE = { seconds: 1_792_497_660n, nanos: 0 };
const UNSET = { seconds: 0n, nanos: 0 };

function storedRun(id: string, workflowId: string, startedAt: typeof EARLY) {
  return {
    id,
    workflowId,
    status: "failed",
    startedBy: "",
    inputs: {},
    outputs: {},
    error: "boom",
    startedAt,
    completedAt: UNSET,
    createdAt: startedAt,
    updatedAt: startedAt,
    steps: [],
    triggerEventJson: '{"type":"channel.follow"}',
    triggeredBy: "twitch",
    dryRun: true,
  };
}

type StoredRun = ReturnType<typeof storedRun>;

/**
 * A stand-in for db-proxy's ListWorkflowExecutions, which filters by
 * workflow, orders newest start first and stops at pageSize.
 */
function listRuns(rows: StoredRun[], query: unknown, { fails = false } = {}) {
  const requests: workflow.ListWorkflowExecutionsRequest[] = [];
  const ctx = {
    db: {
      async listWorkflowExecutions(req: workflow.ListWorkflowExecutionsRequest) {
        requests.push(req);
        if (fails) {
          throw new Error("listWorkflowExecutions: db-proxy unavailable");
        }
        const executions = rows
          .filter((row) => req.workflowId === "" || row.workflowId === req.workflowId)
          .sort((a, b) => Number(b.startedAt.seconds - a.startedAt.seconds))
          .slice(0, req.pageSize);
        return { executions, totalCount: executions.length, page: 1, pageSize: req.pageSize };
      },
    },
  };
  const route = workflowsExecutionRoutes.listWorkflowRunSnapshots as unknown as (
    query: unknown
  ) => Promise<WorkflowRunSnapshot[]>;
  return { requests, result: route.call(ctx, query) };
}

const rows = [storedRun("run-old", "wf-raid", EARLY), storedRun("run-new", "wf-raid", LATE)];

describe("listWorkflowRunSnapshots", () => {
  test("asks for the newest runs first and answers in that order", async () => {
    const { requests, result } = listRuns(rows, {});

    expect((await result).map((run) => run.id)).toEqual(["run-new", "run-old"]);
    expect(requests).toEqual([
      expect.objectContaining({ workflowId: "", pageSize: 50, sortBy: "startedAt", sortDesc: true }),
    ]);
  });

  test("answers each run as the single-run snapshot mapper does", async () => {
    const { result } = listRuns(rows, { limit: 1 });

    const [run] = await result;
    expect(run).toEqual(runSnapshotFromRow(rows[1] as never));
    expect(run).toMatchObject({
      id: "run-new",
      workflowId: "wf-raid",
      status: "failed",
      triggeredBy: "twitch",
      triggerEvent: '{"type":"channel.follow"}',
      dryRun: true,
      error: "boom",
    });
    expect(run).not.toHaveProperty("completedAt");
  });

  test("honors limit", async () => {
    const { requests, result } = listRuns(rows, { limit: 1 });

    expect((await result).map((run) => run.id)).toEqual(["run-new"]);
    expect(requests[0]?.pageSize).toBe(1);
  });

  test.each([
    0,
    -1,
    1.5,
    Number.NaN,
    WORKFLOW_RUN_SNAPSHOT_MAX_LIMIT + 1,
  ])("refuses limit %p without asking db-proxy", async (limit) => {
    const { requests, result } = listRuns(rows, { limit });

    await expect(result).rejects.toThrow(`limit must be a whole number from 1 to ${WORKFLOW_RUN_SNAPSHOT_MAX_LIMIT}`);
    expect(requests).toEqual([]);
  });

  test("lists only the named workflow's runs", async () => {
    const mixed = [...rows, storedRun("run-follow", "wf-follow", LATE)];
    const { requests, result } = listRuns(mixed, { workflowId: "wf-follow" });

    expect((await result).map((run) => run.id)).toEqual(["run-follow"]);
    expect(requests[0]?.workflowId).toBe("wf-follow");
  });

  test("answers an empty list for a workflow with no runs", async () => {
    const { result } = listRuns(rows, { workflowId: "wf-unknown" });

    expect(await result).toEqual([]);
  });

  test("rejects when db-proxy cannot be read", async () => {
    const { result } = listRuns(rows, {}, { fails: true });

    await expect(result).rejects.toThrow("db-proxy unavailable");
  });

  test("is advertised and reachable over RPC", async () => {
    const getEngineCapabilities = engineRoutes.getEngineCapabilities as unknown as () => Promise<{
      capabilities: string[];
    }>;
    const { capabilities } = await getEngineCapabilities.call({ hosting: null });

    expect(capabilities).toContain(ENGINE_CAPABILITIES.workflowRunSnapshots);
    expect(RPC_METHODS).toContain("listWorkflowRunSnapshots");
  });
});
