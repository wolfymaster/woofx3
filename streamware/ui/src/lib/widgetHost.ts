// Contract injected onto `window.widgetHost` inside every widget iframe.
//
// Widget authors target this surface — `settings`, `storage.get`,
// `storage.subscribe` — and the streamware shell wires the actual
// transport (WebSocket -> /ws/module-state, in-memory cache, etc.)
// underneath without the widget ever knowing.
//
// Convex-served widgets are expected to expose the same shape with
// their own implementation. Keeping the contract host-agnostic means
// the same widget bundle works in both.

export interface WidgetHostStorage {
  /** Resolve to the latest cached value for `key`, or `null` if no
   *  value has been seen since the host opened. The host fulfils
   *  this from the most recent module-state payload it has observed
   *  for `(moduleId, key)`; if none, it falls back to `null` rather
   *  than blocking on a fetch. */
  get(key: string): Promise<unknown>;

  /** Register `cb` for every subsequent change to `(moduleId, key)`.
   *  Returns an unsubscribe function. The callback fires synchronously
   *  with the current value at subscription time when one is cached. */
  subscribe(key: string, cb: (value: unknown) => void): () => void;
}

export interface WidgetHost {
  /** Per-instance settings resolved by the scene editor. Frozen at
   *  load time — settings changes today require a widget reload (the
   *  Convex spec calls this out as out-of-scope for v1). */
  readonly settings: Readonly<Record<string, unknown>>;

  /** Module id this widget belongs to — same as
   *  `WidgetInstance.moduleId`. Surfaced so widgets can scope their
   *  storage calls without the shell having to bind it. */
  readonly moduleId: string;

  /** Persistent module-storage surface. */
  readonly storage: WidgetHostStorage;
}

/**
 * Stream of `module.storage.changed` events the host consumes — same
 * shape as `StorageChangedPayload` in `../types`, narrowed to what
 * the host actually reads.
 */
export interface StorageChangeStream {
  /** Subscribe to every storage change the stream surfaces. The host
   *  filters by `(moduleId, key)` before invoking widget callbacks.
   *  Returns an unsubscribe function. */
  subscribe(cb: (payload: StorageChangedFrame) => void): () => void;

  /** Latest value the stream has seen for `(moduleId, key)`, or
   *  `undefined` if none. Used by `widgetHost.storage.get` to fulfill
   *  the contract without a separate REST round-trip. */
  peek(moduleId: string, key: string): unknown;
}

export interface StorageChangedFrame {
  moduleId: string;
  key: string;
  value: unknown;
}

interface CreateWidgetHostOptions {
  moduleId: string;
  settings: Record<string, unknown>;
  stream: StorageChangeStream;
}

/**
 * Build a `WidgetHost` for a single widget instance. The host shares
 * one underlying `StorageChangeStream` across every widget in the
 * scene — fanning out to per-widget callbacks happens here rather
 * than in the transport, so the transport stays a dumb pipe.
 */
export function createWidgetHost(opts: CreateWidgetHostOptions): WidgetHost {
  const { moduleId, settings, stream } = opts;
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

  return {
    moduleId,
    settings: frozen,
    storage,
  };
}
