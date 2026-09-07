import type { WidgetStatusChangedEvent } from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { pickFirst, readRow } from "./outbox";
import { subscribeProjections } from "./projection";
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
  const row = readRow<RawWidgetStatusRow>(ce);
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
  await subscribeProjections({ nats, webhookClient, logger }, [
    {
      subject: "db.widget_status.updated.*",
      name: "db.widget_status.updated",
      parse: (ce) => {
        const event = parseWidgetStatusUpdated(ce);
        return event ? { event } : null;
      },
      context: (event) => {
        const status = event as WidgetStatusChangedEvent;
        return {
          applicationId: status.applicationId,
          moduleId: status.moduleId,
          instanceId: status.instanceId,
          key: status.key,
        };
      },
    },
  ]);
}
