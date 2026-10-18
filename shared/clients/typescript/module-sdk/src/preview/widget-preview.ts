// Mock `widgetHost` implementation for offline widget development.
//
// Widget authors can install it inside their own bundle for unit tests
// (`createMockHost(...).install()`), or use the bundled
// `widget-preview.html` harness (which loads any widget URL with this
// shim already wired up).
//
// It behaves as a widget's host does on stream: the widget host shim talking
// to the scene manager's overlay page. Storage is seen only once watched, a
// placement's events go through one queue with the subscription's policy,
// and asset reads are judged as the engine judges them. The scene manager's
// contract suite (sceneManager/tests/widget-host-contract) runs the same
// cases against this mock and against the shim and page, so the two cannot
// drift apart unnoticed. What it leaves out is the network: no reconnects,
// no redelivery, no queue timeouts, and no `priorityExpr` ordering.

import type {
  DeliveredWidgetEvent,
  WidgetAsset,
  WidgetEvent,
  WidgetEventHandler,
  WidgetHost,
  WidgetHostAssets,
  WidgetHostStorage,
  WidgetStatusReport,
} from "../widget-host";
import {
  WidgetAssetError,
  assetRefUrl,
  createWidgetAsset,
  parseEngineAssetPath,
  widgetMayRead,
} from "../widget-assets";
import { type EventQueueConfig, WIDGET_CAPABILITIES, type WidgetCapability } from "../widget-protocol";

/** Re-exported so the preview harness can apply a widget's setting bindings
 *  the way the widget host shim does. */
export { applySettingBindings } from "../widget-bindings";

export interface MockHostOptions {
  /** Module id surfaced as `widgetHost.moduleId`. */
  moduleId?: string;
  /** `widgetHost.capabilities`; every capability by default. */
  capabilities?: readonly WidgetCapability[];
  /** Stable instance id surfaced as `widgetHost.instanceId`. */
  instanceId?: string;
  /** Frozen settings object surfaced as `widgetHost.settings`. */
  settings?: Record<string, unknown>;
  /** Where the mocked widget runs; defaults to a scene. */
  surface?: WidgetHost["surface"];
  /** Theme surfaced as `widgetHost.theme`; defaults to `null`, a widget
   *  without a theme contract. */
  theme?: WidgetHost["theme"];
  /** Surfaced as `widgetHost.linkedResources`; defaults to none. */
  linkedResources?: Record<string, string>;
  /** What the engine holds in module storage: `{ "<moduleId>:<key>": value }`
   *  or `{ "<key>": value }` (the moduleId from `opts.moduleId` is
   *  prepended automatically when the key has no `:`). As on stream, the
   *  host has seen a key only once the widget subscribes to it. Ignored
   *  without the `storage` capability, as a frame given no storage sees none. */
  storage?: Record<string, unknown>;
  /** Base URL `getResourceUrl` resolves paths against. */
  resourceBaseUrl?: string;
  /**
   * Files `assets.load` answers with, by the reference the widget passes
   * (a path relative to `resourceBaseUrl`, or a URL): text, or raw bytes.
   * A reference not listed here is fetched from where it resolves to.
   *
   * Either way the reference is judged as the engine judges it: one under
   * `resourceBaseUrl` is the widget's own module's file, as it is in a real
   * frame, any other must be an engine asset path the widget may read
   * (`/assets/user/...`, or its own `/assets/modules/{moduleId}/...`), and
   * anything else is refused, so a widget that loads in the preview loads
   * on stream.
   */
  assets?: Record<string, string | ArrayBuffer>;
  /** How a file not in `assets` is fetched; the global `fetch` by default. */
  fetchFn?: (url: string) => Promise<Response>;
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
   * An event for this placement arrives, as the overlay would hand it to the
   * widget: to the newest `onEvent` subscription only, through its queue
   * (`maxInFlight` open at once, completed when the handler returns unless
   * `autoComplete` is false, and when it throws). An event id already
   * delivered is dropped, and an event with no subscription to take it is
   * lost. `eventId` is optional; the mock assigns one when omitted.
   */
  fireEvent(event: MockFireEventInput): void;

  /**
   * Change a storage key on the engine. Fires every `storage.subscribe`
   * callback registered for `(moduleId, key)`. Use a colon-prefixed key to
   * write into a different module's storage namespace.
   */
  setStorage(key: string, value: unknown): void;

  /**
   * Replace the settings, as a streamer editing them in the scene editor
   * would: `host.settings` changes and every `onSettingsChange` handler
   * runs. The harness applies the setting bindings to the widget's document
   * itself.
   */
  setSettings(settings: Record<string, unknown>): void;

  /**
   * Tap into `reportStatus` and `reportComplete` calls — the harness
   * uses this to render the live console panel; tests can use it for
   * assertions. Returns an unsubscribe.
   */
  onReport(handler: (report: WidgetStatusReport) => void): () => void;

  /** Tap into the events the widget completes, by id. Returns an unsubscribe. */
  onComplete(handler: (eventId: string) => void): () => void;

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

interface EventSubscription {
  handler: WidgetEventHandler;
  queue: EventQueueConfig;
}

/** How many delivered event ids the mock remembers to drop repeats, as the overlay does. */
const REMEMBERED_EVENTS = 256;

const SCOPED_KEY_RE = /^[^:]+:[^:].*$/;

function scope(moduleId: string, key: string): string {
  return SCOPED_KEY_RE.test(key) ? key : `${moduleId}:${key}`;
}

export function createMockHost(opts: MockHostOptions = {}): MockHostController {
  const moduleId = opts.moduleId ?? "preview";
  const instanceId = opts.instanceId ?? `${moduleId}-preview`;
  const capabilities: readonly WidgetCapability[] = Object.freeze([...(opts.capabilities ?? WIDGET_CAPABILITIES)]);
  const hasStorage = capabilities.includes("storage");
  let settings: Readonly<Record<string, unknown>> = Object.freeze({ ...(opts.settings ?? {}) });

  // What the engine holds, and what of it the host has seen: a key is seen
  // once the widget subscribes to it, as the overlay loads a key only then.
  const engineStorage = new Map<string, unknown>();
  const seen = new Map<string, unknown>();
  if (opts.storage && hasStorage) {
    for (const [k, v] of Object.entries(opts.storage)) {
      engineStorage.set(scope(moduleId, k), v);
    }
  }
  const storageSubs = new Set<StorageSubscription>();
  const reportSubs = new Set<(r: WidgetStatusReport) => void>();
  const completeSubs = new Set<(eventId: string) => void>();
  const settingsSubs = new Set<(settings: Readonly<Record<string, unknown>>) => void>();
  const resourceBaseUrl = opts.resourceBaseUrl ?? "https://preview.local/resources";
  const fetchFn = opts.fetchFn ?? ((url: string) => fetch(url));
  let nextMockEventId = 0;

  // The placement's one queue: the overlay keeps a queue for the newest
  // subscription only, so a second `onEvent` takes the events from the first.
  let current: EventSubscription | null = null;
  const pending: DeliveredWidgetEvent[] = [];
  const inFlight = new Set<string>();
  const known = new Set<string>();

  function remember(eventId: string): void {
    known.add(eventId);
    if (known.size > REMEMBERED_EVENTS) {
      known.delete(known.values().next().value as string);
    }
  }

  function notifyStorage(scoped: string, value: unknown): void {
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
  }

  const storage: WidgetHostStorage = {
    get(key: string): Promise<unknown> {
      if (typeof key !== "string" || key.length === 0) {
        throw new Error("[mock-host] storage.get requires a non-empty key");
      }
      return Promise.resolve(seen.get(scope(moduleId, key)) ?? null);
    },
    subscribe(key: string, cb: (value: unknown) => void): () => void {
      if (typeof key !== "string" || key.length === 0) {
        throw new Error("[mock-host] storage.subscribe requires a non-empty key");
      }
      if (typeof cb !== "function") {
        throw new Error("[mock-host] storage.subscribe requires a callback");
      }
      if (!hasStorage) {
        return () => {};
      }
      const sub: StorageSubscription = { key, cb };
      storageSubs.add(sub);
      const scoped = scope(moduleId, key);
      // Called back with what the engine holds, null included, once it is
      // read: on stream that is a fetch away, never synchronous.
      queueMicrotask(() => {
        if (!storageSubs.has(sub)) {
          return;
        }
        const value = engineStorage.get(scoped) ?? null;
        seen.set(scoped, value);
        try {
          cb(value);
        } catch (err) {
          console.error("[mock-host] storage subscriber threw", err);
        }
      });
      return () => {
        storageSubs.delete(sub);
      };
    },
  };

  /** Where `refUrl` is read from, or the refusal a real frame would get for it. */
  function readableAssetUrl(refUrl: string): URL {
    const base = resourceBaseUrl.replace(/\/*$/, "/");
    let url: URL;
    try {
      url = new URL(refUrl, base);
    } catch {
      throw new WidgetAssetError("not_engine_asset", refUrl);
    }
    if (url.href.startsWith(base)) {
      return url;
    }
    const asset = url.protocol === "http:" || url.protocol === "https:" ? parseEngineAssetPath(url.pathname) : null;
    if (asset === null) {
      throw new WidgetAssetError("not_engine_asset", refUrl);
    }
    if (!widgetMayRead(asset, moduleId)) {
      throw new WidgetAssetError("out_of_scope", refUrl);
    }
    return url;
  }

  const assets: WidgetHostAssets = {
    async load(ref: string | { url: string }): Promise<WidgetAsset> {
      const refUrl = assetRefUrl(ref);
      if (refUrl === null) {
        throw new WidgetAssetError("not_engine_asset", typeof ref === "string" ? ref : "");
      }
      const url = readableAssetUrl(refUrl);
      const given = opts.assets?.[refUrl];
      if (given !== undefined) {
        const bytes = typeof given === "string" ? new TextEncoder().encode(given).buffer : given;
        return createWidgetAsset(url.pathname, "", bytes as ArrayBuffer);
      }
      let response: Response;
      try {
        response = await fetchFn(url.href);
      } catch (err) {
        throw new WidgetAssetError("unavailable", refUrl, err instanceof Error ? err.message : String(err));
      }
      if (!response.ok) {
        throw new WidgetAssetError(response.status === 404 ? "not_found" : "unavailable", refUrl);
      }
      return createWidgetAsset(url.pathname, response.headers.get("Content-Type") ?? "", await response.arrayBuffer());
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

  function complete(eventId: string): void {
    if (!inFlight.delete(eventId)) {
      return;
    }
    for (const fn of completeSubs) {
      try {
        fn(eventId);
      } catch (err) {
        console.error("[mock-host] complete subscriber threw", err);
      }
    }
    pump();
  }

  function pump(): void {
    while (current !== null && pending.length > 0 && inFlight.size < (current.queue.maxInFlight ?? 1)) {
      const event = pending.shift()!;
      const sub = current;
      inFlight.add(event.eventId);
      try {
        sub.handler(event);
      } catch (err) {
        // As on stream: a handler that throws will never complete the event
        // itself, and every later event would wait behind it.
        console.error("[mock-host] event subscriber threw; completing the event", err);
        complete(event.eventId);
        continue;
      }
      if (sub.queue.autoComplete !== false) {
        complete(event.eventId);
      }
    }
  }

  const host: WidgetHost = {
    surface: opts.surface ?? "scene",
    theme: opts.theme ?? null,
    linkedResources: Object.freeze({ ...(opts.linkedResources ?? {}) }),
    moduleId,
    instanceId,
    capabilities,
    get settings() {
      return settings;
    },
    storage,
    assets,
    getResourceUrl(path: string): string {
      return resourceBaseUrl.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
    },
    onEvent(handler: WidgetEventHandler, queue?: EventQueueConfig): () => void {
      if (typeof handler !== "function") {
        throw new Error("[mock-host] onEvent requires a handler function");
      }
      const sub: EventSubscription = { handler, queue: queue ?? {} };
      current = sub;
      pump();
      return () => {
        if (current === sub) {
          current = null;
        }
      };
    },
    onSettingsChange(handler: (settings: Readonly<Record<string, unknown>>) => void): () => void {
      if (typeof handler !== "function") {
        throw new Error("[mock-host] onSettingsChange requires a handler function");
      }
      settingsSubs.add(handler);
      return () => {
        settingsSubs.delete(handler);
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
      if (current === null || known.has(eventId)) {
        return;
      }
      remember(eventId);
      pending.push({ ...event, eventId, complete: () => complete(eventId) });
      pump();
    },
    setStorage(key: string, value: unknown): void {
      const scoped = scope(moduleId, key);
      engineStorage.set(scoped, value);
      if (hasStorage && seen.has(scoped)) {
        seen.set(scoped, value);
        notifyStorage(scoped, value);
      }
    },
    setSettings(next: Record<string, unknown>): void {
      settings = Object.freeze({ ...next });
      for (const handler of [...settingsSubs]) {
        try {
          handler(settings);
        } catch (err) {
          console.error("[mock-host] settings handler threw", err);
        }
      }
    },
    onReport(handler: (r: WidgetStatusReport) => void): () => void {
      reportSubs.add(handler);
      return () => {
        reportSubs.delete(handler);
      };
    },
    onComplete(handler: (eventId: string) => void): () => void {
      completeSubs.add(handler);
      return () => {
        completeSubs.delete(handler);
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
      engineStorage.clear();
      seen.clear();
      storageSubs.clear();
      reportSubs.clear();
      completeSubs.clear();
      settingsSubs.clear();
      current = null;
      pending.length = 0;
      inFlight.clear();
      known.clear();
    },
  };
}
