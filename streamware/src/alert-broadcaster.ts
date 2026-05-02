import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { SharedLogger } from "@woofx3/common/logging";

export type AlertPayload = Record<string, unknown> & {
  id?: string;
  type?: "alert_message" | "play_audio";
};

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
      id: payload.id ?? crypto.randomUUID(),
      ...payload,
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
