import type {
  AlertCompletedEvent,
  AlertFailedEvent,
  AlertPlayingEvent,
  AlertRecordedEvent,
  AlertReplayedEvent,
  AlertSkippedEvent,
  AlertSnapshot,
  AlertTimedOutEvent,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { asString, pickFirst, readRow } from "./outbox";
import { subscribeProjections } from "./projection";
import type { WebhookClient } from "./webhook-client";

/** Union of every webhook event projected from `db.alert.updated.*`. */
export type AlertUpdatedEvent =
  | AlertPlayingEvent
  | AlertReplayedEvent
  | AlertCompletedEvent
  | AlertFailedEvent
  | AlertTimedOutEvent
  | AlertSkippedEvent;

// The db proxy publishes alert lifecycle events on
// `db.alert.{created,updated,deleted}`. Only `created` and `updated` are
// projected: `created` becomes `alert.recorded`, and each `updated` becomes
// the callback named for the row's new status (see UPDATED_EVENT_TYPES).
//
// The CloudEvent's `data` is the snake-cased map produced by
// `buildAlertChangeData` in `db/app/services/alert_service.go`. As
// with the workflow / scene parsers we accept Go's default
// capitalized field names too so a future shift to raw model
// marshaling stays compatible.

interface RawAlertRow {
  ID?: unknown;
  id?: unknown;
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
  Version?: unknown;
  version?: unknown;
  CreatedAt?: unknown;
  created_at?: unknown;
  UpdatedAt?: unknown;
  updated_at?: unknown;
}

/**
 * A timestamp in the layout the db proxy writes every alert timestamp in:
 * RFC 3339 in UTC with nine fractional digits.
 */
function formatAlertTimestamp(date: Date): string {
  return date.toISOString().replace(/\.(\d{3})Z$/, ".$1000000Z");
}

/** The row's version: a positive integer, or null when it is not one. */
function readVersion(row: RawAlertRow): number | null {
  const value = row.Version ?? row.version;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return null;
  }
  return value;
}

/**
 * The snapshot an outbox row carries, or null when it has no id to name the
 * alert.
 *
 * A row without a version is still sent, without one: during a rolling
 * deploy, a db proxy not yet upgraded and outbox rows written before the
 * upgrade publish none, and dropping them would lose the callback outright.
 * Receivers order such a snapshot by stage and `updatedAt`.
 */
function buildSnapshot(ce: Record<string, unknown>): AlertSnapshot | null {
  const row = readRow<RawAlertRow>(ce);
  const id = pickFirst(row.ID, row.id);
  if (id === "") {
    return null;
  }
  const version = readVersion(row);
  const now = formatAlertTimestamp(new Date());
  const envelopeId = pickFirst(row.EnvelopeID, row.envelope_id);
  const dispatchedAt = pickFirst(row.DispatchedAt, row.dispatched_at);
  const playedAt = pickFirst(row.PlayedAt, row.played_at);
  const completedAt = pickFirst(row.CompletedAt, row.completed_at);
  const errorMsg = pickFirst(row.Error, row.error);
  return {
    id,
    payload: pickFirst(row.Payload, row.payload),
    workflowId: pickFirst(row.WorkflowID, row.workflow_id),
    sourceEventId: pickFirst(row.SourceEventID, row.source_event_id),
    status: pickFirst(row.Status, row.status) || "sent",
    ...(version !== null ? { version } : {}),
    // Fields the row may lack are left out rather than sent empty.
    ...(envelopeId ? { envelopeId } : {}),
    ...(dispatchedAt ? { dispatchedAt } : {}),
    ...(playedAt ? { playedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(errorMsg ? { error: errorMsg } : {}),
    // Prefer the publisher-supplied timestamps — they reflect when
    // the engine actually persisted the row, not when this consumer
    // saw the message. Fall back to "now" only when the publisher
    // shape doesn't include them (ad-hoc replays).
    createdAt: pickFirst(row.CreatedAt, row.created_at) || now,
    updatedAt: pickFirst(row.UpdatedAt, row.updated_at) || now,
  };
}

export interface ParsedAlertChange<T> {
  clientId: string;
  event: T | null;
}

export function parseAlertCreated(ce: Record<string, unknown>): ParsedAlertChange<AlertRecordedEvent> {
  const clientId = asString(ce.client_id);
  const snapshot = buildSnapshot(ce);
  return {
    clientId,
    event: snapshot
      ? {
          type: EngineEventType.ALERT_RECORDED,
          alert: snapshot,
        }
      : null,
  };
}

/**
 * The callback for each status an alert row can move to. A status with no
 * entry (`sent`, the status a row is created with) has no update callback.
 *
 * `playing` is the in-progress signal: it tells a receiver the alert is on
 * screen, so one that is playing for a while is not mistaken for one the
 * engine lost. The db proxy publishes only lifecycle writes it applied, and
 * a row only moves forward, so a receiver hears `playing` once per alert.
 */
const UPDATED_EVENT_TYPES = {
  playing: EngineEventType.ALERT_PLAYING,
  replayed: EngineEventType.ALERT_REPLAYED,
  completed: EngineEventType.ALERT_COMPLETED,
  failed: EngineEventType.ALERT_FAILED,
  timed_out: EngineEventType.ALERT_TIMED_OUT,
  skipped: EngineEventType.ALERT_SKIPPED,
} as const satisfies Record<string, AlertUpdatedEvent["type"]>;

function isUpdatedStatus(status: string): status is keyof typeof UPDATED_EVENT_TYPES {
  return Object.hasOwn(UPDATED_EVENT_TYPES, status);
}

/**
 * Project a `db.alert.updated.*` outbox event to the webhook event named for
 * the row's new status (see UPDATED_EVENT_TYPES). Any other status parses to
 * null.
 */
export function parseAlertUpdated(ce: Record<string, unknown>): ParsedAlertChange<AlertUpdatedEvent> {
  const clientId = asString(ce.client_id);
  const snapshot = buildSnapshot(ce);
  if (!snapshot || !isUpdatedStatus(snapshot.status)) {
    return { clientId, event: null };
  }
  const event = { type: UPDATED_EVENT_TYPES[snapshot.status], alert: snapshot } as AlertUpdatedEvent;
  return { clientId, event };
}

/**
 * Initialise NATS subscriptions for the alert log outbox
 * (`db.alert.{created,updated}.*`) and project each onto webhook
 * callbacks, so the Convex alert-log page sees new rows in real time
 * without polling.
 */
export async function initAlertLogHandlers(
  nats: NATSClient,
  webhookClient: WebhookClient,
  logger: SharedLogger
): Promise<void> {
  await subscribeProjections({ nats, webhookClient, logger }, [
    {
      subject: "db.alert.created.*",
      name: "db.alert.created",
      parse: (ce) => {
        const { clientId, event } = parseAlertCreated(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.alert.updated.*",
      name: "db.alert.updated",
      // A status with no callback parses to null on purpose -- see
      // UPDATED_EVENT_TYPES.
      quietDrop: true,
      parse: (ce) => {
        const { clientId, event } = parseAlertUpdated(ce);
        return event ? { event, clientId } : null;
      },
    },
  ]);
}
