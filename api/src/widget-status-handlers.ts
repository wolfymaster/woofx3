import type { WidgetStatusChangedEvent } from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { WebhookClient } from "./webhook-client";

// db.widget_status.updated.{appId} — db proxy outbox event fired by
// widgetStatusService.publishChange whenever the streamware
// orchestrator upserts a widget_status row. Go's JSON marshaling means
// the row may arrive PascalCase or snake_case depending on which path
// produced it — accept both, same convention as the other *-event-
// handlers modules.

interface RawWidgetStatusRow {
  module_id?: unknown;
  ModuleID?: unknown;
  instance_id?: unknown;
  InstanceID?: unknown;
  key?: unknown;
  Key?: unknown;
  widget_canonical_id?: unknown;
  WidgetCanonicalID?: unknown;
  occurred_at?: unknown;
  OccurredAt?: unknown;
  value?: unknown;
  Value?: unknown;
  application_id?: unknown;
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

function readRow(ce: Record<string, unknown>): RawWidgetStatusRow {
  const data = ce.data;
  if (data && typeof data === "object") {
    return data as RawWidgetStatusRow;
  }
  return ce as RawWidgetStatusRow;
}

/**
 * The db proxy serialises `value` as a JSONB-stringified form.
 * Round-trip parse so the webhook payload carries the typed shape
 * consumers expect; fall back to the raw value when it isn't valid
 * JSON (or isn't a string at all).
 */
function parseValue(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw ?? null;
}

export function parseWidgetStatusUpdated(ce: Record<string, unknown>): WidgetStatusChangedEvent | null {
  const row = readRow(ce);
  const moduleId = pickFirst(row.module_id, row.ModuleID);
  const instanceId = pickFirst(row.instance_id, row.InstanceID);
  const key = pickFirst(row.key, row.Key);
  if (!moduleId || !instanceId || !key) {
    return null;
  }
  const applicationId = pickFirst(ce.application_id, row.application_id);
  if (!applicationId) {
    return null;
  }
  const widgetCanonicalId = pickFirst(row.widget_canonical_id, row.WidgetCanonicalID);
  const occurredAt = pickFirst(row.occurred_at, row.OccurredAt) || new Date().toISOString();

  const event: WidgetStatusChangedEvent = {
    type: EngineEventType.WIDGET_STATUS_CHANGED,
    applicationId,
    moduleId,
    instanceId,
    key,
    value: parseValue(row.value ?? row.Value),
    occurredAt,
  };
  if (widgetCanonicalId !== "") {
    event.widgetCanonicalId = widgetCanonicalId;
  }
  return event;
}

/**
 * Initialise the NATS subscription for the widget-status outbox
 * (`db.widget_status.updated.*`) and project it onto the
 * WIDGET_STATUS_CHANGED webhook — same boundary pattern as the alert /
 * module / scene / workflow projections.
 */
export async function initWidgetStatusHandlers(
  nats: NATSClient,
  webhookClient: WebhookClient,
  logger: SharedLogger
): Promise<void> {
  await nats.subscribe("db.widget_status.updated.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const event = parseWidgetStatusUpdated(ce);
      if (!event) {
        logger.warn("db.widget_status.updated: missing required fields; dropping");
        return;
      }
      await webhookClient.send(event);
      logger.info("widget status webhook dispatched", {
        applicationId: event.applicationId,
        moduleId: event.moduleId,
        instanceId: event.instanceId,
        key: event.key,
      });
    } catch (err) {
      logger.error("db.widget_status.updated: handler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  logger.info("Widget status NATS handler initialized");
}
