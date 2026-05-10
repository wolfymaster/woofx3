import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { publishWidgetEvent } from "./widget-event-wire";

/**
 * Envelope published by the engine's `builtin:action:alert` to the
 * `ui.notify.alert` NATS subject after the widget refactor (see
 * woofx3-ui/docs/superpowers/specs/2026-05-02-streamware-widget-encapsulation-design.md).
 *
 * - `parameters`: workflow-author config; convention requires a `widget`
 *   key naming a streamware widget. Other keys (text, mediaUrl, audioUrl,
 *   duration, options, custom) are widget-specific.
 * - `event`: the originating CloudEvent that triggered the workflow, or
 *   `null` for non-event triggers (manual, scheduled, chat command).
 *
 * The broadcaster forwards this verbatim to overlay clients — widget
 * dispatch / substitution / rendering happens in the UI.
 */
export interface CloudEventLike {
  id?: string;
  type?: string;
  source?: string;
  time?: string;
  subject?: string;
  data?: Record<string, unknown>;
}

export interface AlertPayload {
  id?: string;
  parameters: Record<string, unknown>;
  event: CloudEventLike | null;
}

interface ConnectionData {
  kind: "alerts";
  id: string;
}

/**
 * Inbound widget event from an overlay client. Mirrors
 * `streamware/ui/src/lib/widgetHost.ts:WidgetStatusReport`.
 *
 * Single message kind for everything an overlay reports — alert
 * lifecycle acks, counter increments, timer state, goal hits. The
 * broadcaster validates and republishes onto NATS `widget.event`;
 * the orchestrator dispatches by `key`:
 *   "alert.lifecycle" → AlertQueueManager.handleStatus
 *   anything else     → db.upsertWidgetStatus
 *
 * For alert-overlay reports, the carrying value contains
 * `{ envelopeId, state, error? }`. For raid_counter increments it's
 * a number, etc. — opaque at this boundary.
 */
export interface OverlayInboundMessage {
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
 * Tracks connected overlay WebSockets and pushes alert payloads to all
 * of them. Also accepts inbound status reports from those overlays and
 * republishes them onto NATS `ui.widget.status` so the api can advance
 * the matching `alerts` row.
 *
 * The browser overlay is a thin renderer; ordering and queueing happen
 * client-side in Phase 1 (Phase 2 moves the queue to the api).
 */
export class AlertBroadcaster {
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

  broadcast(payload: AlertPayload): void {
    if (this.clients.size === 0) {
      this.logger.warn("Alert dropped — no overlay clients connected", { payload });
      return;
    }
    const enriched: AlertPayload = {
      ...payload,
      id: payload.id ?? crypto.randomUUID(),
    };
    const json = JSON.stringify(enriched);
    let sent = 0;
    for (const ws of this.clients) {
      try {
        ws.send(json);
        sent++;
      } catch (err) {
        this.logger.error("Failed to send alert to overlay client", {
          clientId: ws.data.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.logger.info("Alert broadcast", { sent, alertId: enriched.id });
  }

  handlers(): WebSocketHandler<ConnectionData> {
    return {
      open: (ws) => {
        this.clients.add(ws);
        this.logger.info("Overlay client connected", {
          clientId: ws.data.id,
          totalClients: this.clients.size,
        });
      },
      close: (ws, code, reason) => {
        this.clients.delete(ws);
        this.logger.info("Overlay client disconnected", {
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
   * Decode and forward an overlay-originated widget event. Validation
   * is permissive — bad shapes are dropped with a single warning so a
   * misbehaving overlay can't fill the log. Anything recognised as a
   * `widget.event` is republished to NATS `widget.event` so the
   * orchestrator can react.
   */
  private handleInbound(ws: ServerWebSocket<ConnectionData>, raw: string | Buffer): void {
    publishWidgetEvent(ws, raw, this.nats, this.logger);
  }

  nextConnectionData(): ConnectionData {
    return { kind: "alerts", id: `overlay-${this.nextId++}` };
  }
}
