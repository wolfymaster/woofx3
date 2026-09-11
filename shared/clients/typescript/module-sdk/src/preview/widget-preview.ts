// Mock `widgetHost` implementation for offline widget development.
//
// Widget authors can install it inside their own bundle for unit tests
// (`createMockHost(...).install()`), or use the bundled
// `widget-preview.html` harness (which loads any widget URL with this
// shim already wired up).
//
// The contract surface mirrors the real `createWidgetHost` factory in
// `streamware/ui/src/lib/widgetHost.ts` exactly — same storage cache
// semantics, same event delivery shape, same fire-on-subscribe
// behaviour. A widget that runs against this mock behaves identically
// against streamware (sans the WS reconnect / persistence side
// effects).

import type {
  DeliveredWidgetEvent,
  WidgetEvent,
  WidgetEventHandler,
  WidgetHost,
  WidgetHostStorage,
  WidgetStatusReport,
} from "../widget-host";
import type { EventQueueConfig } from "../widget-protocol";

export interface MockHostOptions {
  /** Module id surfaced as `widgetHost.moduleId`. */
  moduleId?: string;
  /** Stable instance id surfaced as `widgetHost.instanceId`. */
  instanceId?: string;
  /** Frozen settings object surfaced as `widgetHost.settings`. */
  settings?: Record<string, unknown>;
  /** Initial storage cache: `{ "<moduleId>:<key>": value }` or
   *  `{ "<key>": value }` (the moduleId from `opts.moduleId` is
   *  prepended automatically when the key has no `:`). */
  storage?: Record<string, unknown>;
  /** Base URL `getResourceUrl` resolves paths against. */
  resourceBaseUrl?: string;
}

/** `fireEvent` input — `eventId` is optional; the mock assigns one
 *  when omitted so existing call sites (and widget authors' own
 *  tests) don't need to supply it. */
export type MockFireEventInput = Omit<WidgetEvent, "eventId"> & { eventId?: string };

export interface MockHostController {
  /** The injected host object. Pass to your widget's bootstrap or call
   *  `.install()` to assign onto `window.widgetHost`. */
  readonly host: WidgetHost;

  /**
   * Inject a `WidgetEvent` as if it arrived via `onEvent`. Synchronous
   * — every subscribed handler fires before the call returns. `eventId`
   * is optional; the mock assigns one when omitted. The delivered
   * event's `complete()` is a no-op — this mock doesn't simulate queue
   * timing/retry, only delivery.
   */
  fireEvent(event: MockFireEventInput): void;

  /**
   * Mutate a storage key. Fires every `storage.subscribe` callback
   * registered for `(moduleId, key)`. Use a colon-prefixed key to
   * write into a different module's storage namespace.
   */
  setStorage(key: string, value: unknown): void;

  /**
   * Tap into `reportStatus` and `reportComplete` calls — the harness
   * uses this to render the live console panel; tests can use it for
   * assertions. Returns an unsubscribe.
   */
  onReport(handler: (report: WidgetStatusReport) => void): () => void;

  /**
   * Replace `globalThis.window.widgetHost` with the mock. Returns an
   * uninstall function that restores the previous value. Safe to call
   * multiple times — each call replaces the prior install.
   */
  install(): () => void;

  /** Drop all subscribers + clear storage. Useful between tests. */
  reset(): void;
}

interface StorageSubscription {
  key: string;
  cb: (value: unknown) => void;
}

const SCOPED_KEY_RE = /^[^:]+:[^:].*$/;

function scope(moduleId: string, key: string): string {
  return SCOPED_KEY_RE.test(key) ? key : `${moduleId}:${key}`;
}

export function createMockHost(opts: MockHostOptions = {}): MockHostController {
  const moduleId = opts.moduleId ?? "preview";
  const instanceId = opts.instanceId ?? `${moduleId}-preview`;
  const settings = Object.freeze({ ...(opts.settings ?? {}) });

  const cache = new Map<string, unknown>();
  if (opts.storage) {
    for (const [k, v] of Object.entries(opts.storage)) {
      cache.set(scope(moduleId, k), v);
    }
  }
  const storageSubs = new Set<StorageSubscription>();
  const eventSubs = new Set<{ handler: WidgetEventHandler; queue?: EventQueueConfig }>();
  const reportSubs = new Set<(r: WidgetStatusReport) => void>();
  const resourceBaseUrl = opts.resourceBaseUrl ?? "https://preview.local/resources";
  let nextMockEventId = 0;

  const storage: WidgetHostStorage = {
    async get(key: string): Promise<unknown> {
      return cache.has(scope(moduleId, key)) ? cache.get(scope(moduleId, key)) : null;
    },
    subscribe(key: string, cb: (value: unknown) => void): () => void {
      const sub: StorageSubscription = { key, cb };
      storageSubs.add(sub);
      // Mirror the real factory's fire-on-subscribe behaviour: if a
      // value is already cached, deliver it on the next microtask.
      const cached = cache.get(scope(moduleId, key));
      if (cached !== undefined) {
        queueMicrotask(() => cb(cached));
      }
      return () => {
        storageSubs.delete(sub);
      };
    },
  };

  function emitReport(key: string, value: unknown): void {
    const report: WidgetStatusReport = {
      kind: "widget.event",
      moduleId,
      instanceId,
      key,
      value,
      ts: new Date().toISOString(),
    };
    for (const fn of reportSubs) {
      try {
        fn(report);
      } catch (err) {
        console.error("[mock-host] report subscriber threw", err);
      }
    }
  }

  const host: WidgetHost = {
    moduleId,
    instanceId,
    settings,
    storage,
    getResourceUrl(path: string): string {
      return resourceBaseUrl.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
    },
    onEvent(handler: WidgetEventHandler, queue?: EventQueueConfig): () => void {
      const sub = { handler, queue };
      eventSubs.add(sub);
      return () => {
        eventSubs.delete(sub);
      };
    },
    reportStatus(key: string, value: unknown): void {
      emitReport(key, value);
    },
    reportComplete(reason?: string): void {
      emitReport("complete", reason !== undefined ? { reason } : null);
    },
  };

  let installed: { previous: WidgetHost | undefined } | null = null;

  return {
    host,
    fireEvent(event: MockFireEventInput): void {
      const eventId = event.eventId && event.eventId.length > 0 ? event.eventId : `mock-evt-${++nextMockEventId}`;
      const delivered: DeliveredWidgetEvent = {
        ...event,
        eventId,
        // This mock simulates delivery, not queue timing/retry — complete()
        // is a no-op rather than a real acknowledgement.
        complete: () => {},
      };
      for (const sub of eventSubs) {
        try {
          sub.handler(delivered);
        } catch (err) {
          console.error("[mock-host] event subscriber threw", err);
        }
      }
    },
    setStorage(key: string, value: unknown): void {
      const scoped = scope(moduleId, key);
      cache.set(scoped, value);
      // Fire matching subscribers. The bare-key check matches the real
      // factory's filter (it scopes by the host's own moduleId and
      // matches the bare key the widget passed to .subscribe).
      const bareKey = scoped.startsWith(`${moduleId}:`) ? scoped.slice(moduleId.length + 1) : scoped;
      for (const sub of storageSubs) {
        if (sub.key === bareKey) {
          try {
            sub.cb(value);
          } catch (err) {
            console.error("[mock-host] storage subscriber threw", err);
          }
        }
      }
    },
    onReport(handler: (r: WidgetStatusReport) => void): () => void {
      reportSubs.add(handler);
      return () => {
        reportSubs.delete(handler);
      };
    },
    install(): () => void {
      // Tolerate non-browser environments by falling back to a synthetic
      // global. In tests, callers typically pre-seed `globalThis.window`
      // themselves; in the browser this is a no-op.
      const g = globalThis as { window?: Window & { widgetHost?: WidgetHost } };
      if (!g.window) {
        (g as Record<string, unknown>).window = {} as Window & {
          widgetHost?: WidgetHost;
        };
      }
      const win = g.window as Window & { widgetHost?: WidgetHost };
      if (!installed) {
        installed = { previous: win.widgetHost };
      }
      win.widgetHost = host;
      return () => {
        if (installed) {
          win.widgetHost = installed.previous;
          installed = null;
        }
      };
    },
    reset(): void {
      cache.clear();
      storageSubs.clear();
      eventSubs.clear();
      reportSubs.clear();
    },
  };
}
