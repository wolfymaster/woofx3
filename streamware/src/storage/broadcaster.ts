import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { publishWidgetEvent } from "../events/wire";
import type { OverlayConnectionMeta, OverlayConnectionStore } from "../overlay/connections";

export type { OverlayConnectionMeta, OverlayConnectionStore };

/** P2 envelope sent on the `/o/{token}/events` WebSocket. */
interface P2Frame {
  proto: "woofx3.overlay-events";
  v: 1;
  frame: Record<string, unknown>;
}

/**
 * Storage-change payload from `module.storage.*.changed` CloudEvents.
 * Clients filter on `(moduleId, key)` — broadcaster is a fan-out pipe
 * that does not know per-widget subscriptions.
 */
export interface StorageChangedPayload {
  kind?: "storage";
  id?: string;
  moduleId: string;
  key: string;
  value: unknown;
  previousValue?: unknown;
  occurredAt: string;
}

/**
 * Engine-side trigger event forwarded to scene overlays. Wire shape is
 * shared with the inbound `widget.event` upstream channel intentionally
 * — same data model, both directions.
 *
 * Routing happens client-side: SceneOverlay matches `type` against each
 * widget's declared `acceptedEvents` and fires only the matching
 * `widgetHost.onEvent` handlers.
 */
export interface WidgetEventPushPayload {
  kind: "event";
  id?: string;
  /** Canonical trigger id, e.g. `twitch_platform:trigger:follow.user.twitch`. */
  type: string;
  source: string;
  /** RFC3339. */
  time: string;
  data: unknown;
  /** Workflow action parameters forwarded verbatim so widgets see the same
   *  config the alert queue dispatched. */
  parameters?: Record<string, unknown>;
}

export type ModuleStateOutboundPayload = StorageChangedPayload | WidgetEventPushPayload;

// Re-export so consumers that used to import from storage-broadcaster can
// still resolve OverlayWidgetEvent without changing their imports.
export type { OverlayWidgetEvent as WidgetStatusInbound } from "../events/wire";

/**
 * Pushes storage-change and widget-event payloads to all active overlay P2
 * WebSocket connections (`/o/{token}/events`). Also accepts inbound
 * `widget.status` reports from those connections and republishes them onto
 * NATS `widget.event`.
 *
 * The overlay connection store is injected at construction so every broadcast
 * call reaches live connections without callers having to pass it each time.
 */
export class StorageBroadcaster {
  private readonly nats: NATSClient | null;

  constructor(
    private readonly logger: SharedLogger,
    nats: NATSClient | null = null,
    private readonly overlayConnections: OverlayConnectionStore = new Map(),
  ) {
    this.nats = nats;
  }

  overlayClientCount(): number {
    let n = 0;
    for (const sockets of this.overlayConnections.values()) {
      n += sockets.size;
    }
    return n;
  }

  broadcast(payload: StorageChangedPayload): void {
    const enriched: StorageChangedPayload = {
      kind: "storage",
      ...payload,
      id: payload.id ?? crypto.randomUUID(),
    };
    this.pushToOverlay(enriched, { moduleId: enriched.moduleId, key: enriched.key, kind: "storage" });
  }

  broadcastEvent(payload: WidgetEventPushPayload): void {
    const enriched: WidgetEventPushPayload = {
      ...payload,
      id: payload.id ?? crypto.randomUUID(),
    };
    this.pushToOverlay(enriched, { type: enriched.type, kind: "event" });
  }

  get natsClient(): NATSClient | null {
    return this.nats;
  }

  /**
   * Send a raw pre-serialized P2 frame to all overlay connections whose
   * `sceneId` matches the given value. Used for control-plane messages
   * (e.g. `scene.updated`) that are not widget events.
   */
  pushSceneFrame(sceneId: string, frameJson: string): void {
    for (const sockets of this.overlayConnections.values()) {
      for (const ws of sockets) {
        if (ws.data.sceneId === sceneId) {
          try {
            ws.send(frameJson);
          } catch {
            // Socket may already be closed.
          }
        }
      }
    }
  }

  private pushToOverlay(payload: ModuleStateOutboundPayload, logCtx: Record<string, unknown>): void {
    if (this.overlayConnections.size === 0) {
      this.logger.debug("Overlay push skipped — no P2 connections", logCtx);
      return;
    }
    const frame: P2Frame = {
      proto: "woofx3.overlay-events",
      v: 1,
      frame: { ...payload },
    };
    const json = JSON.stringify(frame);
    let sent = 0;
    for (const sockets of this.overlayConnections.values()) {
      for (const ws of sockets) {
        try {
          ws.send(json);
          sent++;
        } catch (err) {
          this.logger.error("Failed to send overlay P2 frame", {
            applicationId: ws.data.applicationId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    this.logger.info("Overlay P2 broadcast", { sent, ...logCtx });
  }
}

interface CloudEventEnvelopeShape {
  type?: unknown;
  time?: unknown;
  data?: {
    moduleId?: unknown;
    key?: unknown;
    value?: unknown;
    previousValue?: unknown;
    occurredAt?: unknown;
  };
}

/**
 * Decode a `module.storage.changed` CloudEvent envelope into the wire
 * shape the broadcaster pushes. Returns `null` on malformed input.
 * Exported for unit testing.
 */
export function mapStorageChangedEnvelope(raw: unknown): StorageChangedPayload | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const ce = raw as CloudEventEnvelopeShape;
  const data = (ce.data ?? (ce as unknown as CloudEventEnvelopeShape["data"])) ?? {};
  const moduleId = typeof data.moduleId === "string" ? data.moduleId : "";
  const key = typeof data.key === "string" ? data.key : "";
  if (!moduleId || !key) {
    return null;
  }
  const occurredAt =
    typeof data.occurredAt === "string" && data.occurredAt
      ? data.occurredAt
      : typeof ce.time === "string" && ce.time
      ? ce.time
      : new Date().toISOString();

  const payload: StorageChangedPayload = { moduleId, key, value: data.value, occurredAt };
  if (data.previousValue !== undefined) {
    payload.previousValue = data.previousValue;
  }
  return payload;
}
