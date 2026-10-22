import {
  ALERT_LIST_DEFAULT_LIMIT,
  ALERT_LIST_MAX_LIMIT,
  type AlertClearResult,
  type AlertListPage,
  type AlertListQuery,
  type AlertOverview,
  type AlertQueueEntry,
  type AlertQueueState,
  type AlertReplayResult,
  type AlertSkipResult,
} from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { ALERT_UNCONFIRMED_AFTER_MS, buildAlertOverview, overviewWindow } from "../alert-overview";
import { alertSnapshotFromRow } from "../stored-snapshots";
import { routeModule } from "./context";
import { timestampFromDate } from "./helpers";

/**
 * Short enough that an operator pressing Skip mid-raid hears back while the
 * raid is still on.
 */
export const ALERT_QUEUE_TIMEOUT_MS = 5_000;

/**
 * A replay makes several db round trips before it answers. The scene manager
 * answers a repeated replay of the same alert within 30 s with the first one's
 * result (REPLAY_DEDUPE_MS in sceneManager/src/events/alert-controls.ts), and
 * this must stay below that so a retry after a timeout cannot play it twice.
 */
const ALERT_REPLAY_TIMEOUT_MS = 15_000;

/**
 * Carry one alert queue control to the scene manager and return its answer.
 *
 * The queues live in the overlays the scene manager streams to, so it is the
 * one that answers. One that does not answer is returned as a refusal rather
 * than thrown, so the caller can tell the operator why nothing happened.
 */
async function requestAlertControl<T extends { ok: boolean; reason?: string }>(
  nats: NATSClient | null,
  logger: SharedLogger,
  subject: string,
  body: Record<string, unknown>,
  unanswered: T,
  timeout: number,
  read: (reply: unknown) => T = readControlResult
): Promise<T> {
  if (!nats) {
    throw new Error("NATS client not available");
  }
  let data: Uint8Array;
  try {
    const reply = await nats.request(subject, new TextEncoder().encode(JSON.stringify(body)), {
      timeout,
    });
    data = reply.data;
  } catch (err) {
    const reason = `the scene manager did not answer: ${err instanceof Error ? err.message : String(err)}`;
    logger.warn("alert control unanswered", { subject, reason });
    return { ...unanswered, reason };
  }
  return read(JSON.parse(new TextDecoder().decode(data)));
}

/**
 * A control's answer, checked down to the envelope every control shares. The
 * result-specific counters are the scene manager's to get right; a reply that
 * is not even an `{ ok }` object is refused here.
 */
function readControlResult<T extends { ok: boolean; reason?: string }>(reply: unknown): T {
  if (typeof reply !== "object" || reply === null || typeof (reply as { ok?: unknown }).ok !== "boolean") {
    throw new Error("the scene manager answered an alert control with an unreadable reply");
  }
  return reply as T;
}

/** `query.limit` checked against ALERT_LIST_MAX_LIMIT; a value out of range is a caller bug, not a request to clamp. */
function listLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return ALERT_LIST_DEFAULT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > ALERT_LIST_MAX_LIMIT) {
    throw new Error(`limit must be a whole number from 1 to ${ALERT_LIST_MAX_LIMIT}`);
  }
  return limit;
}

function listOffset(offset: number | undefined): number {
  if (offset === undefined) {
    return 0;
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a whole number of 0 or more");
  }
  return offset;
}

function isQueueEntry(value: unknown): value is AlertQueueEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Partial<AlertQueueEntry>;
  return (
    typeof entry.alertId === "string" &&
    typeof entry.envelopeId === "string" &&
    (entry.startedAt === undefined || typeof entry.startedAt === "string")
  );
}

/**
 * The scene manager's answer to `widget.queue.state`. A request it failed to
 * handle is answered `{ ok: false, reason }` with no lists, the shape every
 * control shares, so a refusal is given empty lists here; anything else
 * without valid lists is an answer this api cannot read.
 */
function readQueueState(reply: unknown): AlertQueueState {
  const unreadable = () => new Error("the scene manager answered widget.queue.state with an unreadable queue");
  if (typeof reply !== "object" || reply === null) {
    throw unreadable();
  }
  const { ok, reason, playing, waiting } = reply as Record<string, unknown>;
  if (ok === false) {
    if (typeof reason !== "string") {
      throw unreadable();
    }
    return { ok: false, playing: [], waiting: [], reason };
  }
  if (ok !== true || !Array.isArray(playing) || !Array.isArray(waiting)) {
    throw unreadable();
  }
  if (!playing.every(isQueueEntry) || !waiting.every(isQueueEntry)) {
    throw unreadable();
  }
  return { ok: true, playing, waiting };
}

export const alertsRoutes = routeModule({
  async listAlerts(query: AlertListQuery = {}): Promise<AlertListPage> {
    const limit = listLimit(query.limit);
    const offset = listOffset(query.offset);
    const page = await this.db.listAlerts({ limit, offset, workflowId: query.workflowId ?? "" });
    return { alerts: page.alerts.map(alertSnapshotFromRow), totalCount: page.totalCount, limit, offset };
  },

  async getAlertOverview(hourStart: number, windowHours?: number): Promise<AlertOverview> {
    const { since, hours } = overviewWindow(hourStart, windowHours);
    const counted = await this.db.countAlertsByHour({
      since: timestampFromDate(new Date(since)),
      hours,
      unconfirmedBefore: timestampFromDate(new Date(this.clock() - ALERT_UNCONFIRMED_AFTER_MS)),
    });
    return buildAlertOverview(since, hours, counted);
  },

  async getAlertQueue(): Promise<AlertQueueState> {
    return requestAlertControl<AlertQueueState>(
      this.nats,
      this.logger,
      "widget.queue.state",
      {},
      { ok: false, playing: [], waiting: [] },
      ALERT_QUEUE_TIMEOUT_MS,
      readQueueState
    );
  },

  async replayAlert(id: string): Promise<AlertReplayResult> {
    if (!id) {
      throw new Error("alert id is required");
    }
    const result = await requestAlertControl<AlertReplayResult>(
      this.nats,
      this.logger,
      "widget.queue.replay",
      { id },
      { ok: false },
      ALERT_REPLAY_TIMEOUT_MS
    );
    if (!result.ok) {
      this.logger.warn("Replay refused", { id, reason: result.reason });
      return result;
    }
    this.logger.info("Alert replayed", { id, replayEnvelopeId: result.replayEnvelopeId });
    return result;
  },

  async skipCurrentAlert(): Promise<AlertSkipResult> {
    const result = await requestAlertControl<AlertSkipResult>(
      this.nats,
      this.logger,
      "widget.queue.skip",
      {},
      { ok: false, skipped: 0 },
      ALERT_QUEUE_TIMEOUT_MS
    );
    this.logger.info("skipCurrentAlert", { ok: result.ok, skipped: result.skipped, reason: result.reason });
    return result;
  },

  async clearAlertQueue(): Promise<AlertClearResult> {
    const result = await requestAlertControl<AlertClearResult>(
      this.nats,
      this.logger,
      "widget.queue.clear",
      {},
      { ok: false, cleared: 0 },
      ALERT_QUEUE_TIMEOUT_MS
    );
    this.logger.info("clearAlertQueue", { ok: result.ok, cleared: result.cleared, reason: result.reason });
    return result;
  },
});
