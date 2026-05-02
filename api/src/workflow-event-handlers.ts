import type { WorkflowDefinition } from "@woofx3/api";
import type {
  WorkflowCreatedEvent,
  WorkflowDeletedEvent,
  WorkflowSnapshot,
  WorkflowUpdatedEvent,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";

// The db proxy publishes workflow lifecycle events on
// `db.workflow.{created,updated,deleted}.{appId}`. The CloudEvent's `data`
// is the raw `*models.WorkflowDefinition` GORM model, JSON-marshaled with
// Go's default field-name casing (`ID`, `Name`, `Steps`, `Trigger`,
// `ApplicationID`). The deleted payload is the smaller `{ "id": "..." }`
// shape produced by workflow_service.DeleteWorkflow. We accept both
// capitalized and lowercase / snake_case keys so a future normalization
// of the publisher payload (to match the snake_case used by module
// events) won't silently break this consumer.
interface RawWorkflowRow {
  ID?: unknown;
  id?: unknown;
  Name?: unknown;
  name?: unknown;
  ApplicationID?: unknown;
  application_id?: unknown;
  Steps?: unknown;
  steps?: unknown;
  steps_json?: unknown;
  Trigger?: unknown;
  trigger?: unknown;
  trigger_json?: unknown;
  Enabled?: unknown;
  enabled?: unknown;
  projection_key?: unknown;
  projectionKey?: unknown;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

function pickFirst(...values: unknown[]): string {
  for (const v of values) {
    const s = asString(v);
    if (s !== "") {
      return s;
    }
  }
  return "";
}

function readRow(ce: Record<string, unknown>): RawWorkflowRow {
  const data = ce.data;
  if (data && typeof data === "object") {
    return data as RawWorkflowRow;
  }
  return ce as RawWorkflowRow;
}

function parseJson<T>(raw: string, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function buildSnapshot(ce: Record<string, unknown>): WorkflowSnapshot | null {
  const row = readRow(ce);
  const id = pickFirst(row.ID, row.id);
  if (id === "") {
    return null;
  }
  const triggerRaw = pickFirst(row.Trigger, row.trigger, row.trigger_json);
  const trigger = parseJson<WorkflowDefinition["trigger"] | null>(triggerRaw, null);
  if (!trigger) {
    return null;
  }
  const stepsRaw = pickFirst(row.Steps, row.steps, row.steps_json);
  const tasks = parseJson<WorkflowDefinition["tasks"]>(stepsRaw, []);

  const definition: WorkflowDefinition = {
    id,
    name: pickFirst(row.Name, row.name),
    trigger,
    tasks,
  };

  // The persisted `workflow_definitions` row carries no createdAt /
  // updatedAt columns today, so we synthesize ISO timestamps here.
  // `enabled` is published in the event payload by
  // db/app/services/module_event_payload.go `buildWorkflowChangeData`;
  // when missing (older publishers) we default to false to match the
  // "inert on create" contract.
  const now = new Date().toISOString();
  const isEnabled = typeof row.Enabled === "boolean" ? row.Enabled : row.enabled === true;
  const snapshot: WorkflowSnapshot = {
    id,
    definition,
    isEnabled,
    createdAt: now,
    updatedAt: now,
  };
  const projectionKey = pickFirst(row.projection_key, row.projectionKey);
  if (projectionKey !== "") {
    snapshot.projectionKey = projectionKey;
  }
  return snapshot;
}

export interface ParsedWorkflowChange<T> {
  applicationId: string;
  clientId: string;
  event: T | null;
}

export function parseWorkflowCreated(
  ce: Record<string, unknown>
): ParsedWorkflowChange<WorkflowCreatedEvent> {
  const applicationId = asString(ce.application_id);
  const clientId = asString(ce.client_id);
  const snapshot = buildSnapshot(ce);
  return {
    applicationId,
    clientId,
    event: snapshot
      ? {
          type: EngineEventType.WORKFLOW_CREATED,
          applicationId,
          workflow: snapshot,
        }
      : null,
  };
}

export function parseWorkflowUpdated(
  ce: Record<string, unknown>
): ParsedWorkflowChange<WorkflowUpdatedEvent> {
  const applicationId = asString(ce.application_id);
  const clientId = asString(ce.client_id);
  const snapshot = buildSnapshot(ce);
  return {
    applicationId,
    clientId,
    event: snapshot
      ? {
          type: EngineEventType.WORKFLOW_UPDATED,
          applicationId,
          workflow: snapshot,
        }
      : null,
  };
}

export function parseWorkflowDeleted(
  ce: Record<string, unknown>
): ParsedWorkflowChange<WorkflowDeletedEvent> {
  const applicationId = asString(ce.application_id);
  const clientId = asString(ce.client_id);
  // workflow_service.DeleteWorkflow publishes `{ "id": <uuid> }` (plus
  // `projection_key` for module-installed workflows); fall back to the
  // CloudEvent `entity_id` extension if for any reason the data payload
  // is missing the id.
  const row = readRow(ce);
  const workflowId = pickFirst(row.ID, row.id, ce.entity_id);
  if (!workflowId) {
    return { applicationId, clientId, event: null };
  }
  const projectionKey = pickFirst(row.projection_key, row.projectionKey);
  const event: WorkflowDeletedEvent = {
    type: EngineEventType.WORKFLOW_DELETED,
    applicationId,
    workflowId,
  };
  if (projectionKey !== "") {
    event.projectionKey = projectionKey;
  }
  return { applicationId, clientId, event };
}
