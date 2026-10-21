import { describe, expect, test } from "bun:test";
import type * as alert from "@woofx3/db/alert.pb";
import type * as workflow from "@woofx3/db/workflow.pb";
import {
  alertSnapshotFromRow,
  rfc3339FromString,
  rfc3339FromTimestamp,
  runSnapshotFromRow,
  stepSnapshotFromRow,
} from "../src/stored-snapshots";
import { parseRunRecorded, parseRunStepRecorded } from "../src/workflow-run-handlers";

const UNSET = { seconds: 0n, nanos: 0 };
/** 2026-10-20T12:00:00Z */
const NOON = 1_792_497_600n;

describe("rfc3339FromTimestamp", () => {
  const cases: Array<{ name: string; ts: { seconds?: bigint | number; nanos?: number } | undefined; want?: string }> = [
    { name: "an absent field is unset", ts: undefined, want: undefined },
    { name: "the epoch is how an unset field decodes", ts: UNSET, want: undefined },
    {
      name: "whole seconds get nine zero digits",
      ts: { seconds: NOON, nanos: 0 },
      want: "2026-10-20T12:00:00.000000000Z",
    },
    {
      name: "nanoseconds are kept, not rounded to milliseconds",
      ts: { seconds: NOON, nanos: 123_456_789 },
      want: "2026-10-20T12:00:00.123456789Z",
    },
    {
      name: "a small fraction is zero-padded",
      ts: { seconds: NOON, nanos: 5 },
      want: "2026-10-20T12:00:00.000000005Z",
    },
    {
      name: "seconds may arrive as a number",
      ts: { seconds: Number(NOON), nanos: 0 },
      want: "2026-10-20T12:00:00.000000000Z",
    },
  ];
  for (const { name, ts, want } of cases) {
    test(name, () => {
      expect(rfc3339FromTimestamp(ts)).toBe(want);
    });
  }

  const invalid: Array<[string, { seconds: bigint; nanos: number }]> = [
    ["negative nanos", { seconds: NOON, nanos: -1 }],
    ["a whole second of nanos", { seconds: NOON, nanos: 1_000_000_000 }],
    ["fractional nanos", { seconds: NOON, nanos: 0.5 }],
  ];
  for (const [name, ts] of invalid) {
    test(`refuses ${name}`, () => {
      expect(() => rfc3339FromTimestamp(ts)).toThrow("not a protobuf timestamp");
    });
  }
});

function alertRow(overrides: Partial<alert.Alert> = {}): alert.Alert {
  return {
    id: "row-1",
    payload: '{"id":"env-1"}',
    workflowId: "",
    sourceEventId: "",
    status: "sent",
    createdAt: { seconds: NOON, nanos: 1 },
    updatedAt: { seconds: NOON, nanos: 2 },
    envelopeId: "",
    dispatchedAt: UNSET,
    playedAt: UNSET,
    completedAt: UNSET,
    error: "",
    version: 1n,
    ...overrides,
  };
}

describe("alertSnapshotFromRow", () => {
  test("leaves out every optional field the row does not hold, as the callbacks do", () => {
    expect(alertSnapshotFromRow(alertRow())).toEqual({
      id: "row-1",
      payload: '{"id":"env-1"}',
      workflowId: "",
      sourceEventId: "",
      status: "sent",
      version: 1,
      createdAt: "2026-10-20T12:00:00.000000001Z",
      updatedAt: "2026-10-20T12:00:00.000000002Z",
    });
  });

  test("carries a settled alert's lifecycle", () => {
    const snapshot = alertSnapshotFromRow(
      alertRow({
        workflowId: "run-1",
        status: "failed",
        envelopeId: "env-1",
        dispatchedAt: { seconds: NOON, nanos: 0 },
        playedAt: { seconds: NOON + 1n, nanos: 0 },
        completedAt: { seconds: NOON + 2n, nanos: 0 },
        error: "autoplay blocked",
        version: 3n,
      })
    );
    expect(snapshot).toMatchObject({
      workflowId: "run-1",
      status: "failed",
      envelopeId: "env-1",
      dispatchedAt: "2026-10-20T12:00:00.000000000Z",
      playedAt: "2026-10-20T12:00:01.000000000Z",
      completedAt: "2026-10-20T12:00:02.000000000Z",
      error: "autoplay blocked",
      version: 3,
    });
  });

  test("leaves out a version that is not one", () => {
    expect(alertSnapshotFromRow(alertRow({ version: 0n }))).not.toHaveProperty("version");
  });

  test("refuses a row without its creation time", () => {
    expect(() => alertSnapshotFromRow(alertRow({ createdAt: UNSET }))).toThrow("stored row row-1 has no createdAt");
  });
});

function runRow(overrides: Partial<workflow.WorkflowExecution> = {}): workflow.WorkflowExecution {
  return {
    id: "run-1",
    workflowId: "wf-1",
    status: "completed",
    startedBy: "",
    inputs: {},
    outputs: {},
    error: "",
    startedAt: { seconds: NOON, nanos: 0 },
    completedAt: { seconds: NOON + 5n, nanos: 0 },
    createdAt: { seconds: NOON, nanos: 0 },
    updatedAt: { seconds: NOON + 5n, nanos: 0 },
    steps: [],
    triggerEventJson: '{"type":"channel.raid"}',
    triggeredBy: "twitch",
    dryRun: false,
    ...overrides,
  };
}

describe("runSnapshotFromRow", () => {
  test("is the snapshot workflow.run.updated carries", () => {
    expect(runSnapshotFromRow(runRow())).toEqual({
      id: "run-1",
      workflowId: "wf-1",
      status: "completed",
      triggeredBy: "twitch",
      triggerEvent: '{"type":"channel.raid"}',
      startedAt: "2026-10-20T12:00:00.000000000Z",
      completedAt: "2026-10-20T12:00:05.000000000Z",
      createdAt: "2026-10-20T12:00:00.000000000Z",
      updatedAt: "2026-10-20T12:00:05.000000000Z",
    });
  });

  test("marks a dry run and carries its error", () => {
    expect(runSnapshotFromRow(runRow({ dryRun: true, status: "failed", error: "boom" }))).toMatchObject({
      dryRun: true,
      error: "boom",
    });
  });
});

function stepRow(overrides: Partial<workflow.ExecutionStep> = {}): workflow.ExecutionStep {
  return {
    stepId: "say-hi",
    name: "Say hi",
    status: "success",
    attempt: 2,
    error: "",
    startedAt: { seconds: NOON, nanos: 0 },
    completedAt: { seconds: NOON + 1n, nanos: 0 },
    durationMs: 1000n,
    inputsJson: '{"text":"hi"}',
    outputsJson: '{"sent":true}',
    stepIndex: 1,
    id: "step-1",
    createdAt: { seconds: NOON + 1n, nanos: 0 },
    updatedAt: { seconds: NOON + 1n, nanos: 0 },
    ...overrides,
  };
}

describe("stepSnapshotFromRow", () => {
  test("is the snapshot workflow.run.step.recorded carries", () => {
    expect(stepSnapshotFromRow("run-1", stepRow())).toEqual({
      id: "step-1",
      executionId: "run-1",
      taskId: "say-hi",
      name: "Say hi",
      status: "success",
      attempt: 2,
      stepIndex: 1,
      inputs: '{"text":"hi"}',
      outputs: '{"sent":true}',
      startedAt: "2026-10-20T12:00:00.000000000Z",
      completedAt: "2026-10-20T12:00:01.000000000Z",
      durationMs: 1000,
      createdAt: "2026-10-20T12:00:01.000000000Z",
      updatedAt: "2026-10-20T12:00:01.000000000Z",
    });
  });

  test("carries a failed step's error and leaves out what it never recorded", () => {
    const snapshot = stepSnapshotFromRow(
      "run-1",
      stepRow({ status: "failed", error: "timeout", outputsJson: "", completedAt: UNSET, durationMs: 0n })
    );
    expect(snapshot.error).toBe("timeout");
    expect(snapshot).not.toHaveProperty("outputs");
    expect(snapshot).not.toHaveProperty("completedAt");
    expect(snapshot).not.toHaveProperty("durationMs");
  });

  test("refuses a step without its row id", () => {
    expect(() => stepSnapshotFromRow("run-1", stepRow({ id: "" }))).toThrow("a step of run run-1 has no id");
  });
});

describe("rfc3339FromString", () => {
  const cases: Array<{ name: string; value: string; want: string }> = [
    { name: "whole seconds", value: "2026-10-20T12:00:00Z", want: "2026-10-20T12:00:00.000000000Z" },
    { name: "trimmed fraction", value: "2026-10-20T12:00:00.5Z", want: "2026-10-20T12:00:00.500000000Z" },
    { name: "nanosecond precision", value: "2026-10-20T12:00:00.123456789Z", want: "2026-10-20T12:00:00.123456789Z" },
    { name: "positive offset", value: "2026-10-20T14:00:00.25+02:00", want: "2026-10-20T12:00:00.250000000Z" },
    {
      name: "negative offset crossing midnight",
      value: "2026-10-19T20:30:00-04:00",
      want: "2026-10-20T00:30:00.000000000Z",
    },
  ];
  for (const { name, value, want } of cases) {
    test(name, () => {
      expect(rfc3339FromString(value)).toBe(want);
    });
  }

  for (const value of ["", "yesterday", "2026-10-20 12:00:00Z", "2026-10-20T12:00:00", "2026-13-40T12:00:00Z"]) {
    test(`refuses ${JSON.stringify(value)}`, () => {
      expect(() => rfc3339FromString(value)).toThrow("not an RFC 3339 timestamp");
    });
  }
});

describe("a stored row and its callback", () => {
  // The Go encoder writes the row's zone and trims trailing zeros; the same
  // instant must still reach clients as one string.
  test("give a run the same snapshot", () => {
    const stored = runSnapshotFromRow(runRow());
    const callback = parseRunRecorded({
      data: {
        id: "run-1",
        workflow_id: "wf-1",
        status: "completed",
        triggered_by: "twitch",
        trigger_event: '{"type":"channel.raid"}',
        started_at: "2026-10-20T14:00:00+02:00",
        completed_at: "2026-10-20T12:00:05Z",
        created_at: "2026-10-20T12:00:00Z",
        updated_at: "2026-10-20T12:00:05.0Z",
      },
    }).event?.run;

    expect(callback).toEqual(stored);
  });

  test("give a step the same snapshot", () => {
    const stored = stepSnapshotFromRow("run-1", stepRow());
    const callback = parseRunStepRecorded({
      data: {
        id: "step-1",
        execution_id: "run-1",
        task_id: "say-hi",
        name: "Say hi",
        status: "success",
        attempt: 2,
        step_index: 1,
        inputs: '{"text":"hi"}',
        outputs: '{"sent":true}',
        duration_ms: 1000,
        started_at: "2026-10-20T12:00:00Z",
        completed_at: "2026-10-20T12:00:01.000Z",
        created_at: "2026-10-20T12:00:01Z",
        updated_at: "2026-10-20T14:00:01+02:00",
      },
    }).event?.step;

    expect(callback).toEqual(stored);
  });
});
