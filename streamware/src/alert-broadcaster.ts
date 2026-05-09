import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { SharedLogger } from "@woofx3/common/logging";

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
 * Tracks connected overlay WebSockets and pushes alert payloads to all
 * of them. The browser overlay is a thin renderer; ordering and queueing
 * happen client-side.
 */
export class AlertBroadcaster {
  private readonly clients = new Set<ServerWebSocket<ConnectionData>>();
  private nextId = 1;

  constructor(private readonly logger: SharedLogger) {}

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
      message: (ws, _message) => {
        // Overlays are receive-only today; ignore inbound traffic.
        this.logger.debug("Ignoring inbound overlay message", { clientId: ws.data.id });
      },
    };
  }

  nextConnectionData(): ConnectionData {
    return { kind: "alerts", id: `overlay-${this.nextId++}` };
  }
}
