// Streamware-side `widgetHost` implementation. The PUBLIC TYPES (the
// contract widget authors target) live in `@woofx3/module-sdk` —
// re-exported below for streamware-internal consumers, but external
// modules pull them from the SDK package directly. This file owns the
// runtime: the `createWidgetHost` factory, the storage cache wiring,
// the upstream-transport callback. Nothing widget-author-facing.
//
// Anything that changes the public WidgetHost interface goes in
// `shared/clients/typescript/module-sdk/src/widget-host.ts` — bumping
// the SDK package version is the right way to communicate the change
// to authors.

export type {
  StorageChangeStream,
  StorageChangedFrame,
  WidgetEvent,
  WidgetEventHandler,
  WidgetEventSource,
  WidgetHost,
  WidgetHostStorage,
  WidgetStatusReport,
} from "@woofx3/module-sdk";

import type {
  StorageChangeStream,
  WidgetEventHandler,
  WidgetEventSource,
  WidgetHost,
  WidgetHostStorage,
  WidgetStatusReport,
} from "@woofx3/module-sdk";

interface CreateWidgetHostOptions {
  moduleId: string;
  instanceId: string;
  widgetCanonicalId?: string;
  settings: Record<string, unknown>;
  stream: StorageChangeStream;
  /**
   * Best-effort transport for status reports. The shell wires this
   * to whatever upstream channel is available (today: the
   * `/ws/module-state` socket on scene overlays, the `/ws/alerts`
   * socket on the alert overlay). When `undefined`, reports are
   * dropped after a single console warning. Never throws.
   */
  sendStatus?: (report: WidgetStatusReport) => void;
  /**
   * Source for downstream-delivered events filtered by this
   * widget's `acceptedEvents`. When `undefined`, the host's
   * `onEvent` is a no-op subscriber (returns an empty unsubscribe).
   * The alert overlay's host omits this — alerts arrive via the
   * queue-driven dispatch path, not the generic event channel.
   */
  events?: WidgetEventSource;
}

/**
 * Build a `WidgetHost` for a single widget instance. The host shares
 * one underlying `StorageChangeStream` across every widget in the
 * scene — fanning out to per-widget callbacks happens here rather
 * than in the transport, so the transport stays a dumb pipe.
 */
export function createWidgetHost(opts: CreateWidgetHostOptions): WidgetHost {
  const { moduleId, instanceId, widgetCanonicalId, settings, stream, sendStatus, events } = opts;
  const frozen = Object.freeze({ ...settings });

  const storage: WidgetHostStorage = {
    async get(key: string): Promise<unknown> {
      const cached = stream.peek(moduleId, key);
      return cached ?? null;
    },
    subscribe(key: string, cb: (value: unknown) => void): () => void {
      // Fire once with the cached value so widgets don't have to
      // call `get()` separately to render the initial state.
      const initial = stream.peek(moduleId, key);
      if (initial !== undefined) {
        queueMicrotask(() => cb(initial));
      }
      return stream.subscribe((frame) => {
        if (frame.moduleId === moduleId && frame.key === key) {
          cb(frame.value);
        }
      });
    },
  };

  function emit(key: string, value: unknown): void {
    if (!sendStatus) {
      console.warn("[widgetHost] reportStatus dropped — no transport wired", {
        moduleId,
        instanceId,
        key,
      });
      return;
    }
    try {
      sendStatus({
        kind: "widget.event",
        moduleId,
        instanceId,
        widgetCanonicalId,
        key,
        value,
        ts: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[widgetHost] reportStatus send failed", {
        moduleId,
        instanceId,
        key,
        error: err,
      });
    }
  }

  return {
    moduleId,
    instanceId,
    settings: frozen,
    storage,
    onEvent(handler: WidgetEventHandler): () => void {
      if (!events) {
        // No transport wired (e.g. the alert overlay's host, which
        // doesn't go through the generic event channel). Returning a
        // no-op unsubscribe keeps widget code path-clean.
        return () => {};
      }
      return events.subscribe(handler);
    },
    reportStatus(key: string, value: unknown): void {
      emit(key, value);
    },
    reportComplete(reason?: string): void {
      emit("complete", reason !== undefined ? { reason } : null);
    },
  };
}
