import { describe, expect, test } from "bun:test";
import { workflowsExecutionRoutes } from "../src/routes/workflows-execution";

const NOON = { seconds: 1_792_497_600n, nanos: 0 };
const UNSET = { seconds: 0n, nanos: 0 };

function storedRun(steps: unknown[]) {
  return {
    id: "run-1",
    workflowId: "wf-1",
    status: "completed",
    startedBy: "",
    inputs: {},
    outputs: {},
    error: "",
    startedAt: NOON,
    completedAt: NOON,
    createdAt: NOON,
    updatedAt: NOON,
    steps,
    triggerEventJson: "",
    triggeredBy: "chat",
    dryRun: false,
  };
}

function storedStep(id: string, taskId: string, stepIndex: number) {
  return {
    id,
    stepId: taskId,
    name: "",
    status: "success",
    attempt: 1,
    error: "",
    startedAt: NOON,
    completedAt: NOON,
    durationMs: 0n,
    inputsJson: "{}",
    outputsJson: "",
    stepIndex,
    createdAt: NOON,
    updatedAt: NOON,
  };
}

const storedAlert = {
  id: "alert-1",
  payload: "{}",
  workflowId: "run-1",
  sourceEventId: "",
  status: "sent",
  createdAt: NOON,
  updatedAt: NOON,
  envelopeId: "env-1",
  dispatchedAt: UNSET,
  playedAt: UNSET,
  completedAt: UNSET,
  error: "",
  version: 1n,
};

/** getWorkflowRun touches only these db reads; each request it makes is recorded. */
function getWorkflowRun(
  executionId: string,
  { run, workflow }: { run: unknown | null; workflow: { name: string } | null }
) {
  const requests: Array<[string, unknown]> = [];
  const ctx = {
    db: {
      async findWorkflowExecution(req: unknown) {
        requests.push(["findWorkflowExecution", req]);
        return run;
      },
      async findWorkflow(req: unknown) {
        requests.push(["findWorkflow", req]);
        return workflow;
      },
      async listAlerts(req: unknown) {
        requests.push(["listAlerts", req]);
        return { alerts: [storedAlert], totalCount: 1 };
      },
    },
  };
  const route = workflowsExecutionRoutes.getWorkflowRun as unknown as (
    id: string
  ) => Promise<Record<string, any> | null>;
  return { requests, result: route.call(ctx, executionId) };
}

describe("getWorkflowRun", () => {
  test("reads the run, its steps in run order, and the alerts it fired", async () => {
    const { requests, result } = getWorkflowRun("run-1", {
      run: storedRun([storedStep("s-1", "first", 0), storedStep("s-2", "second", 1)]),
      workflow: { name: "Raid welcome" },
    });
    const detail = await result;

    expect(detail?.run).toMatchObject({
      id: "run-1",
      workflowId: "wf-1",
      workflowName: "Raid welcome",
      triggeredBy: "chat",
    });
    expect(
      detail?.steps.map((step: { id: string; taskId: string; executionId: string }) => [
        step.id,
        step.taskId,
        step.executionId,
      ])
    ).toEqual([
      ["s-1", "first", "run-1"],
      ["s-2", "second", "run-1"],
    ]);
    expect(detail?.alerts).toEqual([expect.objectContaining({ id: "alert-1", workflowId: "run-1", version: 1 })]);
    expect(requests).toEqual([
      ["findWorkflowExecution", { id: "run-1" }],
      ["findWorkflow", { id: "wf-1" }],
      ["listAlerts", { limit: 50, offset: 0, workflowId: "run-1" }],
    ]);
  });

  test("names a run whose workflow was deleted with an empty name", async () => {
    const { result } = getWorkflowRun("run-1", { run: storedRun([]), workflow: null });

    expect((await result)?.run.workflowName).toBe("");
  });

  test("answers null for a run db-proxy does not hold", async () => {
    const { requests, result } = getWorkflowRun("run-9", { run: null, workflow: null });

    expect(await result).toBeNull();
    expect(requests).toEqual([["findWorkflowExecution", { id: "run-9" }]]);
  });

  test("refuses an empty id without asking", async () => {
    const { requests, result } = getWorkflowRun("", { run: null, workflow: null });

    await expect(result).rejects.toThrow("executionId is required");
    expect(requests).toEqual([]);
  });

  test("fails on a step db-proxy sent without its id", async () => {
    const { result } = getWorkflowRun("run-1", { run: storedRun([storedStep("", "first", 0)]), workflow: null });

    await expect(result).rejects.toThrow("a step of run run-1 has no id");
  });
});
