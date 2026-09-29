import type { AlertClearResult, AlertReplayResult, AlertSkipResult } from "@woofx3/api";
import type { Logger } from "@woofx3/common/runtime";
import { ALERT_EVENT_TYPE, ALERT_SURFACE } from "../scene/alert-layout";
import type { OverlayHost } from "../scene/scene-host";
import { type AlertDispatchDeps, type AlertEnvelope, type AlertLifecycleWriter, dispatchAlert } from "./alert-dispatch";
import type { DeliveryStore, OpenDeliveryRef } from "./delivery-store";

/** Operator requests the api forwards; request/reply, answered by this service. */
export const ALERT_SKIP_SUBJECT = "widget.queue.skip";
export const ALERT_CLEAR_SUBJECT = "widget.queue.clear";
export const ALERT_REPLAY_SUBJECT = "widget.queue.replay";

export const NO_OVERLAY_OPEN = "no overlay is open";

export interface AlertQueueDeps {
  db: AlertLifecycleWriter;
  host: Pick<OverlayHost, "loadSceneById">;
  deliveryStore: Pick<DeliveryStore, "connectedSceneIds" | "openDeliveriesByInstance" | "cancel">;
  logger: Logger;
}

interface Cancellation {
  sceneId: string;
  instanceId: string;
  eventIds: string[];
  alertIds: string[];
}

/** Chooses, from one alert widget's open deliveries (oldest first), which to cancel. */
type Chooser = (open: OpenDeliveryRef[]) => OpenDeliveryRef[];

/**
 * The alert on screen is the one a page most recently reported starting. An
 * earlier started delivery still open has finished on the page but its
 * completion ack has not landed yet, so it is not the one to skip.
 */
const playing: Chooser = (open) => {
  let latest: OpenDeliveryRef | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const delivery of open) {
    if (delivery.startedAt !== null && delivery.startedAt >= latestAt) {
      latest = delivery;
      latestAt = delivery.startedAt;
    }
  }
  return latest ? [latest] : [];
};

/** Waiting alerts: delivered to a page's queue but not reported started by any page. */
const waiting: Chooser = (open) => open.filter((delivery) => delivery.startedAt === null);

/**
 * End the alert each alert widget on an open overlay is playing, and let the
 * next one start.
 *
 * "Playing" is what the pages last reported: a page reports each alert when
 * it starts it and again when it finishes it, both unbatched. An alert
 * started so recently that its start report is still on the wire is not yet
 * seen as playing, and a skip in that moment ends nothing on that widget.
 */
export async function skipCurrentAlerts(deps: AlertQueueDeps): Promise<AlertSkipResult> {
  const alertWidgets = await loadAlertWidgets(deps);
  if (!alertWidgets) {
    return { ok: false, skipped: 0, reason: NO_OVERLAY_OPEN };
  }
  const skipped = await cancelAlerts(alertWidgets, playing, deps);
  deps.logger.info("alert queue: skipped the playing alert", { skipped });
  return { ok: true, skipped };
}

/**
 * Drop every alert waiting behind the one each alert widget is playing. The
 * playing alert is left alone: clearing a backlog mid-raid should not cut off
 * the alert the viewers are watching.
 */
export async function clearQueuedAlerts(deps: AlertQueueDeps): Promise<AlertClearResult> {
  const alertWidgets = await loadAlertWidgets(deps);
  if (!alertWidgets) {
    return { ok: false, cleared: 0, reason: NO_OVERLAY_OPEN };
  }
  const cleared = await cancelAlerts(alertWidgets, waiting, deps);
  deps.logger.info("alert queue: cleared waiting alerts", { cleared });
  return { ok: true, cleared };
}

/**
 * The alert widgets each open scene has now, by scene id; null when no
 * overlay is open.
 *
 * A delivery addressed to an instance the scene no longer has (removed in an
 * edit after it was recorded) waits for a widget no page registers, so it is
 * neither playing nor queued and is left out of both the cancel and the count.
 */
async function loadAlertWidgets(deps: AlertQueueDeps): Promise<Map<string, Set<string>> | null> {
  const sceneIds = deps.deliveryStore.connectedSceneIds();
  if (sceneIds.length === 0) {
    return null;
  }
  const alertWidgets = new Map<string, Set<string>>();
  for (const sceneId of sceneIds) {
    const state = await deps.host.loadSceneById(sceneId);
    const ids = (state?.instances ?? [])
      .filter((instance) => instance.hostsSurface === ALERT_SURFACE)
      .map((instance) => instance.id);
    alertWidgets.set(sceneId, new Set(ids));
  }
  return alertWidgets;
}

/**
 * Plan and apply the cancellations in one synchronous pass, then record them.
 *
 * NATS handlers run concurrently, so an operator pressing Skip twice sends two
 * requests that overlap. Nothing awaits between reading the open deliveries
 * and closing them, so the second request sees the first one's result and
 * never a queue that is half cancelled. The db writes then run together.
 *
 * Returns how many distinct alerts were cancelled: one alert plays on every
 * alert widget of its target name, and the operator asked about alerts, not
 * widgets.
 */
async function cancelAlerts(
  alertWidgets: Map<string, Set<string>>,
  choose: Chooser,
  deps: AlertQueueDeps
): Promise<number> {
  const plan: Cancellation[] = [];
  for (const [sceneId, instanceIds] of alertWidgets) {
    for (const [instanceId, open] of deps.deliveryStore.openDeliveriesByInstance(sceneId, ALERT_EVENT_TYPE)) {
      if (!instanceIds.has(instanceId)) {
        continue;
      }
      const chosen = choose(open);
      if (chosen.length > 0) {
        plan.push({
          sceneId,
          instanceId,
          eventIds: chosen.map((delivery) => delivery.eventId),
          alertIds: chosen.map((delivery) => delivery.key),
        });
      }
    }
  }

  const writes: Promise<void>[] = [];
  const alertIds = new Set<string>();
  for (const cancellation of plan) {
    writes.push(deps.deliveryStore.cancel(cancellation.sceneId, cancellation.instanceId, cancellation.eventIds));
    for (const alertId of cancellation.alertIds) {
      alertIds.add(alertId);
    }
  }
  for (const alertId of alertIds) {
    writes.push(reportAlertSkipped(deps.db, deps.logger, alertId));
  }
  await Promise.all(writes);
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
 * How long a successful replay of one alert answers a repeat request with its
 * own result. Longer than the api's replay timeout, so a caller that timed out
 * and asked again gets the replay already under way rather than a second one.
 * The cost: replaying the same alert twice on purpose needs this long between.
 */
export const REPLAY_DEDUPE_MS = 30_000;

interface ReplayEntry {
  result: Promise<AlertReplayResult>;
  settledAt: number | null;
}

/**
 * Replays, deduplicated per alert row. A request for a row with a replay in
 * flight, or one that succeeded within `REPLAY_DEDUPE_MS`, gets that replay's
 * answer and plays nothing. A refused replay is not remembered, so asking
 * again once an overlay is open works.
 */
export class AlertReplays {
  private readonly recent = new Map<string, ReplayEntry>();

  constructor(
    private readonly deps: AlertReplayDeps,
    private readonly now: () => number = Date.now
  ) {}

  replay(alertRowId: string): Promise<AlertReplayResult> {
    const now = this.now();
    for (const [id, entry] of this.recent) {
      if (entry.settledAt !== null && now - entry.settledAt >= REPLAY_DEDUPE_MS) {
        this.recent.delete(id);
      }
    }
    const existing = this.recent.get(alertRowId);
    if (existing) {
      return existing.result;
    }
    const entry: ReplayEntry = { result: replayAlert(alertRowId, this.deps), settledAt: null };
    this.recent.set(alertRowId, entry);
    entry.result.then(
      (result) => {
        if (result.ok) {
          entry.settledAt = this.now();
        } else {
          this.recent.delete(alertRowId);
        }
      },
      () => {
        this.recent.delete(alertRowId);
      }
    );
    return entry.result;
  }
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
