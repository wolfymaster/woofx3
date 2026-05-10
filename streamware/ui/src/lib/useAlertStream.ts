import { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetStatusReport } from "./widgetHost";
import type { AlertPayload } from "../types";

interface UseAlertStreamResult {
  current: AlertPayload | null;
  dismiss: (id: string) => void;
  connected: boolean;
  /**
   * Send a widget event up the live socket. Best-effort: silently
   * dropped when the socket isn't open (log to console for diagnosis,
   * but never throw — a flaky overlay socket must not break rendering).
   *
   * Both alert lifecycle reports (from the alert overlay's host) and
   * generic widget reports (any future scene-style widget loaded into
   * the alert overlay) speak the same wire format. The streamware
   * backend's `publishWidgetEvent` helper republishes onto NATS
   * `widget.event` regardless of which WS path delivered it.
   */
  reportEvent: (report: WidgetStatusReport) => void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

/**
 * Subscribe to the streamware backend's `/ws/alerts` push stream.
 * Maintains a FIFO queue and exposes the head as `current`. Reconnects
 * with exponential backoff on disconnect — overlay typically lives in an
 * OBS browser source, so connection blips must self-heal.
 *
 * Each queued item is an AlertPayload envelope (`{ id, parameters, event }`).
 * Widget dispatch + render happen in AlertOverlay; this hook is a pure
 * transport.
 */
// Recent-envelopes ring used to drop dups from reconnect races. Big
// enough to absorb a back-to-back burst of redeliveries; small enough
// that a long-running overlay doesn't accumulate state.
const SEEN_LIMIT = 64;

export function useAlertStream(url: string): UseAlertStreamResult {
  const [queue, setQueue] = useState<AlertPayload[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Seen-set of envelope ids we've already enqueued. Lets us drop
  // dup deliveries (e.g. a NATS redelivery, a server-side replay
  // race, a streamware reconnect that re-broadcasts the active
  // alert). Using both a Set for O(1) membership and an Array for
  // FIFO eviction.
  const seenIds = useRef<Set<string>>(new Set());
  const seenOrder = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) {
        return;
      }
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt.current = 0;
        setConnected(true);
      };

      ws.onmessage = (event) => {
        let payload: AlertPayload;
        try {
          payload = JSON.parse(event.data as string);
        } catch (err) {
          console.error("alert payload parse failed", err, event.data);
          return;
        }
        if (!payload.id) {
          payload.id = crypto.randomUUID();
        }
        if (seenIds.current.has(payload.id)) {
          console.log("[alert:stream] dedup — already seen", { id: payload.id });
          return;
        }
        seenIds.current.add(payload.id);
        seenOrder.current.push(payload.id);
        if (seenOrder.current.length > SEEN_LIMIT) {
          const evicted = seenOrder.current.shift();
          if (evicted) {
            seenIds.current.delete(evicted);
          }
        }
        setQueue((q) => {
          const next = [...q, payload];
          console.log("[alert:stream] enqueue", {
            id: payload.id,
            widget: payload.parameters?.widget,
            queueLenAfter: next.length,
            queueIds: next.map((p) => p.id),
          });
          return next;
        });
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = (err) => {
        console.error("alert socket error", err);
        // onclose follows; reconnect is handled there.
      };
    }

    function scheduleReconnect() {
      if (cancelled) {
        return;
      }
      const attempt = reconnectAttempt.current++;
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
      reconnectTimer.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [url]);

  const dismiss = useCallback((id: string) => {
    setQueue((q) => {
      const next = q.filter((m) => m.id !== id);
      console.log("[alert:stream] dismiss", {
        id,
        existed: q.length !== next.length,
        queueLenAfter: next.length,
        queueIds: next.map((p) => p.id),
      });
      return next;
    });
  }, []);

  const reportEvent = useCallback((report: WidgetStatusReport) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("[alert:stream] reportEvent dropped — socket not open", {
        moduleId: report.moduleId,
        instanceId: report.instanceId,
        key: report.key,
        readyState: ws?.readyState,
      });
      return;
    }
    try {
      ws.send(JSON.stringify(report));
    } catch (err) {
      console.error("[alert:stream] reportEvent send failed", {
        moduleId: report.moduleId,
        instanceId: report.instanceId,
        key: report.key,
        error: err,
      });
    }
  }, []);

  return {
    current: queue[0] ?? null,
    dismiss,
    connected,
    reportEvent,
  };
}
