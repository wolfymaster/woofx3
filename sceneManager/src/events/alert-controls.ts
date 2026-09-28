import type { AlertClearResult, AlertReplayResult, AlertSkipResult } from "@woofx3/api";
import type { Logger } from "@woofx3/common/runtime";
import { ALERT_EVENT_TYPE } from "../scene/alert-layout";
import { type AlertDispatchDeps, type AlertEnvelope, type AlertLifecycleWriter, dispatchAlert } from "./alert-dispatch";
import type { DeliveryStore } from "./delivery-store";

/** Operator requests the api forwards; request/reply, answered by this service. */
export const ALERT_SKIP_SUBJECT = "widget.queue.skip";
export const ALERT_CLEAR_SUBJECT = "widget.queue.clear";
export const ALERT_REPLAY_SUBJECT = "widget.queue.replay";

export const NO_OVERLAY_OPEN = "no overlay is open";

export interface AlertQueueDeps {
  db: AlertLifecycleWriter;
  deliveryStore: Pick<DeliveryStore, "connectedSceneIds" | "openDeliveriesByInstance" | "cancel">;
  logger: Logger;
}

interface Cancellation {
  sceneId: string;
  instanceId: string;
  eventIds: string[];
  alertIds: string[];
}

/**
 * End the alert each alert widget on an open overlay is playing, and let the
 * next one start.
 *
 * An alert widget plays its deliveries one at a time in the order they were
 * recorded, so the oldest one still open is the one on screen. The page's
 * completion ack is batched for a quarter second, so a skip that lands in
 * that window after an alert ends names the alert that just ended, and the
 * next one keeps playing.
 */
export async function skipCurrentAlerts(deps: AlertQueueDeps): Promise<AlertSkipResult> {
  const plan = planCancellations(deps.deliveryStore, (open) => open.slice(0, 1));
  if (!plan) {
    return { ok: false, skipped: 0, reason: NO_OVERLAY_OPEN };
  }
  const skipped = await executeCancellations(plan, deps);
  deps.logger.info("alert queue: skipped the playing alert", { skipped });
  return { ok: true, skipped };
}

/**
 * Drop every alert waiting behind the one each alert widget is playing. The
 * playing alert is left alone: clearing a backlog mid-raid should not cut off
 * the alert the viewers are watching.
 */
export async function clearQueuedAlerts(deps: AlertQueueDeps): Promise<AlertClearResult> {
  const plan = planCancellations(deps.deliveryStore, (open) => open.slice(1));
  if (!plan) {
    return { ok: false, cleared: 0, reason: NO_OVERLAY_OPEN };
  }
  const cleared = await executeCancellations(plan, deps);
  deps.logger.info("alert queue: cleared waiting alerts", { cleared });
  return { ok: true, cleared };
}

/**
 * Decide what to cancel before cancelling anything, so the answer describes
 * one consistent moment rather than a queue that moved while it was being
 * walked. Null when no overlay is open.
 */
function planCancellations(
  store: AlertQueueDeps["deliveryStore"],
  pick: (open: Array<{ eventId: string; key: string }>) => Array<{ eventId: string; key: string }>
): Cancellation[] | null {
  const sceneIds = store.connectedSceneIds();
  if (sceneIds.length === 0) {
    return null;
  }
  const plan: Cancellation[] = [];
  for (const sceneId of sceneIds) {
    for (const [instanceId, open] of store.openDeliveriesByInstance(sceneId, ALERT_EVENT_TYPE)) {
      const chosen = pick(open);
      if (chosen.length === 0) {
        continue;
      }
      plan.push({
        sceneId,
        instanceId,
        eventIds: chosen.map((delivery) => delivery.eventId),
        alertIds: chosen.map((delivery) => delivery.key),
      });
    }
  }
  return plan;
}

/**
 * Cancel the planned deliveries and mark each alert `skipped`. Returns how
 * many distinct alerts that was: one alert plays on every alert widget of its
 * target name, and the operator asked about alerts, not widgets.
 */
async function executeCancellations(plan: Cancellation[], deps: AlertQueueDeps): Promise<number> {
  const alertIds = new Set<string>();
  for (const cancellation of plan) {
    await deps.deliveryStore.cancel(cancellation.sceneId, cancellation.instanceId, cancellation.eventIds);
    for (const alertId of cancellation.alertIds) {
      alertIds.add(alertId);
    }
  }
  for (const alertId of alertIds) {
    await reportAlertSkipped(deps.db, deps.logger, alertId);
  }
  return alertIds.size;
}

/**
 * Best-effort, like every lifecycle write here: the engine's alert row is
 * itself best-effort, so a missing one answers NOT_FOUND and is not a fault.
 */
async function reportAlertSkipped(db: AlertLifecycleWriter, logger: Logger, alertId: string): Promise<void> {
  try {
    await db.updateAlertLifecycle({ envelopeId: alertId, status: "skipped", error: "" });
  } catch (err) {
    logger.debug("alert queue: skip not recorded", {
      alertId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** The slice of the db client a replay needs. The real `DbClient` satisfies it. */
export interface AlertLogClient extends AlertLifecycleWriter {
  getAlert(req: { id: string }): Promise<{
    alert?: { id: string; payload: string; workflowId: string; sourceEventId: string } | null;
  }>;
  createAlert(req: {
    payload: string;
    workflowId: string;
    sourceEventId: string;
    envelopeId: string;
  }): Promise<unknown>;
  updateAlertStatus(req: { id: string; status: string }): Promise<unknown>;
}

export interface AlertReplayDeps extends Omit<AlertDispatchDeps, "db"> {
  db: AlertLogClient;
  newEnvelopeId?: () => string;
}

/**
 * Play a recorded alert again, through the same dispatch a workflow's alert
 * takes.
 *
 * The replay gets a fresh envelope id and a row of its own, written before the
 * dispatch for the reason the engine writes one before it publishes: a
 * refusal is recorded against that row. The original row is marked
 * `replayed` only once the replay has been queued somewhere.
 */
export async function replayAlert(alertRowId: string, deps: AlertReplayDeps): Promise<AlertReplayResult> {
  const { db, logger } = deps;
  if (!alertRowId) {
    return { ok: false, reason: "alert id is required" };
  }
  if (deps.deliveryStore.connectedSceneIds().length === 0) {
    return { ok: false, reason: NO_OVERLAY_OPEN };
  }

  let row: { id: string; payload: string; workflowId: string; sourceEventId: string };
  try {
    const response = await db.getAlert({ id: alertRowId });
    if (!response.alert || !response.alert.id) {
      return { ok: false, reason: `no alert with id ${alertRowId}` };
    }
    row = response.alert;
  } catch (err) {
    return {
      ok: false,
      reason: `alert ${alertRowId} could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let original: unknown;
  try {
    original = JSON.parse(row.payload);
  } catch {
    original = null;
  }
  if (typeof original !== "object" || original === null || Array.isArray(original)) {
    return { ok: false, reason: `alert ${alertRowId} has no stored envelope to replay` };
  }

  const envelopeId = (deps.newEnvelopeId ?? (() => crypto.randomUUID()))();
  const envelope: AlertEnvelope = { ...(original as AlertEnvelope), id: envelopeId };
  try {
    await db.createAlert({
      payload: JSON.stringify(envelope),
      workflowId: row.workflowId,
      sourceEventId: row.sourceEventId,
      envelopeId,
    });
  } catch (err) {
    logger.warn("alert replay: replay not recorded", {
      alertId: alertRowId,
      envelopeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const outcome = await dispatchAlert(envelope, deps);
  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason };
  }

  try {
    await db.updateAlertStatus({ id: alertRowId, status: "replayed" });
  } catch (err) {
    logger.warn("alert replay: original not marked replayed", {
      alertId: alertRowId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  logger.info("alert replayed", { alertId: alertRowId, envelopeId, scenes: outcome.scenes });
  return { ok: true, replayEnvelopeId: envelopeId };
}
