import { describe, expect, test } from "bun:test";
import type * as alert from "@woofx3/db/alert.pb";
import type * as workflow from "@woofx3/db/workflow.pb";
import {
  alertSnapshotFromRow,
  rfc3339FromTimestamp,
  runSnapshotFromRow,
  stepSnapshotFromRow,
} from "../src/stored-snapshots";

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
