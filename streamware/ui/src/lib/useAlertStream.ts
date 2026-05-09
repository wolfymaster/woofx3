import { useCallback, useEffect, useRef, useState } from "react";
import type { AlertPayload } from "../types";

interface UseAlertStreamResult {
  current: AlertPayload | null;
  dismiss: (id: string) => void;
  connected: boolean;
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
export function useAlertStream(url: string): UseAlertStreamResult {
  const [queue, setQueue] = useState<AlertPayload[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setQueue((q) => [...q, payload]);
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
    setQueue((q) => q.filter((m) => m.id !== id));
  }, []);

  return {
    current: queue[0] ?? null,
    dismiss,
    connected,
  };
}
