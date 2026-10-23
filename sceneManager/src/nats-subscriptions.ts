import { SCENE_COMMAND_SUBJECT } from "@woofx3/common/cloudevents/Scene/commands";
import {
  COMPOSITION_PREVIEW_TOKEN_SUBJECT,
  type CompositionPreviewTokenReply,
} from "@woofx3/common/cloudevents/Scene/composition-preview";
import {
  SCENE_EDITOR_TOKEN_SUBJECT,
  SCENE_REPAIR_SUBJECT,
  type SceneEditorTokenReply,
  type SceneRepairReply,
} from "@woofx3/common/cloudevents/Scene/editor";
import type { Logger } from "@woofx3/common/runtime";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { DbClient } from "./db";
import {
  ALERT_CLEAR_SUBJECT,
  ALERT_QUEUE_STATE_SUBJECT,
  ALERT_REPLAY_SUBJECT,
  ALERT_SKIP_SUBJECT,
  AlertReplays,
  clearQueuedAlerts,
  readAlertQueue,
  skipCurrentAlerts,
} from "./events/alert-controls";
import { type AlertEnvelope, dispatchAlert } from "./events/alert-dispatch";
import type { DeliveryStore } from "./events/delivery-store";
import { handleStatusReport } from "./events/handlers";
import { closeDeliveriesToRemovedPlacements } from "./events/removed-placements";
import { errorText } from "./scene/held-scene";
import type { ModuleStateWatch } from "./scene/module-state";
import { answerSceneCommand, type SceneCommandDeps } from "./scene/scene-command";
import type { OverlayHost } from "./scene/scene-host";
import type { OverlayTokenResolver } from "./scene/token-resolver";

interface InitArgs {
  nats: NATSClient | null;
  db: DbClient;
  host: OverlayHost;
  deliveryStore: DeliveryStore;
  moduleState: ModuleStateWatch;
  resolver: OverlayTokenResolver;
  sceneDocuments: SavedScenes;
  /** Mints the token that opens a scene's editor socket (see routes/editor.ts). */
  editorToken: (sceneId: string) => Promise<SceneEditorTokenReply>;
  /** Mints the token that opens the composition preview page (see routes/composition-preview.ts). */
  previewToken: () => Promise<CompositionPreviewTokenReply>;
  logger: Logger;
}

interface StorageChangedEnvelope {
  data?: { moduleId?: unknown; key?: unknown; value?: unknown };
}

interface ModuleSettingUpdatedEnvelope {
  data?: { moduleId?: unknown; key?: unknown };
}

interface SceneUpdatedEnvelope {
  data?: { id?: unknown };
}

/** The slice of `SceneDocuments` saves and scene commands are handed to. */
interface SavedScenes extends SceneCommandDeps {
  refresh(sceneId: string): Promise<void>;
  repair(sceneId: string): Promise<SceneRepairReply>;
}

/**
 * A scene was saved: bring its open overlays up to date.
 *
 * The scene documents diff the save against what the overlays hold and push
 * the difference down the stream they already have open, as sequenced ops,
 * so a save in the dashboard reaches OBS without a reload. Returns the scene
 * id it handed on, or null for an envelope with none.
 */
export function notifySceneUpdated(
  scenes: Pick<SavedScenes, "refresh">,
  envelope: SceneUpdatedEnvelope
): string | null {
  const sceneId = typeof envelope.data?.id === "string" ? envelope.data.id : "";
  if (!sceneId) {
    return null;
  }
  void scenes.refresh(sceneId);
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
 * caches on control-plane pushes, and answer the engine's scene requests.
 *
 *   - `ui.notify.alert` goes straight to `DeliveryStore.recordEvent`:
 *     dispatch timing is decided by each overlay's per-widget queue in the
 *     browser, so nothing here holds alerts back or re-publishes them.
 *   - The operator's alert queue controls (`widget.queue.skip`, `.clear`,
 *     `.replay`) and the queue read (`.state`) are answered here, because
 *     the queues they act on live in the overlays this service streams to
 *     (see events/alert-controls.ts).
 *   - `module.storage.*.changed` is pushed only to scenes whose widgets
 *     asked for that key (see scene/module-state.ts), not broadcast.
 *   - Every `widget.event` status report is a uniform
 *     `db.upsertWidgetStatus`, the built-in alert widget's included.
 */
export async function initSubscriptions(args: InitArgs): Promise<void> {
  const { nats, db, host, deliveryStore, moduleState, resolver, sceneDocuments, editorToken, previewToken, logger } =
    args;

  if (!nats) {
    logger.warn("NATS unavailable — event subscriptions skipped (scenes will receive no live events)");
    return;
  }

  await subscribeJson<AlertEnvelope>(nats, logger, "ui.notify.alert", async (raw, msg) => {
    await dispatchAlert(raw, { db, host, deliveryStore, logger });
  });

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
  await answer(ALERT_QUEUE_STATE_SUBJECT, () => readAlertQueue({ host, deliveryStore }));
  logger.info("Answering widget.queue.{skip,clear,replay,state}");

  await subscribeJson<WidgetEventEnvelope>(nats, logger, "widget.event", async (envelope, msg) => {
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

  // Published by barkloader on every module storage write, and by the api
  // with a null value for each session-scoped key a session end cleared.
  await subscribeJson<StorageChangedEnvelope>(nats, logger, "module.storage.*.changed", async (envelope, msg) => {
    const data = envelope.data ?? {};
    const moduleId = typeof data.moduleId === "string" ? data.moduleId : "";
    const key = typeof data.key === "string" ? data.key : "";
    if (!moduleId || !key) {
      logger.warn("module.storage.changed: missing moduleId or key; dropping", { subject: msg.subject });
      return;
    }
    await moduleState.publish(moduleId, key, data.value ?? null);
  });

  // A resource instance's settings can change what its value reads as (a
  // counter's goals) without its storage changing.
  await subscribeJson<ResourceInstanceUpdatedEnvelope>(
    nats,
    logger,
    "db.module.resource.instance.updated.*",
    async (envelope, msg) => {
      const canonicalId = typeof envelope.data?.canonical_id === "string" ? envelope.data.canonical_id : "";
      if (!canonicalId) {
        return;
      }
      await moduleState.resourceUpdated(canonicalId);
    }
  );

  // The api asks for this when a dashboard opens the scene editor; only the
  // api's requests are answered (see `answer`).
  await answer(SCENE_EDITOR_TOKEN_SUBJECT, async (body) => {
    const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
    return sceneId ? editorToken(sceneId) : ({ ok: false, reason: "sceneId required" } satisfies SceneEditorTokenReply);
  });
  logger.info(`Answering ${SCENE_EDITOR_TOKEN_SUBJECT}`);

  // A dashboard repairing a scene whose stored data could not be read.
  await answer(SCENE_REPAIR_SUBJECT, async (body): Promise<SceneRepairReply> => {
    const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
    if (!sceneId) {
      return { ok: false, reason: "not_found", detail: "sceneId required" };
    }
    try {
      return await sceneDocuments.repair(sceneId);
    } catch (err) {
      logger.warn(`${SCENE_REPAIR_SUBJECT}: the repair failed`, { sceneId, error: errorText(err) });
      return { ok: false, reason: "failed", detail: "the scene could not be loaded" };
    }
  });
  logger.info(`Answering ${SCENE_REPAIR_SUBJECT}`);

  // The api asks for this when a dashboard opens the alert editor's preview.
  await answer(COMPOSITION_PREVIEW_TOKEN_SUBJECT, () => previewToken());
  logger.info(`Answering ${COMPOSITION_PREVIEW_TOKEN_SUBJECT}`);

  // A workflow step changing a scene (scene.widget.visibility): applied to
  // the published scene like an edit, and answered so the step knows.
  await nats.subscribe(SCENE_COMMAND_SUBJECT, (msg) => answerSceneCommand(sceneDocuments, msg, logger));
  logger.info(`Answering ${SCENE_COMMAND_SUBJECT}`);

  // db-proxy announces every module setting write, naming the setting but
  // never its value. A module's widgets reading one of its list settings get
  // its new rows.
  await subscribeJson<ModuleSettingUpdatedEnvelope>(
    nats,
    logger,
    "db.module.setting.updated.*",
    async (envelope, msg) => {
      const moduleId = typeof envelope.data?.moduleId === "string" ? envelope.data.moduleId : "";
      const key = typeof envelope.data?.key === "string" ? envelope.data.key : "";
      if (moduleId && key) {
        await moduleState.settingUpdated(moduleId, key);
      }
    }
  );

  await subscribeJson<SceneUpdatedEnvelope>(nats, logger, "db.scene.updated.*", async (envelope, msg) => {
    const sceneId = notifySceneUpdated(sceneDocuments, envelope);
    if (!sceneId) {
      logger.warn("db.scene.updated: missing scene id; dropping", { subject: msg.subject });
      return;
    }
    await closeDeliveriesToRemovedPlacements(sceneId, { host, deliveryStore, logger });
  });

  await nats.subscribe("db.overlay_token.updated.*", () => {
    resolver.invalidateAll();
  });
  logger.info("Subscribed to db.overlay_token.updated.*");
}

/**
 * Subscribe to `subject`, handing each message's JSON body to `handle`. A
 * body that is not JSON is logged with the subject and dropped; a `handle`
 * that throws or rejects is logged by the client and does not end the
 * subscription (see `consumeMessages`).
 */
export async function subscribeJson<T>(
  nats: Pick<NATSClient, "subscribe">,
  logger: Logger,
  subject: string,
  handle: (body: T, msg: Msg) => void | Promise<void>
): Promise<void> {
  await nats.subscribe(subject, (msg) => {
    let body: T;
    try {
      body = msg.json<T>();
    } catch (err) {
      logger.error(`${subject}: malformed JSON body; dropped`, {
        subject: msg.subject,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    return handle(body, msg);
  });
  logger.info(`Subscribed to ${subject}`);
}
