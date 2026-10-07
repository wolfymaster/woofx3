import { OBS_STATUS_SUBJECT } from "@woofx3/common/cloudevents/Obs/commands";
import { RELAY_CONFIG_UPDATED_SUBJECT } from "@woofx3/common/cloudevents/Relay/relay";
import type { Logger } from "@woofx3/common/runtime";
import type NATSClient from "@woofx3/nats/src/client";
import type { DbClient } from "./db";
import {
  ALERT_CLEAR_SUBJECT,
  ALERT_REPLAY_SUBJECT,
  ALERT_SKIP_SUBJECT,
  AlertReplays,
  clearQueuedAlerts,
  skipCurrentAlerts,
} from "./events/alert-controls";
import { type AlertEnvelope, dispatchAlert } from "./events/alert-dispatch";
import type { DeliveryStore } from "./events/delivery-store";
import { handleStatusReport } from "./events/handlers";
import { handleLegacySlobsCommand } from "./obs/commands";
import { answerObsCommand } from "./obs/control";
import type Manager from "./obs/manager";
import { answerObsOptions } from "./obs/options";
import { OBS_MODULE_ID } from "./obs/settings";
import type { ObsStatusReply } from "./obs/status";
import type { ModuleStateWatch } from "./scene/module-state";
import type { OverlayHost } from "./scene/scene-host";
import type { OverlayTokenResolver } from "./scene/token-resolver";

interface InitArgs {
  nats: NATSClient | null;
  /** The live OBS session, re-read per message: it comes and goes as OBS does. */
  obs: { current(): Manager | null; recycle(reason: string): void; reconnectNow(reason: string): void };
  /** The OBS connection's state for `engine.obs.status`; see obs/status.ts. */
  obsStatus: () => ObsStatusReply;
  /** Whether the stored relay configuration moves OBS off the route its latest attempt took. */
  relayConfigMovesObs: () => Promise<boolean>;
  db: DbClient;
  host: OverlayHost;
  deliveryStore: DeliveryStore;
  moduleState: ModuleStateWatch;
  resolver: OverlayTokenResolver;
  logger: Logger;
}

interface StorageChangedEnvelope {
  data?: { moduleId?: unknown; key?: unknown; value?: unknown };
}

interface ModuleSettingUpdatedEnvelope {
  data?: { moduleId?: unknown };
}

interface SceneUpdatedEnvelope {
  data?: { id?: unknown };
}

/** SSE event name telling a scene's open overlays their config is stale. */
export const SCENE_UPDATED_EVENT = "scene-updated";

/** The slice of `DeliveryStore` a scene-updated push needs. */
interface SceneBroadcaster {
  broadcast(sceneId: string, event: string, data: unknown): void;
}

/**
 * Tell every overlay open on a scene that its saved config changed.
 *
 * The shell bakes the scene config into the page when it loads, so an
 * overlay open in OBS keeps rendering the old layout until it reloads.
 * Pushing the change down the stream it already holds is what lets a
 * save in the dashboard reach OBS without anyone pressing refresh.
 * Returns the scene id it notified, or null for an envelope with none.
 */
export function notifySceneUpdated(scenes: SceneBroadcaster, envelope: SceneUpdatedEnvelope): string | null {
  const sceneId = typeof envelope.data?.id === "string" ? envelope.data.id : "";
  if (!sceneId) {
    return null;
  }
  scenes.broadcast(sceneId, SCENE_UPDATED_EVENT, { sceneId });
  return sceneId;
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
 *   - The operator's alert queue controls (`widget.queue.skip`, `.clear`,
 *     `.replay`) are answered here, because the queues they act on live in
 *     the overlays this service streams to (see events/alert-controls.ts).
 *   - `module.storage.*.changed` is pushed only to scenes whose widgets
 *     asked for that key (see scene/module-state.ts), not broadcast.
 *   - `widget.event`'s `alert.lifecycle`/`instanceId === "alert-overlay"`
 *     special case is gone — every status report is a uniform
 *     `db.upsertWidgetStatus`, including the built-in alert widget's.
 */
export async function initSubscriptions(args: InitArgs): Promise<void> {
  const { nats, obs, obsStatus, relayConfigMovesObs, db, host, deliveryStore, moduleState, resolver, logger } = args;

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
    await dispatchAlert(raw, { db, host, deliveryStore, logger });
  });
  logger.info("Subscribed to ui.notify.alert");

  // Only the api's requests are acted on. A plain publish has no one to
  // answer and is not how the api asks, so it is dropped: workflows can
  // publish events, and none of them gets to skip, clear or replay alerts.
  const answer = (subject: string, run: (body: Record<string, unknown>) => Promise<unknown>) =>
    nats.subscribe(subject, async (msg) => {
      if (!msg.reply) {
        logger.warn(`${subject}: not a request; ignored`);
        return;
      }
      let body: Record<string, unknown> = {};
      try {
        const parsed = msg.json<unknown>();
        if (typeof parsed === "object" && parsed !== null) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        // An empty or malformed body is an empty request; each control
        // validates the fields it needs.
      }
      let reply: unknown;
      try {
        reply = await run(body);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.error(`${subject}: request failed`, { error: reason });
        reply = { ok: false, reason };
      }
      msg.respond(new TextEncoder().encode(JSON.stringify(reply)));
    });

  const replays = new AlertReplays({ db, host, deliveryStore, logger });
  await answer(ALERT_SKIP_SUBJECT, () => skipCurrentAlerts({ db, host, deliveryStore, logger }));
  await answer(ALERT_CLEAR_SUBJECT, () => clearQueuedAlerts({ db, host, deliveryStore, logger }));
  await answer(ALERT_REPLAY_SUBJECT, (body) => replays.replay(typeof body.id === "string" ? body.id : ""));
  logger.info("Answering widget.queue.{skip,clear,replay}");

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
    handleLegacySlobsCommand(obs.current(), body, logger).catch((err) => {
      logger.error("Legacy slobs command failed", {
        command: body.command,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
  logger.info("Subscribed to slobs (legacy OBS bridge)");

  // Engine OBS control, request/reply: barkloader's `ctx.obs` waits on this
  // answer to succeed or fail.
  await nats.subscribe("engine.obs.command", (msg) => answerObsCommand(obs, msg, logger));
  logger.info("Subscribed to engine.obs.command");

  // OBS names for `ctx.obs.listScenes` / `listSources` / `listInputs`,
  // request/reply.
  await nats.subscribe("engine.obs.options", (msg) => answerObsOptions(obs, msg, logger));
  logger.info("Subscribed to engine.obs.options");

  // Answered from the connection's own state, so it replies at once whether
  // or not OBS is up; the api asks it for the OBS module's page.
  await answer(OBS_STATUS_SUBJECT, async () => obsStatus());
  logger.info(`Answering ${OBS_STATUS_SUBJECT}`);

  // db-proxy announces every module setting write, naming the setting but
  // never its value. A change to the OBS module's connection reconnects with
  // the new details (obs/settings.ts reads them on each attempt).
  await nats.subscribe("db.module.setting.updated.*", (msg) => {
    let envelope: ModuleSettingUpdatedEnvelope;
    try {
      envelope = msg.json<ModuleSettingUpdatedEnvelope>();
    } catch (err) {
      logger.error("db.module.setting.updated: malformed JSON envelope", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (envelope.data?.moduleId === OBS_MODULE_ID) {
      obs.reconnectNow("OBS module settings changed");
    }
  });
  logger.info("Subscribed to db.module.setting.updated.*");

  // The api announces a change to which local endpoints go through the
  // companion. OBS's open session is replaced only when the change moves it to
  // another route; one that cannot be read is assumed to.
  await nats.subscribe(RELAY_CONFIG_UPDATED_SUBJECT, async () => {
    const moves = await relayConfigMovesObs().catch(() => true);
    if (moves) {
      obs.reconnectNow("Relay configuration changed");
    }
  });
  logger.info(`Subscribed to ${RELAY_CONFIG_UPDATED_SUBJECT}`);

  await nats.subscribe("db.scene.updated.*", (msg) => {
    let envelope: SceneUpdatedEnvelope;
    try {
      envelope = msg.json<SceneUpdatedEnvelope>();
    } catch (err) {
      logger.error("db.scene.updated: malformed JSON envelope", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!notifySceneUpdated(deliveryStore, envelope)) {
      logger.warn("db.scene.updated: missing scene id; dropping", { subject: msg.subject });
    }
  });
  logger.info("Subscribed to db.scene.updated.*");

  await nats.subscribe("db.overlay_token.updated.*", () => {
    resolver.invalidateAll();
  });
  logger.info("Subscribed to db.overlay_token.updated.*");
}
