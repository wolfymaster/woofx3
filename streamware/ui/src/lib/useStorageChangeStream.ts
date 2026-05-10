import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  StorageChangeStream,
  StorageChangedFrame,
  WidgetEvent,
  WidgetEventHandler,
  WidgetEventSource,
  WidgetStatusReport,
} from "./widgetHost";
import type { StorageChangedPayload } from "../types";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

interface UseStorageChangeStreamResult {
  stream: StorageChangeStream;
  /**
   * Engine-pushed event source, scoped to the whole socket. The
   * SceneOverlay subscribes to this once and fans out to per-widget
   * sources filtered by `acceptedEvents`.
   */
  events: WidgetEventSource;
  connected: boolean;
  /**
   * Send a widget event up the live socket. Best-effort:
   * silently dropped (with a console warning) when the socket is
   * not open. Never throws.
   */
  sendWidgetEvent: (report: WidgetStatusReport) => void;
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
  // Engine-pushed event subscribers. Same hook owns both kinds
  // because they share the WS transport — `kind` on the wire
  // discriminates which subscriber pool fires.
  const eventSubscribersRef = useRef<Set<WidgetEventHandler>>(new Set());

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

  const events = useMemo<WidgetEventSource>(
    () => ({
      subscribe(handler) {
        eventSubscribersRef.current.add(handler);
        return () => {
          eventSubscribersRef.current.delete(handler);
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

      ws.onmessage = (msg) => {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(msg.data as string);
        } catch (err) {
          console.error("module-state payload parse failed", err, msg.data);
          return;
        }
        // Discriminate on `kind`. Legacy storage payloads omit it
        // and are treated as `"storage"` for backwards compatibility.
        const kind = typeof payload.kind === "string" ? payload.kind : "storage";
        if (kind === "event") {
          const widgetEvent: WidgetEvent = {
            type: typeof payload.type === "string" ? payload.type : "",
            source: typeof payload.source === "string" ? payload.source : "",
            time: typeof payload.time === "string" ? payload.time : new Date().toISOString(),
            data: payload.data,
          };
          if (!widgetEvent.type) {
            return;
          }
          for (const handler of eventSubscribersRef.current) {
            try {
              handler(widgetEvent);
            } catch (err) {
              console.error("event subscriber threw", err);
            }
          }
          return;
        }
        const storage = payload as unknown as StorageChangedPayload;
        if (!storage.moduleId || !storage.key) {
          return;
        }
        const frame: StorageChangedFrame = {
          moduleId: storage.moduleId,
          key: storage.key,
          value: storage.value,
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

  const sendWidgetEvent = useCallback((report: WidgetStatusReport) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("[widget:stream] sendWidgetEvent dropped — socket not open", {
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
      console.error("[widget:stream] sendWidgetEvent send failed", {
        moduleId: report.moduleId,
        instanceId: report.instanceId,
        key: report.key,
        error: err,
      });
    }
  }, []);

  return { stream, events, connected, sendWidgetEvent };
}

function cacheKey(moduleId: string, key: string): string {
  return `${moduleId}:${key}`;
}
