import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { SharedLogger } from "@woofx3/common/logging";

/**
 * Push payload sent to overlay clients connected to `/ws/module-state`.
 *
 * Mirrors the engine's `module.storage.changed` CloudEvent data, plus
 * the source moduleId so clients can route by both module and key.
 *
 * Clients filter on `(moduleId, key)` to ignore writes from modules
 * they don't care about — the broadcaster is intentionally a fan-out
 * pipe that doesn't know which client subscribed to what.
 */
export interface StorageChangedPayload {
  id?: string;
  moduleId: string;
  key: string;
  value: unknown;
  previousValue?: unknown;
  occurredAt: string;
}

interface ConnectionData {
  kind: "module-state";
  id: string;
}

/**
 * Tracks connected widget WebSockets and pushes module-storage change
 * payloads to all of them. The browser overlay is a thin renderer; per-
 * widget filtering by `(moduleId, key)` happens client-side.
 *
 * Symmetric with `AlertBroadcaster` — the duplication is deliberate so
 * the two streams can evolve independently (different message shapes,
 * different retention semantics, different rate-limiting later).
 */
export class StorageBroadcaster {
  private readonly clients = new Set<ServerWebSocket<ConnectionData>>();
  private nextId = 1;

  constructor(private readonly logger: SharedLogger) {}

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
        this.logger.error("Failed to send module-state payload", {
          clientId: ws.data.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.logger.info("Module-state broadcast", {
      sent,
      moduleId: enriched.moduleId,
      key: enriched.key,
    });
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
      message: (ws, _message) => {
        // Receive-only stream; ignore inbound traffic. A future revision
        // could accept per-key subscription requests here.
        this.logger.debug("Ignoring inbound module-state message", { clientId: ws.data.id });
      },
    };
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
