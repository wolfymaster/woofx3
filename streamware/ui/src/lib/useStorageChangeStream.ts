import { useEffect, useMemo, useRef, useState } from "react";
import type { StorageChangeStream, StorageChangedFrame } from "./widgetHost";
import type { StorageChangedPayload } from "../types";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

interface UseStorageChangeStreamResult {
  stream: StorageChangeStream;
  connected: boolean;
}

/**
 * One shared subscription to streamware's `/ws/module-state` push
 * stream, exposed as a `StorageChangeStream` the widgetHost factory
 * consumes. Counterpart to `useAlertStream` — kept structurally
 * similar so reconnection / parsing logic stays consistent across
 * the two transports.
 *
 * The stream maintains a `(moduleId, key) → latest value` cache so
 * `widgetHost.storage.get` can resolve synchronously from memory
 * without an extra fetch round-trip.
 */
export function useStorageChangeStream(url: string): UseStorageChangeStreamResult {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cache + subscriber set live in refs so the StorageChangeStream
  // identity is stable across renders — widgets only need one host
  // creation per mount, not one per parent re-render.
  const cacheRef = useRef<Map<string, unknown>>(new Map());
  const subscribersRef = useRef<Set<(p: StorageChangedFrame) => void>>(new Set());

  const stream = useMemo<StorageChangeStream>(
    () => ({
      peek(moduleId, key) {
        return cacheRef.current.get(cacheKey(moduleId, key));
      },
      subscribe(cb) {
        subscribersRef.current.add(cb);
        return () => {
          subscribersRef.current.delete(cb);
        };
      },
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt.current = 0;
        setConnected(true);
      };

      ws.onmessage = (event) => {
        let payload: StorageChangedPayload;
        try {
          payload = JSON.parse(event.data as string);
        } catch (err) {
          console.error("module-state payload parse failed", err, event.data);
          return;
        }
        if (!payload.moduleId || !payload.key) {
          return;
        }
        const frame: StorageChangedFrame = {
          moduleId: payload.moduleId,
          key: payload.key,
          value: payload.value,
        };
        cacheRef.current.set(cacheKey(frame.moduleId, frame.key), frame.value);
        for (const cb of subscribersRef.current) {
          try {
            cb(frame);
          } catch (err) {
            console.error("storage subscriber threw", err);
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = (err) => {
        console.error("module-state socket error", err);
      };
    }

    function scheduleReconnect() {
      if (cancelled) return;
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

  return { stream, connected };
}

function cacheKey(moduleId: string, key: string): string {
  return `${moduleId}:${key}`;
}
