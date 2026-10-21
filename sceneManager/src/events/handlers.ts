import type { Logger } from "@woofx3/common/runtime";
import type { DbClient } from "../db";

/**
 * Wire shape a widget's `status.report` (P1) arrives as after the
 * browser scene-manager forwards it.
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
 * Record a widget's status report. Every report, the built-in alert
 * widget's included, is a uniform `widget_status` upsert: queueing is the
 * browser's per-widget policy (`@woofx3/widget-host`'s `page/event-queue.ts`), so
 * no report is routed anywhere by its key.
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
