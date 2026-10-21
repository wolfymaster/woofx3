import type { AlertSnapshot, WorkflowRunSnapshot, WorkflowRunStepSnapshot } from "@woofx3/api/webhooks";
import type * as alert from "@woofx3/db/alert.pb";
import type * as workflow from "@woofx3/db/workflow.pb";

/**
 * Stored rows read back from db-proxy, in the snapshot shapes the engine's
 * callbacks carry. A client that reads history and one that follows the
 * callbacks see each row the same way, so it can merge both into one view.
 */

type Timestamp = { seconds?: bigint | number; nanos?: number } | undefined;

const MAX_NANOS = 999_999_999;

/**
 * A protobuf timestamp as RFC 3339 in UTC with nine fractional digits, the
 * layout every alert snapshot uses; undefined when the field is unset. An
 * unset field decodes as the epoch itself, which no row the engine writes
 * carries.
 */
export function rfc3339FromTimestamp(ts: Timestamp): string | undefined {
  const seconds = Number(ts?.seconds ?? 0);
  const nanos = ts?.nanos ?? 0;
  if (seconds === 0 && nanos === 0) {
    return undefined;
  }
  if (!Number.isSafeInteger(seconds) || !Number.isInteger(nanos) || nanos < 0 || nanos > MAX_NANOS) {
    throw new Error(`not a protobuf timestamp: ${seconds}s ${nanos}ns`);
  }
  const whole = new Date(seconds * 1000).toISOString().slice(0, "YYYY-MM-DDTHH:MM:SS".length);
  return `${whole}.${String(nanos).padStart(9, "0")}Z`;
}

/** A timestamp every stored row has; its absence means db-proxy sent a broken row. */
function requiredTimestamp(ts: Timestamp, field: string, rowId: string): string {
  const value = rfc3339FromTimestamp(ts);
  if (value === undefined) {
    throw new Error(`stored row ${rowId} has no ${field}`);
  }
  return value;
}

/** Copies the optional fields that hold a value, leaving out the empty ones. */
function present<T extends Record<string, string | undefined>>(fields: T): Partial<Record<keyof T, string>> {
  const out: Partial<Record<keyof T, string>> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value) {
      out[key as keyof T] = value;
    }
  }
  return out;
}

export function alertSnapshotFromRow(row: alert.Alert): AlertSnapshot {
  const version = Number(row.version ?? 0);
  return {
    id: row.id,
    payload: row.payload,
    workflowId: row.workflowId,
    sourceEventId: row.sourceEventId,
    status: row.status,
    ...(Number.isSafeInteger(version) && version >= 1 ? { version } : {}),
    ...present({
      envelopeId: row.envelopeId,
      dispatchedAt: rfc3339FromTimestamp(row.dispatchedAt),
      playedAt: rfc3339FromTimestamp(row.playedAt),
      completedAt: rfc3339FromTimestamp(row.completedAt),
      error: row.error,
    }),
    createdAt: requiredTimestamp(row.createdAt, "createdAt", row.id),
    updatedAt: requiredTimestamp(row.updatedAt, "updatedAt", row.id),
  };
}

export function runSnapshotFromRow(row: workflow.WorkflowExecution): WorkflowRunSnapshot {
  return {
    id: row.id,
    workflowId: row.workflowId,
    status: row.status,
    ...present({
      triggeredBy: row.triggeredBy,
      triggerEvent: row.triggerEventJson,
      error: row.error,
      startedAt: rfc3339FromTimestamp(row.startedAt),
      completedAt: rfc3339FromTimestamp(row.completedAt),
    }),
    ...(row.dryRun ? { dryRun: true } : {}),
    createdAt: requiredTimestamp(row.createdAt, "createdAt", row.id),
    updatedAt: requiredTimestamp(row.updatedAt, "updatedAt", row.id),
  };
}

export function stepSnapshotFromRow(executionId: string, row: workflow.ExecutionStep): WorkflowRunStepSnapshot {
  if (!row.id) {
    throw new Error(`a step of run ${executionId} has no id; db-proxy predates step ids`);
  }
  const durationMs = Number(row.durationMs ?? 0);
  return {
    id: row.id,
    executionId,
    taskId: row.stepId,
    status: row.status,
    attempt: row.attempt,
    stepIndex: row.stepIndex,
    ...present({
      name: row.name,
      inputs: row.inputsJson,
      outputs: row.outputsJson,
      error: row.error,
      startedAt: rfc3339FromTimestamp(row.startedAt),
      completedAt: rfc3339FromTimestamp(row.completedAt),
    }),
    ...(durationMs > 0 ? { durationMs } : {}),
    createdAt: requiredTimestamp(row.createdAt, "createdAt", row.id),
    updatedAt: requiredTimestamp(row.updatedAt, "updatedAt", row.id),
  };
}
