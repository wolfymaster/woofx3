import type { ServerWebSocket } from "bun";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";

/**
 * Wire format for any overlay-originated widget event. Same shape
 * regardless of which WS path the event arrived on (alerts overlay
 * via `/ws/alerts`, scene overlay via `/ws/module-state`).
 */
export interface OverlayWidgetEvent {
  kind: "widget.event";
  moduleId: string;
  instanceId: string;
  widgetCanonicalId?: string;
  applicationId?: string;
  key: string;
  value: unknown;
  ts?: string;
}

/**
 * Decode an overlay-originated message and republish it to NATS as a
 * CloudEvent on `widget.event`. The orchestrator
 * (`streamware/src/widget-event-handlers.ts`) handles routing by
 * `data.key`. Drops malformed shapes with a single warning so a
 * misbehaving widget can't flood logs.
 *
 * Both `AlertBroadcaster` and `StorageBroadcaster` share this
 * helper — they have different push semantics (per-widget filtering
 * for module-state, raw fan-out for alerts) but the inbound channel
 * is identical.
 */
export function publishWidgetEvent(
  ws: ServerWebSocket<{ id: string }>,
  raw: string | Buffer,
  nats: NATSClient | null,
  logger: SharedLogger,
): void {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  let msg: Partial<OverlayWidgetEvent> & Record<string, unknown>;
  try {
    msg = JSON.parse(text);
  } catch (err) {
    logger.warn("Dropping malformed widget event", {
      clientId: ws.data.id,
      error: err instanceof Error ? err.message : String(err),
      preview: text.slice(0, 120),
    });
    return;
  }
  if (msg.kind !== "widget.event") {
    logger.debug("Ignoring overlay message with non-widget kind", {
      clientId: ws.data.id,
      kind: msg.kind,
    });
    return;
  }
  if (typeof msg.moduleId !== "string" || msg.moduleId === "") {
    logger.warn("widget.event: missing moduleId", { clientId: ws.data.id });
    return;
  }
  if (typeof msg.instanceId !== "string" || msg.instanceId === "") {
    logger.warn("widget.event: missing instanceId", { clientId: ws.data.id });
    return;
  }
  if (typeof msg.key !== "string" || msg.key === "") {
    logger.warn("widget.event: missing key", { clientId: ws.data.id });
    return;
  }

  const ts = typeof msg.ts === "string" ? msg.ts : new Date().toISOString();
  const envelope = {
    specversion: "1.0",
    id: crypto.randomUUID(),
    source: "streamware",
    type: "widget.event",
    time: ts,
    datacontenttype: "application/json",
    data: {
      applicationId: typeof msg.applicationId === "string" ? msg.applicationId : "",
      moduleId: msg.moduleId,
      instanceId: msg.instanceId,
      widgetCanonicalId: typeof msg.widgetCanonicalId === "string" ? msg.widgetCanonicalId : "",
      key: msg.key,
      value: msg.value,
      occurredAt: ts,
    },
  };

  if (!nats) {
    logger.warn("widget.event: NATS unavailable; dropping report", {
      moduleId: msg.moduleId,
      instanceId: msg.instanceId,
      key: msg.key,
    });
    return;
  }
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    void nats.publish("widget.event", bytes);
    logger.info("widget.event forwarded to NATS", {
      moduleId: msg.moduleId,
      instanceId: msg.instanceId,
      key: msg.key,
      clientId: ws.data.id,
    });
  } catch (err) {
    logger.error("widget.event: NATS publish failed", {
      moduleId: msg.moduleId,
      instanceId: msg.instanceId,
      key: msg.key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
