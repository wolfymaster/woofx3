import { useCallback, useEffect, useRef, useState } from "react";
import type { StorageChangedPayload } from "../types";

interface UseStorageStreamResult {
  /** Latest value seen for the requested `(moduleId, key)`. `undefined`
   *  until the first matching push lands. Compare with `=== undefined`
   *  rather than falsy — `null` and `0` are valid stored values. */
  current: unknown;
  /** WebSocket is open. */
  connected: boolean;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

/**
 * Subscribe to the streamware backend's `/ws/module-state` push stream
 * and surface the latest value for a single `(moduleId, key)` pair.
 *
 * Reconnects with exponential backoff on disconnect — overlay typically
 * lives in an OBS browser source, so blips must self-heal.
 *
 * Counterpart to `useAlertStream` — kept structurally similar so the
 * two transports diverge only where they need to.
 */
export function useStorageStream(
  url: string,
  moduleId: string,
  key: string
): UseStorageStreamResult {
  const [current, setCurrent] = useState<unknown>(undefined);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMessage = useCallback(
    (raw: string) => {
      let payload: StorageChangedPayload;
      try {
        payload = JSON.parse(raw);
      } catch (err) {
        console.error("module-state payload parse failed", err, raw);
        return;
      }
      if (payload.moduleId !== moduleId || payload.key !== key) {
        return;
      }
      setCurrent(payload.value);
    },
    [moduleId, key]
  );

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
        onMessage(event.data as string);
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = (err) => {
        console.error("module-state socket error", err);
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
  }, [url, onMessage]);

  return { current, connected };
}
