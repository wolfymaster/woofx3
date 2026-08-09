import type { Logger } from "@woofx3/common/runtime";
import type NATSClient from "@woofx3/nats/src/client";
import type { DbClient } from "./db";
import type { DeliveryStore } from "./events/delivery-store";
import { handleStatusReport } from "./events/handlers";
import { handleLegacySlobsCommand } from "./obs/commands";
import type Manager from "./obs/manager";
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
    const eventType = typeof raw.event?.type === "string" ? raw.event.type : "";
    if (!applicationId || !eventType) {
      logger.warn("ui.notify.alert: missing applicationId or event.type; dropping");
      return;
    }
    const parameters = (raw.parameters as Record<string, unknown> | undefined) ?? {};
    const value = { ...(raw.event?.data as Record<string, unknown> | undefined), parameters };
    await fanOutToConnectedScenes({ applicationId, type: eventType, key: eventType, value }, { host, deliveryStore, logger });
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
 * connection, load its live widget instances and match `type` against
 * each instance's `acceptedEvents`. Only scenes matching the event's
 * `applicationId` and with at least one matching instance get a
 * `recordEvent` call — no-op for everyone else, cheaply (no DB write
 * for a scene with nothing listening).
 */
async function fanOutToConnectedScenes(
  event: { applicationId: string; type: string; key: string; value: unknown },
  deps: { host: OverlayHost; deliveryStore: DeliveryStore; logger: Logger }
): Promise<void> {
  const { host, deliveryStore, logger } = deps;
  for (const sceneId of deliveryStore.connectedSceneIds()) {
    const state = await host.loadSceneById(sceneId);
    if (!state || state.applicationId !== event.applicationId) {
      continue;
    }
    const targetInstanceIds = state.instances
      .filter((instance) => instance.acceptedEvents.includes(event.type))
      .map((instance) => instance.id);
    if (targetInstanceIds.length === 0) {
      continue;
    }
    const eventId = await deliveryStore.recordEvent({
      sceneId,
      applicationId: event.applicationId,
      type: event.type,
      key: event.key,
      value: event.value,
      targetInstanceIds,
    });
    if (!eventId) {
      logger.warn("fanOutToConnectedScenes: recordEvent failed", { sceneId, type: event.type });
    }
  }
}
