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
import type { ModuleStateWatch } from "./scene/module-state";
import type { OverlayHost } from "./scene/scene-host";
import type { OverlayTokenResolver } from "./scene/token-resolver";

interface InitArgs {
  nats: NATSClient | null;
  obs: Manager | null;
  db: DbClient;
  host: OverlayHost;
  deliveryStore: DeliveryStore;
  moduleState: ModuleStateWatch;
  resolver: OverlayTokenResolver;
  logger: Logger;
}

interface AlertEnvelope {
  id?: unknown;
  parameters?: unknown;
  event?: { type?: unknown; source?: unknown; time?: unknown; data?: unknown };
}

interface StorageChangedEnvelope {
  data?: { moduleId?: unknown; key?: unknown; value?: unknown };
}

interface ResourceInstanceUpdatedEnvelope {
  data?: { canonical_id?: unknown };
}

interface WidgetEventEnvelope {
  data?: {
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
 *   - `module.storage.*.changed` is pushed only to scenes whose widgets
 *     asked for that key (see scene/module-state.ts), not broadcast.
 *   - `widget.event`'s `alert.lifecycle`/`instanceId === "alert-overlay"`
 *     special case is gone — every status report is a uniform
 *     `db.upsertWidgetStatus`, including the built-in alert widget's.
 */
export async function initSubscriptions(args: InitArgs): Promise<void> {
  const { nats, obs, db, host, deliveryStore, moduleState, resolver, logger } = args;

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
    const alertId = typeof raw.id === "string" ? raw.id : "";
    if (!alertId) {
      logger.warn("ui.notify.alert: missing id; dropping");
      return;
    }
    const parameters =
      typeof raw.parameters === "object" && raw.parameters !== null ? (raw.parameters as Record<string, unknown>) : {};
    const parsed = parseAlertLayout(parameters.layout, await host.loadWidgetCatalog());
    if (!parsed.ok) {
      logger.warn("ui.notify.alert: unusable parameters.layout; dropping", { alertId, reason: parsed.reason });
      await reportAlertNotPlayed(db, logger, { alertId, reason: parsed.reason });
      return;
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
      await reportAlertNotPlayed(db, logger, { alertId, reason });
      return;
    }
    const eventType = typeof raw.event?.type === "string" ? raw.event.type : "";
    const delivery: AlertDelivery = {
      alertId,
      layout: parsed.layout,
      event: eventType ? { type: eventType, data: raw.event?.data ?? null } : null,
    };
    await fanOutAlert({ target: alertTarget(parameters), delivery }, { db, host, deliveryStore, logger });
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
    const instanceId = typeof data.instanceId === "string" ? data.instanceId : "";
    const key = typeof data.key === "string" ? data.key : "";
    if (!instanceId || !key) {
      logger.warn("widget.event: missing required fields; dropping");
      return;
    }
    await handleStatusReport(db, logger, {
      moduleId: typeof data.moduleId === "string" ? data.moduleId : "",
      instanceId,
      widgetCanonicalId: typeof data.widgetCanonicalId === "string" ? data.widgetCanonicalId : undefined,
      key,
      value: data.value,
      occurredAt: typeof data.occurredAt === "string" ? data.occurredAt : undefined,
    });
  });
  logger.info("Subscribed to widget.event");

  // Published by barkloader on every module storage write, and by the api
  // with a null value for each session-scoped key a session end cleared.
  await nats.subscribe("module.storage.*.changed", async (msg) => {
    let envelope: StorageChangedEnvelope;
    try {
      envelope = msg.json<StorageChangedEnvelope>();
    } catch (err) {
      logger.error("module.storage.changed: malformed JSON envelope", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const data = envelope.data ?? {};
    const moduleId = typeof data.moduleId === "string" ? data.moduleId : "";
    const key = typeof data.key === "string" ? data.key : "";
    if (!moduleId || !key) {
      logger.warn("module.storage.changed: missing moduleId or key; dropping", { subject: msg.subject });
      return;
    }
    await moduleState.publish(moduleId, key, data.value ?? null);
  });
  logger.info("Subscribed to module.storage.*.changed");

  // A resource instance's settings can change what its value reads as (a
  // counter's goals) without its storage changing.
  await nats.subscribe("db.module.resource.instance.updated.*", async (msg) => {
    let envelope: ResourceInstanceUpdatedEnvelope;
    try {
      envelope = msg.json<ResourceInstanceUpdatedEnvelope>();
    } catch (err) {
      logger.error("db.module.resource.instance.updated: malformed JSON envelope", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const canonicalId = typeof envelope.data?.canonical_id === "string" ? envelope.data.canonical_id : "";
    if (!canonicalId) {
      return;
    }
    await moduleState.resourceUpdated(canonicalId);
  });
  logger.info("Subscribed to db.module.resource.instance.updated.*");

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
 * The slice of the db client `reportAlertNotPlayed` needs. Declared
 * structurally so a caller — or a test — does not have to stand up the other
 * fourteen methods to report one outcome. The real `DbClient` satisfies it.
 */
interface AlertLifecycleWriter {
  updateAlertLifecycle(req: { envelopeId: string; status: string; error: string }): Promise<unknown>;
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
  alert: { alertId: string; reason: string }
): Promise<void> {
  try {
    await db.updateAlertLifecycle({
      envelopeId: alert.alertId,
      status: "failed",
      error: alert.reason,
    });
  } catch (err) {
    logger.debug("ui.notify.alert: refusal not recorded", {
      alertId: alert.alertId,
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
  alert: { target: string; delivery: AlertDelivery },
  deps: { db: DbClient; host: OverlayHost; deliveryStore: DeliveryStore; logger: Logger }
): Promise<void> {
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
    await reportAlertNotPlayed(db, logger, { alertId: alert.delivery.alertId, reason });
  }
}
