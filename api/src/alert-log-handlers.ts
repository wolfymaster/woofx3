import type {
  AlertCompletedEvent,
  AlertFailedEvent,
  AlertRecordedEvent,
  AlertReplayedEvent,
  AlertSkippedEvent,
  AlertSnapshot,
  AlertTimedOutEvent,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";

/** Union of every webhook event projected from `db.alert.updated.*`. */
export type AlertUpdatedEvent =
  | AlertReplayedEvent
  | AlertCompletedEvent
  | AlertFailedEvent
  | AlertTimedOutEvent
  | AlertSkippedEvent;

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
  EnvelopeID?: unknown;
  envelope_id?: unknown;
  DispatchedAt?: unknown;
  dispatched_at?: unknown;
  PlayedAt?: unknown;
  played_at?: unknown;
  CompletedAt?: unknown;
  completed_at?: unknown;
  Error?: unknown;
  error?: unknown;
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
  const envelopeId = pickFirst(row.EnvelopeID, row.envelope_id);
  const dispatchedAt = pickFirst(row.DispatchedAt, row.dispatched_at);
  const playedAt = pickFirst(row.PlayedAt, row.played_at);
  const completedAt = pickFirst(row.CompletedAt, row.completed_at);
  const errorMsg = pickFirst(row.Error, row.error);
  return {
    id,
    applicationId: pickFirst(row.ApplicationID, row.application_id),
    payload: pickFirst(row.Payload, row.payload),
    workflowId: pickFirst(row.WorkflowID, row.workflow_id),
    sourceEventId: pickFirst(row.SourceEventID, row.source_event_id),
    status: pickFirst(row.Status, row.status) || "sent",
    // Optional lifecycle fields — only emit when the publisher
    // supplied them, so an older db proxy without these columns
    // continues to round-trip cleanly.
    ...(envelopeId ? { envelopeId } : {}),
    ...(dispatchedAt ? { dispatchedAt } : {}),
    ...(playedAt ? { playedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(errorMsg ? { error: errorMsg } : {}),
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
 * Project a `db.alert.updated.*` outbox event to a webhook event.
 * Maps the new lifecycle column to the right callback type:
 *   - "replayed"  → ALERT_REPLAYED
 *   - "completed" → ALERT_COMPLETED   (overlay finished playing)
 *   - "failed"    → ALERT_FAILED      (overlay reported an error)
 * Other transitions (`"playing"` notably) intentionally produce
 * no webhook today — they're observable via the alert-log row's
 * `status` + `playedAt` columns and emitting per-mount adds noise
 * without enabling a dashboard surface. Phase 3 may revisit when
 * the operator UI wants live "currently playing" highlights.
 */
export function parseAlertUpdated(
  ce: Record<string, unknown>
): ParsedAlertChange<AlertUpdatedEvent> {
  const applicationId = asString(ce.application_id);
  const clientId = asString(ce.client_id);
  const snapshot = buildSnapshot(ce);
  if (!snapshot) {
    return { applicationId, clientId, event: null };
  }
  let event: AlertUpdatedEvent | null = null;
  switch (snapshot.status) {
    case "replayed":
      event = { type: EngineEventType.ALERT_REPLAYED, applicationId, alert: snapshot };
      break;
    case "completed":
      event = { type: EngineEventType.ALERT_COMPLETED, applicationId, alert: snapshot };
      break;
    case "failed":
      event = { type: EngineEventType.ALERT_FAILED, applicationId, alert: snapshot };
      break;
    case "timed_out":
      event = { type: EngineEventType.ALERT_TIMED_OUT, applicationId, alert: snapshot };
      break;
    case "skipped":
      event = { type: EngineEventType.ALERT_SKIPPED, applicationId, alert: snapshot };
      break;
  }
  return { applicationId, clientId, event };
}
