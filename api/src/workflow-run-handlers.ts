import type {
  WorkflowRunRecordedEvent,
  WorkflowRunSnapshot,
  WorkflowRunStepRecordedEvent,
  WorkflowRunStepSnapshot,
  WorkflowRunUpdatedEvent,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { asString, pickFirst, readRow } from "./outbox";
import { subscribeProjections } from "./projection";
import type { WebhookClient } from "./webhook-client";

// The db proxy publishes run history on
// `db.workflow_execution.{created,updated}.{appId}` and
// `db.workflow_execution_step.recorded.{appId}`. The `recorded` operation is
// not a typo for `created`: a step row is upserted, so a given report may have
// created the row or replaced one, and neither word describes it.
//
// As with the alert and scene parsers, both Go's capitalised field names and
// the snake_case JSON tags are accepted, so a change in how the outbox
// marshals a row does not silently stop the projection.

interface RawRunRow {
  ID?: unknown;
  id?: unknown;
  WorkflowID?: unknown;
  workflow_id?: unknown;
  ApplicationID?: unknown;
  application_id?: unknown;
  Status?: unknown;
  status?: unknown;
  TriggeredBy?: unknown;
  triggered_by?: unknown;
  TriggerEvent?: unknown;
  trigger_event?: unknown;
  Error?: unknown;
  error?: unknown;
  StartedAt?: unknown;
  started_at?: unknown;
  CompletedAt?: unknown;
  completed_at?: unknown;
  CreatedAt?: unknown;
  created_at?: unknown;
  UpdatedAt?: unknown;
  updated_at?: unknown;
}

interface RawStepRow {
  ID?: unknown;
  id?: unknown;
  ExecutionID?: unknown;
  execution_id?: unknown;
  ApplicationID?: unknown;
  application_id?: unknown;
  TaskID?: unknown;
  task_id?: unknown;
  Name?: unknown;
  name?: unknown;
  Status?: unknown;
  status?: unknown;
  Attempt?: unknown;
  attempt?: unknown;
  StepIndex?: unknown;
  step_index?: unknown;
  Inputs?: unknown;
  inputs?: unknown;
  Outputs?: unknown;
  outputs?: unknown;
  Error?: unknown;
  error?: unknown;
  StartedAt?: unknown;
  started_at?: unknown;
  CompletedAt?: unknown;
  completed_at?: unknown;
  DurationMs?: unknown;
  duration_ms?: unknown;
  CreatedAt?: unknown;
  created_at?: unknown;
  UpdatedAt?: unknown;
  updated_at?: unknown;
}

/** A field as a number, or undefined when absent or not numeric. */
function asNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function buildRunSnapshot(ce: Record<string, unknown>): WorkflowRunSnapshot | null {
  const row = readRow<RawRunRow>(ce);
  const id = pickFirst(row.ID, row.id);
  if (id === "") {
    return null;
  }

  const now = new Date().toISOString();
  const triggeredBy = pickFirst(row.TriggeredBy, row.triggered_by);
  const triggerEvent = pickFirst(row.TriggerEvent, row.trigger_event);
  const errorMsg = pickFirst(row.Error, row.error);
  const startedAt = pickFirst(row.StartedAt, row.started_at);
  const completedAt = pickFirst(row.CompletedAt, row.completed_at);

  return {
    id,
    workflowId: pickFirst(row.WorkflowID, row.workflow_id),
    applicationId: pickFirst(row.ApplicationID, row.application_id),
    status: pickFirst(row.Status, row.status) || "running",
    // Only emitted when present, so a row written by an older db proxy without
    // these columns still round-trips rather than gaining empty strings.
    ...(triggeredBy ? { triggeredBy } : {}),
    ...(triggerEvent ? { triggerEvent } : {}),
    ...(errorMsg ? { error: errorMsg } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    createdAt: pickFirst(row.CreatedAt, row.created_at) || now,
    updatedAt: pickFirst(row.UpdatedAt, row.updated_at) || now,
  };
}

function buildStepSnapshot(ce: Record<string, unknown>): WorkflowRunStepSnapshot | null {
  const row = readRow<RawStepRow>(ce);
  const id = pickFirst(row.ID, row.id);
  const executionId = pickFirst(row.ExecutionID, row.execution_id);
  const taskId = pickFirst(row.TaskID, row.task_id);
  // Without all three the step cannot be placed in a run, which makes it
  // useless to the timeline rather than merely incomplete.
  if (id === "" || executionId === "" || taskId === "") {
    return null;
  }

  const now = new Date().toISOString();
  const name = pickFirst(row.Name, row.name);
  const inputs = pickFirst(row.Inputs, row.inputs);
  const outputs = pickFirst(row.Outputs, row.outputs);
  const errorMsg = pickFirst(row.Error, row.error);
  const startedAt = pickFirst(row.StartedAt, row.started_at);
  const completedAt = pickFirst(row.CompletedAt, row.completed_at);
  const durationMs = asNumber(row.DurationMs, row.duration_ms);

  return {
    id,
    executionId,
    applicationId: pickFirst(row.ApplicationID, row.application_id),
    taskId,
    status: pickFirst(row.Status, row.status) || "running",
    // Defaulted rather than dropped: the column is NOT NULL with a positive
    // check, so a row that reached the database always has a real attempt.
    attempt: asNumber(row.Attempt, row.attempt) ?? 1,
    stepIndex: asNumber(row.StepIndex, row.step_index) ?? 0,
    ...(name ? { name } : {}),
    ...(inputs ? { inputs } : {}),
    ...(outputs ? { outputs } : {}),
    ...(errorMsg ? { error: errorMsg } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    createdAt: pickFirst(row.CreatedAt, row.created_at) || now,
    updatedAt: pickFirst(row.UpdatedAt, row.updated_at) || now,
  };
}

export interface ParsedRunChange<T> {
  applicationId: string;
  clientId: string;
  event: T | null;
}

export function parseRunRecorded(ce: Record<string, unknown>): ParsedRunChange<WorkflowRunRecordedEvent> {
  const applicationId = asString(ce.application_id);
  const clientId = asString(ce.client_id);
  const run = buildRunSnapshot(ce);
  return {
    applicationId,
    clientId,
    event: run ? { type: EngineEventType.WORKFLOW_RUN_RECORDED, applicationId, run } : null,
  };
}

export function parseRunUpdated(ce: Record<string, unknown>): ParsedRunChange<WorkflowRunUpdatedEvent> {
  const applicationId = asString(ce.application_id);
  const clientId = asString(ce.client_id);
  const run = buildRunSnapshot(ce);
  return {
    applicationId,
    clientId,
    event: run ? { type: EngineEventType.WORKFLOW_RUN_UPDATED, applicationId, run } : null,
  };
}

export function parseRunStepRecorded(ce: Record<string, unknown>): ParsedRunChange<WorkflowRunStepRecordedEvent> {
  const applicationId = asString(ce.application_id);
  const clientId = asString(ce.client_id);
  const step = buildStepSnapshot(ce);
  return {
    applicationId,
    clientId,
    event: step ? { type: EngineEventType.WORKFLOW_RUN_STEP_RECORDED, applicationId, step } : null,
  };
}

/**
 * Project the run-history outbox onto webhook callbacks, so the Alert History
 * timeline sees runs and their steps as they happen rather than by polling.
 *
 * Only runs the engine chose to record arrive here at all -- a run fired by
 * hand from the dashboard is never written, so it never reaches this path.
 */
export async function initWorkflowRunHandlers(
  nats: NATSClient,
  webhookClient: WebhookClient,
  logger: SharedLogger
): Promise<void> {
  await subscribeProjections({ nats, webhookClient, logger }, [
    {
      subject: "db.workflow_execution.created.*",
      name: "db.workflow_execution.created",
      parse: (ce) => {
        const { clientId, event } = parseRunRecorded(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.workflow_execution.updated.*",
      name: "db.workflow_execution.updated",
      parse: (ce) => {
        const { clientId, event } = parseRunUpdated(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.workflow_execution_step.recorded.*",
      name: "db.workflow_execution_step.recorded",
      parse: (ce) => {
        const { clientId, event } = parseRunStepRecorded(ce);
        return event ? { event, clientId } : null;
      },
    },
  ]);
}
