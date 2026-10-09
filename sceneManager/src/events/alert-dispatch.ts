import type { Logger } from "@woofx3/common/runtime";
import {
  ALERT_EVENT_TYPE,
  type AlertDelivery,
  alertTarget,
  alertWidgetsNamed,
  parseAlertLayout,
} from "../scene/alert-layout";
import type { OverlayHost } from "../scene/scene-host";
import type { DeliveryStore } from "./delivery-store";

/** The `ui.notify.alert` envelope the workflow engine publishes and records. */
export interface AlertEnvelope {
  id?: unknown;
  /**
   * The alert log row the engine recorded for this play; see withAlertRowID in
   * workflow/actions.go. Published only, never part of the recorded envelope.
   */
  rowId?: unknown;
  parameters?: unknown;
  event?: { type?: unknown; source?: unknown; time?: unknown; data?: unknown };
}

/**
 * The alert row a lifecycle report concerns: `rowId` names it, and
 * `envelopeId` is the envelope it must carry. A report without a row id, from
 * a delivery that never learned it, moves the envelope's newest row instead,
 * which is a different play when an envelope's plays overlap.
 */
export interface AlertReportTarget {
  rowId: string;
  envelopeId: string;
}

/**
 * The slice of the db client alert bookkeeping needs. Declared structurally so
 * a caller — or a test — does not have to stand up the rest of the client. The
 * real `DbClient` satisfies it.
 */
export interface AlertLifecycleWriter {
  updateAlertLifecycle(req: { id: string; envelopeId: string; status: string; error: string }): Promise<unknown>;
}

/** Report `status` for an alert, against its row when the target names one. */
export function updateAlertLifecycle(
  db: AlertLifecycleWriter,
  target: AlertReportTarget,
  status: string,
  error: string
): Promise<unknown> {
  return db.updateAlertLifecycle({ id: target.rowId, envelopeId: target.envelopeId, status, error });
}

/**
 * The alerts a set of deliveries concerns, one target per play: an alert fans
 * out to every widget answering to its target, and each of those deliveries
 * names the same row. Deliveries of other event types are left out.
 */
export function alertReportTargets(
  deliveries: ReadonlyArray<{ type: string; key: string; value: unknown }>
): AlertReportTarget[] {
  const byRow = new Map<string, AlertReportTarget>();
  const byEnvelope = new Map<string, AlertReportTarget>();
  for (const delivery of deliveries) {
    if (delivery.type !== ALERT_EVENT_TYPE) {
      continue;
    }
    const rowId = alertRowIdOf(delivery.value);
    if (rowId) {
      byRow.set(rowId, { rowId, envelopeId: delivery.key });
    } else {
      byEnvelope.set(delivery.key, { rowId: "", envelopeId: delivery.key });
    }
  }
  return [...byRow.values(), ...byEnvelope.values()];
}

/** The row id an alert delivery carries, or "" when it carries none. */
function alertRowIdOf(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const rowId = (value as { rowId?: unknown }).rowId;
  return typeof rowId === "string" ? rowId : "";
}

export interface AlertDispatchDeps {
  db: AlertLifecycleWriter;
  host: Pick<OverlayHost, "loadWidgetCatalog" | "loadSceneById">;
  deliveryStore: Pick<DeliveryStore, "connectedSceneIds" | "recordEvent">;
  logger: Logger;
}

/** Where an alert went: queued on `scenes` running scenes, or refused with a reason. */
export type AlertDispatchOutcome = { ok: true; scenes: number } | { ok: false; reason: string };

/**
 * Validate an alert envelope and queue it on every running scene with an
 * alert widget of the name it targets. Both a workflow's alert and an
 * operator's replay arrive here, so a replay plays exactly as the original
 * would have. A refusal is recorded against the alert's row as well as
 * returned.
 */
export async function dispatchAlert(raw: AlertEnvelope, deps: AlertDispatchDeps): Promise<AlertDispatchOutcome> {
  const { db, host, logger } = deps;
  const alertId = typeof raw.id === "string" ? raw.id : "";
  if (!alertId) {
    logger.warn("ui.notify.alert: missing id; dropping");
    return { ok: false, reason: "the alert has no id" };
  }
  const target: AlertReportTarget = { rowId: typeof raw.rowId === "string" ? raw.rowId : "", envelopeId: alertId };
  const parameters =
    typeof raw.parameters === "object" && raw.parameters !== null ? (raw.parameters as Record<string, unknown>) : {};
  const parsed = parseAlertLayout(parameters.layout, await host.loadWidgetCatalog());
  if (!parsed.ok) {
    logger.warn("ui.notify.alert: unusable parameters.layout; dropping", { alertId, reason: parsed.reason });
    await reportAlertNotPlayed(db, logger, { target, reason: parsed.reason });
    return { ok: false, reason: parsed.reason };
  }
  if (parsed.rejected.length > 0) {
    logger.warn("ui.notify.alert: dropped layout widgets that cannot play in an alert", {
      alertId,
      rejected: parsed.rejected,
    });
  }
  if (parsed.layout.widgets.length === 0) {
    // An empty layout is nearly always the consequence of the rejections
    // above, so the reason carries them: "the layout contains no widgets" on
    // its own sends the operator back to look for what it already knows.
    const reason =
      parsed.rejected.length > 0
        ? `no widget in the layout can play in an alert: ${parsed.rejected.map((r) => r.reason).join("; ")}`
        : "the layout contains no widgets";
    logger.warn("ui.notify.alert: layout has no widgets to play; dropping", { alertId, reason });
    await reportAlertNotPlayed(db, logger, { target, reason });
    return { ok: false, reason };
  }
  const eventType = typeof raw.event?.type === "string" ? raw.event.type : "";
  const delivery: AlertDelivery = {
    alertId,
    ...(target.rowId ? { rowId: target.rowId } : {}),
    layout: parsed.layout,
    event: eventType ? { type: eventType, data: raw.event?.data ?? null } : null,
  };
  return fanOutAlert({ target: alertTarget(parameters), report: target, delivery }, deps);
}

/**
 * Record that an alert will not play, against the row the engine wrote as it
 * published.
 *
 * Reported rather than only logged because the operator who fired the alert is
 * not reading this service's log — and from the browser an alert that was
 * refused is indistinguishable from one that was never sent.
 *
 * Swallows its own failure at debug. The engine's row is best-effort, so an
 * alert published without one answers NOT_FOUND, which is the expected case and
 * not worth a warning; the refusal itself has already been logged by the
 * caller. Throwing here would kill the subscription over a bookkeeping miss.
 */
export async function reportAlertNotPlayed(
  db: AlertLifecycleWriter,
  logger: Logger,
  alert: { target: AlertReportTarget; reason: string }
): Promise<void> {
  try {
    await updateAlertLifecycle(db, alert.target, "failed", alert.reason);
  } catch (err) {
    logger.debug("ui.notify.alert: refusal not recorded", {
      alertId: alert.target.envelopeId,
      rowId: alert.target.rowId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Fan-out targeting: for every scene currently holding an open SSE
 * connection, deliver the alert to each alert widget answering to the
 * step's target name. Only running scenes are considered, which is what
 * makes a scene nobody has open behave as disabled. A scene with no alert
 * widget of that name gets no DB write.
 */
async function fanOutAlert(
  alert: { target: string; report: AlertReportTarget; delivery: AlertDelivery },
  deps: AlertDispatchDeps
): Promise<AlertDispatchOutcome> {
  const { db, host, deliveryStore, logger } = deps;
  const connectedSceneIds = deliveryStore.connectedSceneIds();
  let recorded = 0;
  for (const sceneId of connectedSceneIds) {
    const state = await host.loadSceneById(sceneId);
    if (!state) {
      continue;
    }
    const targetInstanceIds = alertWidgetsNamed(state.instances, alert.target).map((instance) => instance.id);
    if (targetInstanceIds.length === 0) {
      continue;
    }
    const eventId = await deliveryStore.recordEvent({
      sceneId,
      type: ALERT_EVENT_TYPE,
      key: alert.delivery.alertId,
      value: alert.delivery,
      targetInstanceIds,
    });
    if (!eventId) {
      logger.warn("fanOutAlert: recordEvent failed", { sceneId, alertId: alert.delivery.alertId });
      continue;
    }
    recorded += 1;
  }

  // An alert that reaches nothing looks, from the browser, identical to
  // one that was never published, and every step before this one
  // succeeded. Say so once, naming the target so a misspelled alert
  // widget name is easy to spot. Alert volume is low enough that one
  // line per undelivered alert is not spam.
  if (recorded === 0) {
    const reason = `no alert widget named ${JSON.stringify(alert.target)} on a running scene`;
    logger.warn("alert matched no alert widget on a running scene; nothing delivered", {
      target: alert.target,
      alertId: alert.delivery.alertId,
      connectedScenes: connectedSceneIds.length,
    });
    // Nothing was wrong with this alert — it was correct and nobody was
    // listening. Reported all the same, because "it didn't appear" is the
    // question being asked, and a misspelled target name looks identical to a
    // scene nobody opened.
    await reportAlertNotPlayed(db, logger, { target: alert.report, reason });
    return { ok: false, reason };
  }
  return { ok: true, scenes: recorded };
}
