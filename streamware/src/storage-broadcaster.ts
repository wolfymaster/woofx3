import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { publishWidgetEvent } from "./widget-event-wire";

/**
 * Push payload sent to overlay clients connected to `/ws/module-state`.
 *
 * Mirrors the engine's `module.storage.changed` CloudEvent data, plus
 * the source moduleId so clients can route by both module and key.
 *
 * Clients filter on `(moduleId, key)` to ignore writes from modules
 * they don't care about — the broadcaster is intentionally a fan-out
 * pipe that doesn't know which client subscribed to what.
 *
 * The `kind` discriminator is optional for backwards compatibility:
 * legacy payloads without it are treated as `"storage"` by clients.
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
 * Generic event push — the manager forwards an engine-side trigger
 * event to scene overlays so widgets that declared interest via
 * `acceptedEvents` can react. The wire shape is shared with the
 * inbound `widget.event` upstream channel intentionally — same data
 * model, both directions.
 *
 * Routing happens client-side: the `SceneOverlay` matches `type`
 * against each widget's declared `acceptedEvents`, and only fires
 * the matching widget's `onEvent` handler.
 */
export interface WidgetEventPushPayload {
  kind: "event";
  id?: string;
  /** Canonical trigger id, e.g. `twitch_platform:trigger:follow.user.twitch`. */
  type: string;
  /** CloudEvent source. */
  source: string;
  /** RFC3339. */
  time: string;
  /** Event payload — opaque to the broadcaster. */
  data: unknown;
}

export type ModuleStateOutboundPayload = StorageChangedPayload | WidgetEventPushPayload;

interface ConnectionData {
  kind: "module-state";
  id: string;
}

// (R2: the prior `WidgetStatusInbound` interface was a strict subset
//  of `OverlayWidgetEvent` in `widget-event-wire.ts`. Both broadcasters
//  now share the same wire format and helper, so the type lives there.)
export type { OverlayWidgetEvent as WidgetStatusInbound } from "./widget-event-wire";

/**
 * Tracks connected widget WebSockets and pushes module-storage change
 * payloads to all of them. The browser overlay is a thin renderer; per-
 * widget filtering by `(moduleId, key)` happens client-side.
 *
 * Phase 4: also accepts inbound `widget.status` reports from scene
 * overlays and republishes them onto NATS `module.widget.status.changed`
 * so the api can persist + project to the dashboard.
 *
 * Symmetric with `AlertBroadcaster` — the duplication is deliberate so
 * the two streams can evolve independently (different message shapes,
 * different retention semantics, different rate-limiting later).
 */
export class StorageBroadcaster {
  private readonly clients = new Set<ServerWebSocket<ConnectionData>>();
  private nextId = 1;
  private nats: NATSClient | null;

  constructor(private readonly logger: SharedLogger, nats: NATSClient | null = null) {
    this.nats = nats;
  }

  setNats(nats: NATSClient | null): void {
    this.nats = nats;
  }

  clientCount(): number {
    return this.clients.size;
  }

  broadcast(payload: StorageChangedPayload): void {
    if (this.clients.size === 0) {
      // Storage updates are non-essential when no overlay is listening
      // — log at debug rather than warn so the bus isn't noisy in
      // headless / pre-overlay scenarios.
      this.logger.debug("Storage change dropped — no module-state clients connected", {
        payload,
      });
      return;
    }
    const enriched: StorageChangedPayload = {
      kind: "storage",
      ...payload,
      id: payload.id ?? crypto.randomUUID(),
    };
    this.fanOut(enriched, {
      moduleId: enriched.moduleId,
      key: enriched.key,
      kind: "storage",
    });
  }

  /**
   * Push an engine-side trigger event to every connected scene
   * overlay. SceneOverlay matches `type` against each widget's
   * declared `acceptedEvents` and fires only the matching
   * `widgetHost.onEvent` handlers. The broadcaster does not filter
   * — that's the client's job.
   */
  broadcastEvent(payload: WidgetEventPushPayload): void {
    if (this.clients.size === 0) {
      this.logger.debug("Widget event dropped — no module-state clients connected", {
        type: payload.type,
      });
      return;
    }
    const enriched: WidgetEventPushPayload = {
      ...payload,
      id: payload.id ?? crypto.randomUUID(),
    };
    this.fanOut(enriched, { type: enriched.type, kind: "event" });
  }

  private fanOut(payload: ModuleStateOutboundPayload, logCtx: Record<string, unknown>): void {
    const json = JSON.stringify(payload);
    let sent = 0;
    for (const ws of this.clients) {
      try {
        ws.send(json);
        sent++;
      } catch (err) {
        this.logger.error("Failed to send module-state payload", {
          clientId: ws.data.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.logger.info("Module-state broadcast", { sent, ...logCtx });
  }

  handlers(): WebSocketHandler<ConnectionData> {
    return {
      open: (ws) => {
        this.clients.add(ws);
        this.logger.info("module-state client connected", {
          clientId: ws.data.id,
          totalClients: this.clients.size,
        });
      },
      close: (ws, code, reason) => {
        this.clients.delete(ws);
        this.logger.info("module-state client disconnected", {
          clientId: ws.data.id,
          code,
          reason,
          totalClients: this.clients.size,
        });
      },
      message: (ws, message) => {
        this.handleInbound(ws, message);
      },
    };
  }

  /**
   * Decode and forward an overlay-originated widget event. Shared
   * with `AlertBroadcaster.handleInbound` via `publishWidgetEvent` —
   * the inbound channel is unified across both WS paths.
   */
  private handleInbound(ws: ServerWebSocket<ConnectionData>, raw: string | Buffer): void {
    publishWidgetEvent(ws, raw, this.nats, this.logger);
  }

  nextConnectionData(): ConnectionData {
    return { kind: "module-state", id: `module-state-${this.nextId++}` };
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
 * shape the broadcaster pushes. Returns `null` on malformed input —
 * the caller logs and drops. Exported for direct unit testing.
 */
export function mapStorageChangedEnvelope(raw: unknown): StorageChangedPayload | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const ce = raw as CloudEventEnvelopeShape;
  // Fall back to the envelope itself if `data` is missing — barkloader
  // currently nests under `data`, but a defensive parser keeps us
  // forward-compatible with engines that flatten the payload.
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

  const payload: StorageChangedPayload = {
    moduleId,
    key,
    value: data.value,
    occurredAt,
  };
  if (data.previousValue !== undefined) {
    payload.previousValue = data.previousValue;
  }
  return payload;
}
