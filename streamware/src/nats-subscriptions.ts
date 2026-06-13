import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { AlertBroadcaster, AlertPayload } from "./alert-broadcaster";
import { handleLegacySlobsCommand } from "./obs-commands";
import type Manager from "./obs/manager";
import {
  mapStorageChangedEnvelope,
  type OverlayConnectionStore,
  type StorageBroadcaster,
} from "./storage-broadcaster";
import type { OverlayTokenResolver } from "./overlay-token";
import { maskToken } from "./overlay-token";

interface InitArgs {
  nats: NATSClient | null;
  obs: Manager | null;
  broadcaster: AlertBroadcaster;
  storageBroadcaster: StorageBroadcaster;
  logger: SharedLogger;
  resolver?: OverlayTokenResolver;
  overlayConnections?: OverlayConnectionStore;
}

export async function initSubscriptions({
  nats,
  obs,
  broadcaster,
  storageBroadcaster,
  logger,
  resolver,
  overlayConnections,
}: InitArgs): Promise<void> {
  if (!nats) {
    logger.warn("NATS unavailable — alert subscription skipped (overlay will receive nothing)");
    return;
  }

  // Phase 2: broadcast subscriptions moved from `ui.notify.alert`
  // (workflow → engine intent) to `ui.alert.broadcast` (engine →
  // overlay dispatch). The api's AlertQueueManager owns the queue
  // and publishes here when it's a given alert's turn to play. The
  // workflow alert action still publishes to `ui.notify.alert` —
  // we just don't broadcast it directly anymore.
  await nats.subscribe("ui.alert.broadcast", (msg) => {
    let payload: AlertPayload;
    try {
      payload = msg.json<AlertPayload>();
    } catch (err) {
      logger.error("ui.alert.broadcast: malformed JSON payload", {
        error: err instanceof Error ? err.message : String(err),
        raw: msg.string().slice(0, 200),
      });
      return;
    }
    broadcaster.broadcast(payload);
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
      logger.warn("module.storage.*.changed: dropping malformed payload", {
        subject: msg.subject,
      });
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

  // Token invalidation: poison the resolver cache so the next request
  // re-queries db-proxy. Then audit each live overlay WS connection;
  // revoked connections receive a control frame and are closed.
  await nats.subscribe("db.overlay_token.updated.*", (_msg) => {
    if (resolver) {
      resolver.invalidateAll();
    }
    if (!overlayConnections || overlayConnections.size === 0) {
      return;
    }
    // Re-resolve each connection's token; close connections where the
    // token no longer resolves (revoked or expired after invalidation).
    for (const sockets of overlayConnections.values()) {
      for (const ws of sockets) {
        const token = ws.data.token;
        if (!resolver) {
          continue;
        }
        resolver.resolve(token).then((result) => {
          if (result === null) {
            try {
              ws.send(
                JSON.stringify({
                  proto: "woofx3.overlay-events",
                  v: 1,
                  frame: { kind: "control", action: "token.revoked" },
                })
              );
              ws.close(1008, "token revoked");
            } catch {
              // Socket may already be closed; ignore.
            }
          }
        }).catch((err) => {
          logger.warn("overlay token re-resolve failed during invalidation", {
            token: maskToken(token),
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }
  });
  logger.info("Subscribed to db.overlay_token.updated.*");

  // Scene update notification: push a scene.updated frame to every
  // overlay WS connection whose sceneId matches the updated scene.
  await nats.subscribe("db.scene.updated.*", (msg) => {
    if (!overlayConnections || overlayConnections.size === 0) {
      return;
    }
    let body: { sceneId?: unknown } = {};
    try {
      body = msg.json<{ sceneId?: unknown }>();
    } catch {
      // Malformed; cannot route — drop silently.
      return;
    }
    const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
    if (!sceneId) {
      return;
    }
    const frame = JSON.stringify({
      proto: "woofx3.overlay-events",
      v: 1,
      frame: { kind: "scene.updated", sceneId, revision: Date.now() },
    });
    for (const sockets of overlayConnections.values()) {
      for (const ws of sockets) {
        if (ws.data.sceneId === sceneId) {
          try {
            ws.send(frame);
          } catch {
            // Socket may already be closed; ignore.
          }
        }
      }
    }
  });
  logger.info("Subscribed to db.scene.updated.*");
}
