// P1 parent-side bridge — one `WidgetBridge` manages one sandboxed
// widget iframe. Ported and extended from
// streamware/ui/src/lib/widgetBridge.ts: the P1 handshake/storage/
// status.report handling is unchanged; new here is `queue` config
// capture on `events.subscribe` (the widget's client-side dispatch
// policy — see event-queue.ts) and the `event.complete` message.
//
// The bridge validates every inbound postMessage against the iframe's
// `contentWindow` identity AND the per-frame CSPRNG nonce; messages
// failing either check are silently dropped.
//
// Module storage (`storage.get`/`storage.subscribe`) is NOT wired to a
// real backing store in this rewrite — `onStorageGet` always resolves
// `null` and subscriptions never fire. That subsystem (module-state
// sync over a dedicated transport) is out of scope for the
// sceneManager cutover and can be added later without a protocol
// change; the P1 messages still round-trip correctly, they just never
// carry real data yet.

import {
  WIDGET_PROTOCOL,
  PROTOCOL_VERSION,
  isWidgetProtocolEnvelope,
  type EventQueueConfig,
  type WidgetEvent,
} from "@woofx3/module-sdk";

export interface WidgetStatusReportPayload {
  moduleId: string;
  instanceId: string;
  widgetCanonicalId?: string;
  key: string;
  value: unknown;
  ts: string;
}

export interface WidgetBridgeCallbacks {
  onStorageGet(moduleId: string, key: string): unknown;
  onStorageSubscribe(moduleId: string, key: string, bridgeId: string): void;
  onStorageUnsubscribe(moduleId: string, key: string, bridgeId: string): void;
  onStatusReport(report: WidgetStatusReportPayload): void;
  /** Widget opened an event subscription, optionally with a queue
   *  dispatch policy — "the widget registers itself." */
  onEventsSubscribe(subId: string, queue: EventQueueConfig | undefined): void;
  onEventsUnsubscribe(subId: string): void;
  /** Widget acked completion of a delivered event. */
  onEventComplete(subId: string, eventId: string): void;
  onDispose(): void;
}

export class WidgetBridge {
  private iframe: HTMLIFrameElement | null = null;
  private moduleId: string | null = null;
  private initialized = false;

  private readonly shimStorageSubs = new Map<string, Set<string>>();
  private readonly shimSubToKey = new Map<string, string>();
  // subId -> types filter (unused for matching today — the host
  // delivers whatever event-queue.ts routes to this instance; kept so
  // sendEvent can validate a subscriber actually exists).
  private readonly shimEventSubs = new Set<string>();

  constructor(
    private readonly instanceId: string,
    private readonly nonce: string,
    private readonly callbacks: WidgetBridgeCallbacks
  ) {}

  attach(iframe: HTMLIFrameElement): void {
    this.iframe = iframe;
  }

  onFrameLoad(): void {
    this.initialized = false;
    this.moduleId = null;
    this.shimStorageSubs.clear();
    this.shimSubToKey.clear();
    this.shimEventSubs.clear();
  }

  handleMessage(event: MessageEvent): void {
    if (!this.iframe || event.source !== this.iframe.contentWindow) {
      return;
    }
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) {
      return;
    }
    const msg = data as Record<string, unknown>;
    if (msg.proto !== WIDGET_PROTOCOL) {
      return;
    }
    if (msg.nonce !== this.nonce) {
      return;
    }
    const type = typeof msg.type === "string" ? msg.type : "";
    if (!type) {
      return;
    }
    if (type === "hello") {
      const v = msg.v as number;
      const incomingModuleId = typeof msg.moduleId === "string" ? msg.moduleId : "";
      if (v !== PROTOCOL_VERSION) {
        this.sendReject(`unsupported protocol version ${v}`);
        return;
      }
      this.moduleId = incomingModuleId;
      this.initialized = true;
      this.sendInit({});
      return;
    }
    if (!isWidgetProtocolEnvelope(data)) {
      return;
    }
    switch (type) {
      case "storage.get": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const id = typeof msg.id === "string" ? msg.id : "";
        const key = typeof msg.key === "string" ? msg.key : "";
        const value = this.callbacks.onStorageGet(this.moduleId, key);
        this.post({ type: "storage.value", id, key, value });
        return;
      }
      case "storage.subscribe": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const key = typeof msg.key === "string" ? msg.key : "";
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const storageKey = `${this.moduleId}:${key}`;
        let subIds = this.shimStorageSubs.get(storageKey);
        if (!subIds) {
          subIds = new Set();
          this.shimStorageSubs.set(storageKey, subIds);
        }
        subIds.add(subId);
        this.shimSubToKey.set(subId, storageKey);
        this.callbacks.onStorageSubscribe(this.moduleId, key, this.instanceId);
        return;
      }
      case "storage.unsubscribe": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const storageKey = this.shimSubToKey.get(subId);
        if (!storageKey) {
          return;
        }
        this.shimSubToKey.delete(subId);
        const subIds = this.shimStorageSubs.get(storageKey);
        if (subIds) {
          subIds.delete(subId);
          if (subIds.size === 0) {
            this.shimStorageSubs.delete(storageKey);
          }
        }
        const colonIdx = storageKey.indexOf(":");
        const key = colonIdx >= 0 ? storageKey.slice(colonIdx + 1) : storageKey;
        this.callbacks.onStorageUnsubscribe(this.moduleId, key, this.instanceId);
        return;
      }
      case "events.subscribe": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        if (!subId) {
          return;
        }
        this.shimEventSubs.add(subId);
        const queue = isEventQueueConfig(msg.queue) ? msg.queue : undefined;
        this.callbacks.onEventsSubscribe(subId, queue);
        return;
      }
      case "events.unsubscribe": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        this.shimEventSubs.delete(subId);
        this.callbacks.onEventsUnsubscribe(subId);
        return;
      }
      case "event.complete": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const eventId = typeof msg.eventId === "string" ? msg.eventId : "";
        if (!subId || !eventId) {
          return;
        }
        this.callbacks.onEventComplete(subId, eventId);
        return;
      }
      case "status.report": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        this.callbacks.onStatusReport({
          moduleId: this.moduleId,
          instanceId: this.instanceId,
          key: typeof msg.key === "string" ? msg.key : "",
          value: msg.value,
          ts: typeof msg.ts === "string" ? msg.ts : new Date().toISOString(),
        });
        return;
      }
      default:
        return;
    }
  }

  sendInit(settings: Record<string, unknown>): void {
    this.post({
      type: "init",
      settings,
      capabilities: ["storage", "events", "status"],
      acceptedEvents: [],
    });
  }

  sendReject(reason: string): void {
    this.post({
      type: "init.reject",
      reason,
      supportedVersions: [PROTOCOL_VERSION],
    });
  }

  sendStorageChanged(moduleId: string, key: string, value: unknown): void {
    if (!this.initialized) {
      return;
    }
    const storageKey = `${moduleId}:${key}`;
    const subIds = this.shimStorageSubs.get(storageKey);
    const occurredAt = new Date().toISOString();
    if (subIds && subIds.size > 0) {
      for (const subId of subIds) {
        this.post({ type: "storage.changed", subId, key, value, occurredAt });
      }
    } else {
      this.post({ type: "storage.changed", subId: storageKey, key, value, occurredAt });
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

  dispose(): void {
    this.post({ type: "dispose", reason: "scene-manager-dispose" });
    this.callbacks.onDispose();
  }

  detach(): void {
    this.iframe = null;
    this.initialized = false;
    this.moduleId = null;
    this.shimStorageSubs.clear();
    this.shimSubToKey.clear();
    this.shimEventSubs.clear();
  }

  private post(payload: Record<string, unknown>): void {
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

function isEventQueueConfig(value: unknown): value is EventQueueConfig {
  return typeof value === "object" && value !== null;
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
 * handshake really is coming. Ported from streamware's WidgetFrame.tsx,
 * whose `loadCount > 1` guard this restores.
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
