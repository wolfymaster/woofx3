import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { EventPayload } from "./events/broadcaster";
import { handleLegacySlobsCommand } from "./obs/commands";
import type Manager from "./obs/manager";
import { mapStorageChangedEnvelope, type StorageBroadcaster, type WidgetEventPushPayload } from "./storage/broadcaster";
import type { OverlayTokenResolver } from "./overlay/token-resolver";
import { maskToken } from "./overlay/token-resolver";

interface InitArgs {
  nats: NATSClient | null;
  obs: Manager | null;
  storageBroadcaster: StorageBroadcaster;
  logger: SharedLogger;
  resolver?: OverlayTokenResolver;
}

/**
 * Map a `ui.alert.broadcast` EventPayload (from the api's queue manager) to
 * the P2 WidgetEventPushPayload shape and forward it to all active overlay
 * connections. Falls back to sensible defaults when the originating CloudEvent
 * fields are absent.
 */
function alertToWidgetEvent(payload: EventPayload): WidgetEventPushPayload {
  const ev = payload.event;
  return {
    kind: "event",
    id: payload.id,
    type: ev?.type ?? "ui.alert",
    source: ev?.source ?? "streamware",
    time: ev?.time ?? new Date().toISOString(),
    data: ev?.data ?? {},
    parameters: payload.parameters,
  };
}

export async function initSubscriptions({
  nats,
  obs,
  storageBroadcaster,
  logger,
  resolver,
}: InitArgs): Promise<void> {
  if (!nats) {
    logger.warn("NATS unavailable — event subscriptions skipped (overlay will receive nothing)");
    return;
  }

  // `ui.alert.broadcast` is published by the api's EventQueueManager when it
  // is a given alert's turn to play. Map to a P2 event frame and push to all
  // active overlay WS connections.
  await nats.subscribe("ui.alert.broadcast", (msg) => {
    let payload: EventPayload;
    try {
      payload = msg.json<EventPayload>();
    } catch (err) {
      logger.error("ui.alert.broadcast: malformed JSON payload", {
        error: err instanceof Error ? err.message : String(err),
        raw: msg.string().slice(0, 200),
      });
      return;
    }
    storageBroadcaster.broadcastEvent(alertToWidgetEvent(payload));
  });
  logger.info("Subscribed to ui.alert.broadcast");

  // Module persistent-storage change events (auto-emitted by the
  // QuickJS / Lua sandbox after every successful ctx.storage.set()).
  // Concrete subjects are `module.storage.<moduleId>.changed`; wildcard
  // mirrors shared/common/golang/cloudevents/subjects.go.
  await nats.subscribe("module.storage.*.changed", (msg) => {
    let envelope: unknown;
    try {
      envelope = msg.json();
    } catch (err) {
      logger.error("module.storage.*.changed: malformed JSON envelope", {
        subject: msg.subject,
        error: err instanceof Error ? err.message : String(err),
        raw: msg.string().slice(0, 200),
      });
      return;
    }
    const payload = mapStorageChangedEnvelope(envelope);
    if (!payload) {
      logger.warn("module.storage.*.changed: dropping malformed payload", { subject: msg.subject });
      return;
    }
    storageBroadcaster.broadcast(payload);
  });
  logger.info("Subscribed to module.storage.*.changed");

  // Legacy slobs subject: kept temporarily so chat-bot scene/source
  // triggers don't break. Drop once everything moves to workflow actions.
  await nats.subscribe("slobs", (msg) => {
    let body: { command: string; args: Record<string, string> };
    try {
      body = msg.json();
    } catch (err) {
      logger.error("slobs: malformed JSON payload", {
        error: err instanceof Error ? err.message : String(err),
        raw: msg.string().slice(0, 200),
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

  // Token invalidation: poison the resolver cache then audit live overlay
  // connections, sending a revoke frame and closing any that no longer resolve.
  await nats.subscribe("db.overlay_token.updated.*", (_msg) => {
    resolver?.invalidateAll();
  });
  logger.info("Subscribed to db.overlay_token.updated.*");

  // Scene update notification: push a scene.updated frame to every overlay
  // WS connection whose sceneId matches the updated scene. The client re-fetches
  // /o/{token}/config and re-renders.
  await nats.subscribe("db.scene.updated.*", (msg) => {
    let body: { sceneId?: unknown } = {};
    try {
      body = msg.json<{ sceneId?: unknown }>();
    } catch {
      return;
    }
    const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
    if (!sceneId) {
      return;
    }
    // Push a bare scene.updated frame directly — this is control-plane traffic,
    // not a widget event, so it goes outside the broadcastEvent path.
    const frameJson = JSON.stringify({
      proto: "woofx3.overlay-events",
      v: 1,
      frame: { kind: "scene.updated", sceneId, revision: Date.now() },
    });
    storageBroadcaster.pushSceneFrame(sceneId, frameJson);
  });
  logger.info("Subscribed to db.scene.updated.*");
}
