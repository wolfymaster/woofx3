// Public widget-host contract — the surface every widget bundle sees on
// `window.widgetHost` once the host shell injects it. This file is the
// SINGLE SOURCE OF TRUTH for the contract; streamware (the live host
// implementation) imports these types and provides the runtime
// (`createWidgetHost` factory, the `/ws/module-state` transport, etc.).
//
// External authors install `@woofx3/module-sdk` and reference these types
// from their TS / JS / JSDoc / Lua-via-stub code. Internal modules in
// this monorepo use the same package via the workspace path alias.
//
// Anything in this file is part of the public API surface. Breaking
// changes require a major version bump.

/**
 * Module-storage read surface scoped to the widget's owning module.
 *
 * Backed by streamware's local cache of `module.storage.changed` events,
 * so reads are synchronous (no fetch round-trip) and subscriptions fire
 * with the cached value at attach time when one is known.
 */
export interface WidgetHostStorage {
  /**
   * Resolve to the latest cached value for `key`, or `null` if no value
   * has been seen since the host opened. The host fulfils this from the
   * most recent module-state payload it has observed for
   * `(moduleId, key)`; if none, it returns `null` rather than blocking.
   */
  get(key: string): Promise<unknown>;

  /**
   * Register `cb` for every subsequent change to `(moduleId, key)`.
   * Returns an unsubscribe function. The callback fires once at
   * subscription time with the cached value when one exists, then on
   * every subsequent change.
   */
  subscribe(key: string, cb: (value: unknown) => void): () => void;
}

/**
 * Generic engine-pushed event delivered to the widget via `onEvent`.
 *
 * `type` is the canonical trigger id from the widget's
 * `acceptedEvents` declaration (e.g.
 * `"twitch_platform:trigger:follow.user.twitch"`). The same shape covers
 * every event class — alerts are one example, not a special case.
 */
export interface WidgetEvent {
  /** Canonical trigger id matching one of the widget's `acceptedEvents`. */
  type: string;
  /** CloudEvent source (e.g. `"twitch"`, `"streamware"`). */
  source: string;
  /** RFC3339 timestamp from the underlying CloudEvent. */
  time: string;
  /** Event payload — opaque at this boundary. Widgets parse based on
   *  the documented schema for `type`. */
  data: unknown;
}

export type WidgetEventHandler = (event: WidgetEvent) => void;

/**
 * Per-widget event source the host shell wires up. Multiple widgets in
 * a scene share the underlying transport (the `/ws/module-state`
 * socket) but each gets its own filtered subscription —
 * `acceptedEvents` matching happens upstream of this callback.
 */
export interface WidgetEventSource {
  subscribe(handler: WidgetEventHandler): () => void;
}

/**
 * The injected `window.widgetHost` object — the only API a widget
 * bundle interacts with. The contract is host-agnostic so the same
 * widget code works inside streamware's iframe sandbox, a future
 * Convex-served preview, a tauri shell — anywhere a host implements
 * this interface.
 */
export interface WidgetHost {
  /** Per-instance settings resolved by the scene editor from the
   *  widget's `settingsSchema`. Frozen at load time. */
  readonly settings: Readonly<Record<string, unknown>>;

  /** Module id this widget belongs to. Surfaced so widgets can scope
   *  storage calls without the shell having to bind it. */
  readonly moduleId: string;

  /** Stable per-placement instance id from `WidgetInstance.id`.
   *  Carried on every status report so the engine / dashboard can
   *  identify which widget on which scene fired. */
  readonly instanceId: string;

  /** Persistent module-storage surface. */
  readonly storage: WidgetHostStorage;

  /**
   * Subscribe to engine-pushed events the widget declared interest in
   * via its manifest's `acceptedEvents[]`. The handler fires for every
   * matching event. Returns an unsubscribe function.
   */
  onEvent(handler: WidgetEventHandler): () => void;

  /**
   * Report a per-widget status update — counters, timer state, goal
   * progress, anything the widget wants to surface to the engine and
   * dashboard. Best-effort: silently dropped when no transport is
   * wired, never throws.
   *
   * Convention: `key` is a short identifier the widget owns
   * (`"count"`, `"goalReached"`, `"elapsedSeconds"`); `value` is any
   * JSON-serialisable payload. Each call produces one
   * `WIDGET_STATUS_CHANGED` webhook and one upsert into the engine's
   * `widget_status` table.
   */
  reportStatus(key: string, value: unknown): void;

  /**
   * Sugar over `reportStatus("complete", { reason })`. Use when a
   * widget reaches a terminal state (goal hit, timer expired) and the
   * dashboard wants to react.
   */
  reportComplete(reason?: string): void;
}

// ── Host-side types (for embedders, not widget authors) ──────────────
//
// The interfaces below are exported because streamware (the live host
// implementation) consumes them from this package. Widget authors
// generally don't need them — `WidgetHost` is enough.

/**
 * Stream of `module.storage.changed` events that the host shell
 * consumes to populate per-widget storage subscriptions.
 */
export interface StorageChangeStream {
  subscribe(cb: (payload: StorageChangedFrame) => void): () => void;
  peek(moduleId: string, key: string): unknown;
}

export interface StorageChangedFrame {
  moduleId: string;
  key: string;
  value: unknown;
}

/**
 * Wire-format payload the host sends through the upstream transport on
 * every `reportStatus` / `reportComplete`. Streamware's
 * `publishWidgetEvent` helper republishes onto NATS `widget.event`.
 */
export interface WidgetStatusReport {
  kind: "widget.event";
  moduleId: string;
  instanceId: string;
  /** Canonical widget definition id, when known. */
  widgetCanonicalId?: string;
  /** Optional explicit applicationId; the orchestrator falls back to
   *  its warmed default when absent. */
  applicationId?: string;
  key: string;
  value: unknown;
  ts?: string;
}

/**
 * Globally augment `window.widgetHost` so widget bundles that import
 * this module (or reference it via JSDoc) get autocompletion on the
 * injected global without explicit casts.
 *
 * To opt out (e.g. when writing host code that knows the host hasn't
 * injected yet), declare your own narrower type at the call site.
 */
declare global {
  interface Window {
    widgetHost?: WidgetHost;
  }
}
