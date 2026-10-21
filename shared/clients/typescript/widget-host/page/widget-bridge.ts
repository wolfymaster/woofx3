// P1 parent-side bridge — one `WidgetBridge` manages one sandboxed
// widget iframe: the handshake, storage, status reports, the widget's
// event subscriptions with their dispatch policy (see event-queue.ts),
// completions, settings and behaviors.
//
// The bridge validates every inbound postMessage against the iframe's
// `contentWindow` identity AND the per-frame CSPRNG nonce; messages
// failing either check are silently dropped.
//
// Module storage (`storage.get`/`storage.subscribe`) is answered by the
// overlay page's ModuleStateCache (the scene manager's module-state.ts) for scene placements, through
// the `storage` callbacks. Alert and preview widgets are given none: their
// `init` leaves "storage" out, `storage.get` answers `null`, and
// subscriptions never fire. Which module's storage is read is the page's
// decision, from the scene record; the bridge never sees a module id.
//
// File reads (`asset.load`) are answered by the page's AssetCache
// (asset-loader.ts), limited to what the frame's module may read.

import {
  type EventQueueConfig,
  type HostToWidgetMessage,
  PROTOCOL_VERSION,
  parseWidgetToHostMessage,
  WIDGET_PROTOCOL,
  type WidgetBehaviorState,
  type WidgetCapability,
  type WidgetEvent,
  type WidgetMessageBody,
} from "@woofx3/module-sdk";
import { AssetLoadError, type LoadedAsset } from "./asset-loader";
import { BROWSER_HOST, type PageLog } from "./page-host";

/**
 * A widget's `status.report`. It names no module, and nothing a frame says
 * could be trusted to: whoever posts the report adds the module from the
 * scene record it mounted the frame from.
 */
export interface WidgetStatusReportPayload {
  instanceId: string;
  widgetCanonicalId?: string;
  key: string;
  value: unknown;
  ts: string;
}

/** The module storage a frame reads, by key; the page knows whose storage it is. */
export interface WidgetStorageAccess {
  /** The value the page holds for `key`, or null. */
  get(key: string): unknown;
  /** The frame wants `key`'s changes (sent through `sendStorageValue`). */
  subscribe(key: string): void;
  unsubscribe(key: string): void;
}

export interface WidgetBridgeCallbacks {
  /** Module storage; absent where widgets get none, and then the frame is told so. */
  storage?: WidgetStorageAccess;
  onStatusReport(report: WidgetStatusReportPayload): void;
  /** Read a file the widget asked for; rejects with an `AssetLoadError` saying why not. */
  onAssetLoad(path: string): Promise<LoadedAsset>;
  /** Widget opened an event subscription, optionally with a queue
   *  dispatch policy — "the widget registers itself." */
  onEventsSubscribe(subId: string, queue: EventQueueConfig | undefined): void;
  onEventsUnsubscribe(subId: string): void;
  /** Widget acked completion of a delivered event. */
  onEventComplete(subId: string, eventId: string): void;
  onDispose(): void;
  /** The frame has painted (the shim's `rendered`). */
  onRendered?(): void;
}

export class WidgetBridge {
  private iframe: HTMLIFrameElement | null = null;
  private initialized = false;

  // The frame's storage subscriptions: key -> its subIds, and back.
  private readonly shimStorageSubs = new Map<string, Set<string>>();
  private readonly shimSubToKey = new Map<string, string>();
  // The frame's open event subscriptions, so sendEvent delivers only to one
  // that exists.
  private readonly shimEventSubs = new Set<string>();
  // The settings the widget's script has read (`settings.reads`). A change
  // to one of these needs a fresh frame; any other is patched in.
  private readonly readKeys = new Set<string>();
  private readAll = false;
  // The widget redraws itself on every change (`onSettingsChange`): whatever
  // it read, every change is patched in.
  private handlesChanges = false;
  // Bumped whenever the frame's document goes away, so a file read for the
  // old document is never answered into its successor, whose request ids
  // start over.
  private documentGeneration = 0;

  constructor(
    private readonly instanceId: string,
    private readonly nonce: string,
    private readonly callbacks: WidgetBridgeCallbacks,
    private readonly log: PageLog = BROWSER_HOST.log
  ) {}

  attach(iframe: HTMLIFrameElement): void {
    this.iframe = iframe;
  }

  onFrameLoad(): void {
    this.documentGeneration += 1;
    this.initialized = false;
    this.readKeys.clear();
    this.readAll = false;
    this.handlesChanges = false;
    this.shimStorageSubs.clear();
    this.shimSubToKey.clear();
    this.shimEventSubs.clear();
  }

  handleMessage(event: MessageEvent): void {
    if (!this.iframe || event.source !== this.iframe.contentWindow) {
      return;
    }
    const msg = parseWidgetToHostMessage(event.data, this.nonce);
    if (msg === null) {
      return;
    }
    if (msg.type === "hello") {
      if (msg.v !== PROTOCOL_VERSION) {
        this.sendReject(`unsupported protocol version ${msg.v}`);
        return;
      }
      this.initialized = true;
      this.sendInit({});
      return;
    }
    if (msg.type === "rendered") {
      this.callbacks.onRendered?.();
      return;
    }
    if (!this.initialized) {
      return;
    }
    const storage = this.callbacks.storage;
    switch (msg.type) {
      case "storage.get": {
        this.post({ type: "storage.value", id: msg.id, key: msg.key, value: storage ? storage.get(msg.key) : null });
        return;
      }
      case "storage.subscribe": {
        if (!storage) {
          return;
        }
        let subIds = this.shimStorageSubs.get(msg.key);
        if (!subIds) {
          subIds = new Set();
          this.shimStorageSubs.set(msg.key, subIds);
        }
        subIds.add(msg.subId);
        this.shimSubToKey.set(msg.subId, msg.key);
        storage.subscribe(msg.key);
        return;
      }
      case "storage.unsubscribe": {
        const key = this.shimSubToKey.get(msg.subId);
        if (!storage || key === undefined) {
          return;
        }
        this.shimSubToKey.delete(msg.subId);
        const subIds = this.shimStorageSubs.get(key);
        subIds?.delete(msg.subId);
        if (subIds?.size === 0) {
          this.shimStorageSubs.delete(key);
        }
        storage.unsubscribe(key);
        return;
      }
      case "asset.load": {
        this.answerAssetLoad(msg.id, msg.path);
        return;
      }
      case "events.subscribe": {
        this.shimEventSubs.add(msg.subId);
        this.callbacks.onEventsSubscribe(msg.subId, msg.queue);
        return;
      }
      case "events.unsubscribe": {
        this.shimEventSubs.delete(msg.subId);
        this.callbacks.onEventsUnsubscribe(msg.subId);
        return;
      }
      case "event.complete": {
        this.callbacks.onEventComplete(msg.subId, msg.eventId);
        return;
      }
      case "settings.reads": {
        if (msg.handles) {
          this.handlesChanges = true;
          this.readAll = false;
          this.readKeys.clear();
          return;
        }
        if (this.handlesChanges) {
          return;
        }
        if (msg.all) {
          this.readAll = true;
        }
        for (const key of msg.keys) {
          this.readKeys.add(key);
        }
        return;
      }
      case "status.report": {
        this.callbacks.onStatusReport({
          instanceId: this.instanceId,
          key: msg.key,
          value: msg.value,
          ts: msg.ts === "" ? new Date().toISOString() : msg.ts,
        });
        return;
      }
      default:
        return;
    }
  }

  /** What this frame is given: storage only where the page supplies it. */
  capabilities(): WidgetCapability[] {
    const given: WidgetCapability[] = ["events", "status", "settings", "assets"];
    return this.callbacks.storage ? ["storage", ...given] : given;
  }

  sendInit(settings: Record<string, unknown>): void {
    this.post({ type: "init", settings, capabilities: this.capabilities() });
  }

  sendReject(reason: string): void {
    this.post({
      type: "init.reject",
      reason,
      supportedVersions: [PROTOCOL_VERSION],
    });
  }

  /** Deliver a new value for `key` to the frame's subscriptions to it. */
  sendStorageValue(key: string, value: unknown): void {
    if (!this.initialized) {
      return;
    }
    const occurredAt = new Date().toISOString();
    for (const subId of this.shimStorageSubs.get(key) ?? []) {
      this.post({ type: "storage.changed", subId, key, value, occurredAt });
    }
  }

  /** Deliver one event to a specific open subscription. Returns
   *  `false` (and drops the delivery) if the bridge isn't initialized
   *  or that `subId` isn't currently open — callers use this to know
   *  whether to hold the delivery for retry. */
  sendEvent(subId: string, event: WidgetEvent): boolean {
    if (!this.initialized || !this.shimEventSubs.has(subId)) {
      return false;
    }
    this.post({ type: "event.deliver", subId, event });
    return true;
  }

  /**
   * The settings the widget's script has read, or null before its handshake,
   * when nothing about it is known yet.
   */
  settingsReads(): { all: boolean; keys: ReadonlySet<string> } | null {
    return this.initialized ? { all: this.readAll, keys: this.readKeys } : null;
  }

  /** Hand the widget new settings, which its shim applies through its bindings. */
  sendSettings(settings: Record<string, unknown>): void {
    if (this.initialized) {
      this.post({ type: "settings.changed", settings });
    }
  }

  /**
   * Have the widget play one of its own behaviors from now, or clear them
   * all (`null`). Sent whether or not the handshake is done: the shim marks
   * its document as soon as it hears it.
   */
  sendBehavior(behavior: WidgetBehaviorState | null): void {
    this.post({ type: "behavior", behavior });
  }

  dispose(): void {
    this.post({ type: "dispose", reason: "scene-manager-dispose" });
    this.callbacks.onDispose();
  }

  detach(): void {
    this.documentGeneration += 1;
    this.iframe = null;
    this.initialized = false;
    this.readKeys.clear();
    this.readAll = false;
    this.handlesChanges = false;
    this.shimStorageSubs.clear();
    this.shimSubToKey.clear();
    this.shimEventSubs.clear();
  }

  private answerAssetLoad(id: string, path: string): void {
    const generation = this.documentGeneration;
    this.callbacks.onAssetLoad(path).then(
      (asset) => {
        if (generation === this.documentGeneration) {
          // Posted as a copy, never transferred: the page's cache keeps the
          // original for the next widget that asks.
          this.post({ type: "asset.value", id, contentType: asset.contentType, bytes: asset.bytes });
        }
      },
      (err: unknown) => {
        if (!(err instanceof AssetLoadError)) {
          this.log.warn("[scene-manager] asset load failed unexpectedly", { path }, err);
        }
        if (generation === this.documentGeneration) {
          this.post({ type: "asset.error", id, code: err instanceof AssetLoadError ? err.code : "unavailable" });
        }
      }
    );
  }

  private post(payload: WidgetMessageBody<HostToWidgetMessage>): void {
    const win = this.iframe?.contentWindow;
    if (!win) {
      return;
    }
    win.postMessage(
      {
        proto: WIDGET_PROTOCOL,
        v: PROTOCOL_VERSION,
        nonce: this.nonce,
        ...payload,
      },
      "*"
    );
  }
}

/**
 * `load` handler for a widget iframe. The FIRST `load` fires once the
 * initial document (and its subresources) finish — by which point the
 * shim has already sent `hello` and the handshake is complete, since
 * the shim is a classic script that runs during parsing. Resetting on
 * that first fire therefore wipes a live handshake, and the widget
 * never re-sends `hello`, so every later message (`events.subscribe`,
 * `event.complete`, `status.report`) is dropped by the `initialized`
 * gate and the widget silently receives nothing forever.
 *
 * Only a SUBSEQUENT `load` means an in-frame navigation, where a fresh
 * handshake really is coming.
 */
export function createFrameLoadHandler(bridge: Pick<WidgetBridge, "onFrameLoad">): () => void {
  let loadCount = 0;
  return () => {
    loadCount += 1;
    if (loadCount > 1) {
      bridge.onFrameLoad();
    }
  };
}
