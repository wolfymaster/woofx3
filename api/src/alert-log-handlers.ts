import type {
  AlertRecordedEvent,
  AlertReplayedEvent,
  AlertSnapshot,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";

// The db proxy publishes alert lifecycle events on
// `db.alert.{created,updated,deleted}.{appId}`. We only project the
// `created` and `updated` flavors today — `created` becomes
// `alert.recorded`, and `updated` (with `status: "replayed"`) becomes
// `alert.replayed`. Other status changes don't produce a webhook
// today; they can be added when the contract grows.
//
// The CloudEvent's `data` is the snake-cased map produced by
// `buildAlertChangeData` in `db/app/services/alert_service.go`. As
// with the workflow / scene parsers we accept Go's default
// capitalized field names too so a future shift to raw model
// marshaling stays compatible.

interface RawAlertRow {
  ID?: unknown;
  id?: unknown;
  ApplicationID?: unknown;
  application_id?: unknown;
  Payload?: unknown;
  payload?: unknown;
  WorkflowID?: unknown;
  workflow_id?: unknown;
  SourceEventID?: unknown;
  source_event_id?: unknown;
  Status?: unknown;
  status?: unknown;
  CreatedAt?: unknown;
  created_at?: unknown;
  UpdatedAt?: unknown;
  updated_at?: unknown;
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

function readRow(ce: Record<string, unknown>): RawAlertRow {
  const data = ce.data;
  if (data && typeof data === "object") {
    return data as RawAlertRow;
  }
  return ce as RawAlertRow;
}

function buildSnapshot(ce: Record<string, unknown>): AlertSnapshot | null {
  const row = readRow(ce);
  const id = pickFirst(row.ID, row.id);
  if (id === "") {
    return null;
  }
  const now = new Date().toISOString();
  return {
    id,
    applicationId: pickFirst(row.ApplicationID, row.application_id),
    payload: pickFirst(row.Payload, row.payload),
    workflowId: pickFirst(row.WorkflowID, row.workflow_id),
    sourceEventId: pickFirst(row.SourceEventID, row.source_event_id),
    status: pickFirst(row.Status, row.status) || "sent",
    // Prefer the publisher-supplied timestamps — they reflect when
    // the engine actually persisted the row, not when this consumer
    // saw the message. Fall back to "now" only when the publisher
    // shape doesn't include them (older publishers, ad-hoc replays).
    createdAt: pickFirst(row.CreatedAt, row.created_at) || now,
    updatedAt: pickFirst(row.UpdatedAt, row.updated_at) || now,
  };
}

export interface ParsedAlertChange<T> {
  applicationId: string;
  clientId: string;
  event: T | null;
}

export function parseAlertCreated(
  ce: Record<string, unknown>
): ParsedAlertChange<AlertRecordedEvent> {
  const applicationId = asString(ce.application_id);
  const clientId = asString(ce.client_id);
  const snapshot = buildSnapshot(ce);
  return {
    applicationId,
    clientId,
    event: snapshot
      ? {
          type: EngineEventType.ALERT_RECORDED,
          applicationId,
          alert: snapshot,
        }
      : null,
  };
}

/**
 * Project a `db.alert.updated.*` outbox event to an `ALERT_REPLAYED`
 * webhook — but only when the row's new status is `"replayed"`.
 * Other status transitions (e.g. a future `failed` flavor) don't
 * have a UI surface today, so we drop them.
 */
export function parseAlertUpdated(
  ce: Record<string, unknown>
): ParsedAlertChange<AlertReplayedEvent> {
  const applicationId = asString(ce.application_id);
  const clientId = asString(ce.client_id);
  const snapshot = buildSnapshot(ce);
  if (!snapshot || snapshot.status !== "replayed") {
    return { applicationId, clientId, event: null };
  }
  return {
    applicationId,
    clientId,
    event: {
      type: EngineEventType.ALERT_REPLAYED,
      applicationId,
      alert: snapshot,
    },
  };
}
