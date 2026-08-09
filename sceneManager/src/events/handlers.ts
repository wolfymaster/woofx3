import type { Logger } from "@woofx3/common/runtime";
import type { DbClient } from "../db";

/**
 * Wire shape a widget's `status.report` (P1) arrives as after the
 * browser scene-manager forwards it — same `OverlayWidgetEvent`
 * convention streamware used.
 */
export interface StatusReport {
  applicationId: string;
  moduleId: string;
  instanceId: string;
  widgetCanonicalId?: string;
  key: string;
  value: unknown;
  occurredAt?: string;
}

/**
 * Ported and thinned from streamware/src/events/handlers.ts: that
 * version dispatched by `key`/`instanceId` — `alert.lifecycle` +
 * `instanceId === "alert-overlay"` routed to `EventQueueManager`,
 * everything else to `db.upsertWidgetStatus`. `EventQueueManager` is
 * gone (queueing moved to the browser's per-widget client-side
 * policy — see `public/scene-manager/event-queue.ts`), and with it
 * the special case: every status report, including the built-in alert
 * widget's, is now a uniform `widget_status` upsert. No per-key
 * routing left.
 */
export async function handleStatusReport(db: DbClient, logger: Logger, report: StatusReport): Promise<void> {
  if (!report.instanceId || !report.key) {
    logger.warn("status report dropped — missing instanceId or key", { report });
    return;
  }
  try {
    await db.upsertWidgetStatus({
      applicationId: report.applicationId,
      moduleId: report.moduleId,
      instanceId: report.instanceId,
      widgetCanonicalId: report.widgetCanonicalId ?? "",
      key: report.key,
      value: JSON.stringify(report.value ?? null),
      occurredAt: report.occurredAt ?? "",
    });
  } catch (err) {
    logger.warn("upsertWidgetStatus failed", {
      instanceId: report.instanceId,
      key: report.key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
