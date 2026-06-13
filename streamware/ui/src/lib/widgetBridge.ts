// P1 parent-side bridge — one `WidgetBridge` manages one sandboxed
// widget iframe. The bridge validates every inbound postMessage
// against the iframe's `contentWindow` identity AND the per-frame
// CSPRNG nonce; messages failing either check are silently dropped
// (design §5.2.10).
//
// Lifecycle:
//   1. `attach(iframe)` — bind the DOM element after mount.
//   2. Each iframe `load` event calls `onFrameLoad()`, which resets
//      `initialized` so a fresh `hello` is required (navigation guard).
//   3. The shim posts `hello`; `handleMessage` replies with `init` or
//      `init.reject`.
//   4. `dispose()` / `detach()` tear down on unmount.

import {
  WIDGET_PROTOCOL,
  PROTOCOL_VERSION,
  isWidgetProtocolEnvelope,
} from "../../../../shared/clients/typescript/module-sdk/src/widget-protocol";
import type { WidgetEvent, WidgetStatusReport } from "@woofx3/module-sdk";

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
  onStatusReport(report: WidgetStatusReport): void;
  onDispose(): void;
}

export class WidgetBridge {
  private iframe: HTMLIFrameElement | null = null;
  private moduleId: string | null = null;
  private initialized = false;

  constructor(
    private readonly instanceId: string,
    private readonly nonce: string,
    private readonly callbacks: WidgetBridgeCallbacks,
  ) {}

  attach(iframe: HTMLIFrameElement): void {
    this.iframe = iframe;
  }

  // Called on every iframe load event — invalidates the P1 session so
  // the shim must re-post `hello` (navigation detection, design §5.2.10).
  onFrameLoad(): void {
    this.initialized = false;
    this.moduleId = null;
  }

  handleMessage(event: MessageEvent): void {
    // Source identity: only accept messages from our iframe's window.
    if (!this.iframe || event.source !== this.iframe.contentWindow) {
      return;
    }
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) {
      return;
    }
    const msg = data as Record<string, unknown>;
    // Proto check is required for all messages.
    if (msg.proto !== WIDGET_PROTOCOL) {
      return;
    }
    // Nonce check is required for all messages.
    if (msg.nonce !== this.nonce) {
      return;
    }
    const type = typeof msg.type === "string" ? msg.type : "";
    if (!type) {
      return;
    }
    // For hello: we handle version mismatch explicitly (sendReject) before
    // the isWidgetProtocolEnvelope guard, which would drop unknown versions.
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
    // All other messages must pass the full envelope guard (correct v).
    if (!isWidgetProtocolEnvelope(data)) {
      return;
    }
    switch (type) {
      case "hello": {
        // Handled above — unreachable.
        return;
      }
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
        this.callbacks.onStorageSubscribe(this.moduleId, key, this.instanceId);
        return;
      }
      case "storage.unsubscribe": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const key = typeof msg.key === "string" ? msg.key : "";
        this.callbacks.onStorageUnsubscribe(this.moduleId, key, this.instanceId);
        return;
      }
      case "status.report": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const report: WidgetStatusReport = {
          kind: "widget.event",
          moduleId: this.moduleId,
          instanceId: this.instanceId,
          key: typeof msg.key === "string" ? msg.key : "",
          value: msg.value,
          ts: typeof msg.ts === "string" ? msg.ts : new Date().toISOString(),
        };
        this.callbacks.onStatusReport(report);
        return;
      }
      default:
        // Unknown message types are ignored for forward compatibility.
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
    this.post({
      type: "storage.changed",
      subId: `${moduleId}:${key}`,
      key,
      value,
      occurredAt: new Date().toISOString(),
    });
  }

  sendEvent(event: WidgetEvent): void {
    if (!this.initialized) {
      return;
    }
    this.post({
      type: "event.deliver",
      subId: event.type,
      event,
    });
  }

  dispose(): void {
    this.post({ type: "dispose", reason: "scene-manager-dispose" });
    this.callbacks.onDispose();
  }

  detach(): void {
    this.iframe = null;
    this.initialized = false;
    this.moduleId = null;
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
      "*",
    );
  }
}
