import type { Logger } from "@woofx3/common/runtime";
import type NATSClient from "@woofx3/nats/src/client";
import type { DbClient } from "./db";
import type { DeliveryStore } from "./events/delivery-store";
import { handleStatusReport } from "./events/handlers";
import { handleLegacySlobsCommand } from "./obs/commands";
import type Manager from "./obs/manager";
import {
  ALERT_EVENT_TYPE,
  type AlertDelivery,
  alertTarget,
  alertWidgetsNamed,
  parseAlertLayout,
} from "./scene/alert-layout";
import type { OverlayHost } from "./scene/scene-host";
import type { OverlayTokenResolver } from "./scene/token-resolver";

interface InitArgs {
  nats: NATSClient | null;
  obs: Manager | null;
  db: DbClient;
  host: OverlayHost;
  deliveryStore: DeliveryStore;
  resolver: OverlayTokenResolver;
  logger: Logger;
}

interface AlertEnvelope {
  id?: unknown;
  applicationId?: unknown;
  parameters?: unknown;
  event?: { type?: unknown; source?: unknown; time?: unknown; data?: unknown };
}

interface WidgetEventEnvelope {
  data?: {
    applicationId?: unknown;
    moduleId?: unknown;
    instanceId?: unknown;
    widgetCanonicalId?: unknown;
    key?: unknown;
    value?: unknown;
    occurredAt?: unknown;
  };
}

/**
 * Wire NATS-sourced engine events into `DeliveryStore`, invalidate
 * caches on control-plane pushes, and bridge the legacy OBS `slobs`
 * command subject. Simplified from streamware's
 * `nats-subscriptions.ts` + `events/handlers.ts`:
 *
 *   - No `ui.alert.broadcast` round trip — that subject existed only
 *     because streamware's own `EventQueueManager` re-published back
 *     to NATS after dispatch-timing decisions it no longer makes (the
 *     browser's per-widget queue does that now). This subscribes
 *     directly to `ui.notify.alert` (the original workflow-sourced
 *     subject) and hands off straight to `DeliveryStore.recordEvent`.
 *   - No `module.storage.*.changed` broadcaster — that was module
 *     persistent-storage sync, out of scope for this cutover (see
 *     widget-bridge.ts's header comment).
 *   - `widget.event`'s `alert.lifecycle`/`instanceId === "alert-overlay"`
 *     special case is gone — every status report is a uniform
 *     `db.upsertWidgetStatus`, including the built-in alert widget's.
 */
export async function initSubscriptions(args: InitArgs): Promise<void> {
  const { nats, obs, db, host, deliveryStore, resolver, logger } = args;

  if (!nats) {
    logger.warn("NATS unavailable — event subscriptions skipped (scenes will receive no live events)");
    return;
  }

  await nats.subscribe("ui.notify.alert", async (msg) => {
    let raw: AlertEnvelope;
    try {
      raw = msg.json<AlertEnvelope>();
    } catch (err) {
      logger.error("ui.notify.alert: malformed JSON payload", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const applicationId = typeof raw.applicationId === "string" ? raw.applicationId : "";
    const alertId = typeof raw.id === "string" ? raw.id : "";
    if (!applicationId || !alertId) {
      logger.warn("ui.notify.alert: missing applicationId or id; dropping");
      return;
    }
    const parameters =
      typeof raw.parameters === "object" && raw.parameters !== null ? (raw.parameters as Record<string, unknown>) : {};
    const parsed = parseAlertLayout(parameters.layout, await host.loadWidgetCatalog());
    if (!parsed) {
      logger.warn("ui.notify.alert: parameters.layout is missing or malformed; dropping", { alertId });
      return;
    }
    if (parsed.rejected.length > 0) {
      logger.warn("ui.notify.alert: dropped layout widgets that cannot play in an alert", {
        alertId,
        rejected: parsed.rejected,
      });
    }
    if (parsed.layout.widgets.length === 0) {
      logger.warn("ui.notify.alert: layout has no widgets to play; dropping", { alertId });
      return;
    }
    const eventType = typeof raw.event?.type === "string" ? raw.event.type : "";
    const delivery: AlertDelivery = {
      alertId,
      layout: parsed.layout,
      event: eventType ? { type: eventType, data: raw.event?.data ?? null } : null,
    };
    await fanOutAlert({ applicationId, target: alertTarget(parameters), delivery }, { host, deliveryStore, logger });
  });
  logger.info("Subscribed to ui.notify.alert");

  await nats.subscribe("widget.event", async (msg) => {
    let envelope: WidgetEventEnvelope;
    try {
      envelope = msg.json<WidgetEventEnvelope>();
    } catch (err) {
      logger.error("widget.event: malformed JSON envelope", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const data = envelope.data ?? {};
    const applicationId = typeof data.applicationId === "string" ? data.applicationId : "";
    const instanceId = typeof data.instanceId === "string" ? data.instanceId : "";
    const key = typeof data.key === "string" ? data.key : "";
    if (!applicationId || !instanceId || !key) {
      logger.warn("widget.event: missing required fields; dropping");
      return;
    }
    await handleStatusReport(db, logger, {
      applicationId,
      moduleId: typeof data.moduleId === "string" ? data.moduleId : "",
      instanceId,
      widgetCanonicalId: typeof data.widgetCanonicalId === "string" ? data.widgetCanonicalId : undefined,
      key,
      value: data.value,
      occurredAt: typeof data.occurredAt === "string" ? data.occurredAt : undefined,
    });
  });
  logger.info("Subscribed to widget.event");

  // Legacy slobs subject: kept temporarily so chat-bot scene/source
  // triggers don't break. Drop once everything moves to workflow actions.
  await nats.subscribe("slobs", (msg) => {
    let body: { command: string; args: Record<string, string> };
    try {
      body = msg.json();
    } catch (err) {
      logger.error("slobs: malformed JSON payload", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    handleLegacySlobsCommand(obs, body, logger).catch((err) => {
      logger.error("Legacy slobs command failed", {
        command: body.command,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
  logger.info("Subscribed to slobs (legacy OBS bridge)");

  await nats.subscribe("db.overlay_token.updated.*", () => {
    resolver.invalidateAll();
  });
  logger.info("Subscribed to db.overlay_token.updated.*");
}

/**
 * Fan-out targeting: for every scene currently holding an open SSE
 * connection, deliver the alert to each alert widget answering to the
 * step's target name. Only running scenes are considered, which is what
 * makes a scene nobody has open behave as disabled. A scene of another
 * application, or with no alert widget of that name, gets no DB write.
 */
async function fanOutAlert(
  alert: { applicationId: string; target: string; delivery: AlertDelivery },
  deps: { host: OverlayHost; deliveryStore: DeliveryStore; logger: Logger }
): Promise<void> {
  const { host, deliveryStore, logger } = deps;
  const connectedSceneIds = deliveryStore.connectedSceneIds();
  let recorded = 0;
  for (const sceneId of connectedSceneIds) {
    const state = await host.loadSceneById(sceneId);
    if (!state || state.applicationId !== alert.applicationId) {
      continue;
    }
    const targetInstanceIds = alertWidgetsNamed(state.instances, alert.target).map((instance) => instance.id);
    if (targetInstanceIds.length === 0) {
      continue;
    }
    const eventId = await deliveryStore.recordEvent({
      sceneId,
      applicationId: alert.applicationId,
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
    logger.warn("alert matched no alert widget on a running scene; nothing delivered", {
      target: alert.target,
      alertId: alert.delivery.alertId,
      applicationId: alert.applicationId,
      connectedScenes: connectedSceneIds.length,
    });
  }
}
