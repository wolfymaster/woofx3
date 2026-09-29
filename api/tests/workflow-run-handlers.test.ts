import { describe, expect, test } from "bun:test";
import { EngineEventType } from "@woofx3/api/webhooks";
import { parseRunRecorded, parseRunStepRecorded, parseRunUpdated } from "../src/workflow-run-handlers";

const RUN_ROW = {
  id: "exec-1",
  workflow_id: "wf-1",
  status: "running",
  triggered_by: "twitch",
  trigger_event: '{"id":"ev-1","type":"channel.follow"}',
  started_at: "2026-09-17T08:49:58Z",
  created_at: "2026-09-17T08:49:58Z",
  updated_at: "2026-09-17T08:49:58Z",
};

const STEP_ROW = {
  id: "step-1",
  execution_id: "exec-1",
  task_id: "alert",
  status: "success",
  attempt: 1,
  step_index: 0,
  inputs: '{"target":"default"}',
  outputs: '{"published":true}',
  duration_ms: 314,
  created_at: "2026-09-17T08:49:58Z",
  updated_at: "2026-09-17T08:49:58Z",
};

describe("parseRunRecorded", () => {
  test("reads a row nested under data", () => {
    const { event } = parseRunRecorded({ data: RUN_ROW });
    expect(event?.type).toBe(EngineEventType.WORKFLOW_RUN_RECORDED);
    expect(event?.run.id).toBe("exec-1");
    expect(event?.run.workflowId).toBe("wf-1");
    expect(event?.run.triggeredBy).toBe("twitch");
  });

  // Some producers publish the row flat rather than under `data`; readRow
  // handles both, and a projection that only understood one would silently
  // drop every row from the other.
  test("reads a row published flat", () => {
    const { event } = parseRunRecorded({ ...RUN_ROW });
    expect(event?.run.id).toBe("exec-1");
  });

  // Go's default marshalling capitalises field names; the snake_case tags are
  // what the models declare. Both reach this parser depending on the path.
  test("accepts Go-capitalised field names", () => {
    const { event } = parseRunRecorded({
      data: { ID: "exec-2", WorkflowID: "wf-2", Status: "completed" },
    });
    expect(event?.run.id).toBe("exec-2");
    expect(event?.run.workflowId).toBe("wf-2");
    expect(event?.run.status).toBe("completed");
  });

  // The trigger event is what a replay re-feeds, so it has to survive as the
  // exact string the engine stored rather than being re-encoded.
  test("carries the trigger event verbatim", () => {
    const { event } = parseRunRecorded({ data: RUN_ROW });
    expect(event?.run.triggerEvent).toBe('{"id":"ev-1","type":"channel.follow"}');
  });

  test("omits absent optional fields rather than emitting empty strings", () => {
    const { event } = parseRunRecorded({
      data: { id: "exec-3", workflow_id: "wf-1", status: "running" },
    });
    expect(event && "error" in event.run).toBe(false);
    expect(event && "completedAt" in event.run).toBe(false);
  });

  test("drops a row with no id", () => {
    const { event } = parseRunRecorded({ data: { workflow_id: "wf-1" } });
    expect(event).toBeNull();
  });
});

describe("parseRunUpdated", () => {
  test("maps a settled run to the updated event", () => {
    const { event } = parseRunUpdated({
      data: { ...RUN_ROW, status: "failed", error: "boom", completed_at: "2026-09-17T08:50:00Z" },
    });
    expect(event?.type).toBe(EngineEventType.WORKFLOW_RUN_UPDATED);
    expect(event?.run.status).toBe("failed");
    expect(event?.run.error).toBe("boom");
    expect(event?.run.completedAt).toBe("2026-09-17T08:50:00Z");
  });
});

describe("parseRunStepRecorded", () => {
  test("reads a step and its payloads", () => {
    const { event } = parseRunStepRecorded({ data: STEP_ROW });
    expect(event?.type).toBe(EngineEventType.WORKFLOW_RUN_STEP_RECORDED);
    expect(event?.step.taskId).toBe("alert");
    expect(event?.step.stepIndex).toBe(0);
    expect(event?.step.inputs).toBe('{"target":"default"}');
    expect(event?.step.outputs).toBe('{"published":true}');
    expect(event?.step.durationMs).toBe(314);
  });

  // step_index 0 is the first step, not a missing value. Treating a falsy
  // number as absent would push every first step to the wrong position.
  test("keeps a zero step index", () => {
    const { event } = parseRunStepRecorded({ data: { ...STEP_ROW, step_index: 0 } });
    expect(event?.step.stepIndex).toBe(0);
  });

  test("defaults attempt to the first when the producer omits it", () => {
    const { event } = parseRunStepRecorded({
      data: { id: "s", execution_id: "exec-1", task_id: "alert", status: "success" },
    });
    expect(event?.step.attempt).toBe(1);
  });

  // A step that cannot be placed in a run is useless to a timeline, so it is
  // dropped rather than stored somewhere nothing will look for it.
  test("drops a step with no execution or task", () => {
    expect(parseRunStepRecorded({ data: { id: "s", task_id: "alert" } }).event).toBeNull();
    expect(parseRunStepRecorded({ data: { id: "s", execution_id: "exec-1" } }).event).toBeNull();
  });
});
