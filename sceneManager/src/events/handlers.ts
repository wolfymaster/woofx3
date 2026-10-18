import type { Logger } from "@woofx3/common/runtime";
import type { DbClient } from "../db";

/**
 * Wire shape a widget's `status.report` (P1) arrives as after the
 * browser scene-manager forwards it (the `OverlayWidgetEvent` shape).
 */
export interface StatusReport {
  moduleId: string;
  instanceId: string;
  widgetCanonicalId?: string;
  key: string;
  value: unknown;
  occurredAt?: string;
}

/**
 * Every status report, including the built-in alert widget's, is a
 * uniform `widget_status` upsert with no per-key routing: queueing is
 * the browser's per-widget client-side policy (see
 * `public/scene-manager/event-queue.ts`), not something a status report
 * drives here.
 */
export async function handleStatusReport(db: DbClient, logger: Logger, report: StatusReport): Promise<void> {
  if (!report.instanceId || !report.key) {
    logger.warn("status report dropped — missing instanceId or key", { report });
    return;
  }
  try {
    await db.upsertWidgetStatus({
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
