// Client runtime entry — the entire browser-side surface besides the
// vendored data-star bundle. Replaces streamware/ui's React SPA:
// mounts one sandboxed iframe per widget instance, bridges the P1
// widget<->host protocol, runs the per-instance client-side event
// queue, and drives the Disconnected banner from the SSE connection
// state.

import type { WidgetEvent } from "@woofx3/module-sdk";
import { WidgetBridge, type WidgetBridgeCallbacks, type WidgetStatusReportPayload } from "./widget-bridge";
import { EventQueueManager } from "./event-queue";
import { SceneEventSource, type DeliveryFrame } from "./event-source";

interface WidgetInstanceConfig {
  id: string;
  widgetCanonicalId: string;
  moduleId: string;
  position: { x: number; y: number; width: number; height: number };
  settings: Record<string, unknown>;
  acceptedEvents: string[];
  frameUrl: string;
}

interface SceneConfig {
  id: string;
  applicationId: string;
  name: string;
  layout: Record<string, unknown>;
  widgets: WidgetInstanceConfig[];
}

declare global {
  interface Window {
    __WOOFX3_SCENE__?: { scene: SceneConfig | null };
  }
}

const REFRESH_INTERVAL_MS = 50_000;
// Batches delivered/completed acks so a burst of events doesn't mean
// a burst of single-item HTTP calls (see delivery-store.ts's design note).
const ACK_BATCH_WINDOW_MS = 250;

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function setConnectedSignal(connected: boolean): void {
  const banner = document.getElementById("disconnected-banner");
  banner?.classList.toggle("visible", !connected);
  // Best-effort data-star integration: patch the page's reactive
  // signal store so any `data-show`/`data-class` binding also reacts.
  // Based on the `datastar-signal-patch` event name the vendored
  // bundle itself defines — verify against the live data-star docs on
  // first real end-to-end run; the DOM class toggle above is the
  // source of truth regardless and doesn't depend on this succeeding.
  try {
    document.dispatchEvent(new CustomEvent("datastar-signal-patch", { detail: { connected } }));
  } catch {
    // data-star not loaded / signal not declared — the manual class toggle above still works.
  }
}

/** Batches instanceIds per eventId within a short window before POSTing. */
class AckBatcher {
  private readonly pending = new Map<string, Set<string>>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly endpoint: (eventId: string) => string) {}

  add(eventId: string, instanceId: string): void {
    let set = this.pending.get(eventId);
    if (!set) {
      set = new Set();
      this.pending.set(eventId, set);
    }
    set.add(instanceId);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), ACK_BATCH_WINDOW_MS);
    }
  }

  private flush(): void {
    this.timer = null;
    const batch = this.pending;
    this.pending.clear();
    for (const [eventId, instanceIds] of batch) {
      fetch(this.endpoint(eventId), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceIds: [...instanceIds] }),
      }).catch(() => {
        // Best-effort — a dropped ack surfaces as a server-side
        // redelivery/timeout instead, not a client-visible error.
      });
    }
  }
}

function main(): void {
  const sceneData = window.__WOOFX3_SCENE__?.scene;
  const container = document.getElementById("widgets");
  if (!sceneData || !container) {
    return;
  }
  const sceneId = sceneData.id;
  // Absolute, never relative: the shell is served at /scene/{sceneId}
  // with no trailing slash, so a `./`-relative URL resolves against
  // /scene/ (the sceneId segment gets treated as a filename, not a
  // directory) and silently drops it — this is exactly what caused
  // /scene/session/refresh (missing sceneId) instead of
  // /scene/{sceneId}/session/refresh.
  const sceneBase = `/scene/${encodeURIComponent(sceneId)}`;

  const bridgesByInstance = new Map<string, WidgetBridge>();
  const queueManager = new EventQueueManager();
  const deliveredBatcher = new AckBatcher((eventId) => `${sceneBase}/events/${encodeURIComponent(eventId)}/delivered`);
  const completedBatcher = new AckBatcher((eventId) => `${sceneBase}/events/${encodeURIComponent(eventId)}/completed`);

  function postStatus(instanceId: string, report: WidgetStatusReportPayload): void {
    fetch(`${sceneBase}/widget/${encodeURIComponent(instanceId)}/status`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moduleId: report.moduleId,
        widgetCanonicalId: report.widgetCanonicalId,
        key: report.key,
        value: report.value,
        ts: report.ts,
      }),
    }).catch(() => {});
  }

  for (const instance of sceneData.widgets) {
    const iframe = document.createElement("iframe");
    iframe.className = "widget-frame";
    iframe.style.left = `${instance.position.x}px`;
    iframe.style.top = `${instance.position.y}px`;
    iframe.style.width = `${instance.position.width}px`;
    iframe.style.height = `${instance.position.height}px`;
    // No allow-same-origin: the frame runs with an opaque origin, and
    // trust is established entirely by postMessage source identity +
    // the per-frame nonce, never by same-origin access.
    iframe.setAttribute("sandbox", "allow-scripts");

    const nonce = generateNonce();
    let currentSubId: string | null = null;

    const callbacks: WidgetBridgeCallbacks = {
      onStorageGet: () => null,
      onStorageSubscribe: () => {},
      onStorageUnsubscribe: () => {},
      onStatusReport: (report) => postStatus(instance.id, report),
      onEventsSubscribe: (subId, queue) => {
        currentSubId = subId;
        queueManager.register(
          subId,
          instance.id,
          queue,
          (item) => bridge.sendEvent(subId, toWidgetEvent(item)),
          () => {
            // Timed out waiting for completion — drop and advance
            // (see event-queue.ts's header comment on why this
            // doesn't attempt a same-widget redelivery).
          }
        );
      },
      onEventsUnsubscribe: (subId) => {
        queueManager.unregister(subId);
        if (currentSubId === subId) {
          currentSubId = null;
        }
      },
      onEventComplete: (subId, eventId) => {
        queueManager.complete(subId, eventId);
        completedBatcher.add(eventId, instance.id);
      },
      onDispose: () => {
        if (currentSubId) {
          queueManager.unregister(currentSubId);
          currentSubId = null;
        }
      },
    };

    const bridge = new WidgetBridge(instance.id, nonce, callbacks);
    iframe.addEventListener("load", () => bridge.onFrameLoad());
    iframe.src = `${instance.frameUrl}?nonce=${encodeURIComponent(nonce)}`;

    bridgesByInstance.set(instance.id, bridge);
    container.appendChild(iframe);
    bridge.attach(iframe);
  }

  window.addEventListener("message", (event) => {
    for (const bridge of bridgesByInstance.values()) {
      bridge.handleMessage(event);
    }
  });

  function toWidgetEvent(item: { eventId: string; type: string; key: string; value: unknown }): WidgetEvent {
    return {
      type: item.type,
      source: "scene-manager",
      time: new Date().toISOString(),
      data: item.value,
      eventId: item.eventId,
    };
  }

  const eventSource = new SceneEventSource({ url: new URL(`${sceneBase}/events`, location.href).toString() });
  eventSource.start({
    onFrame: (frame: DeliveryFrame) => {
      deliveredBatcher.add(frame.eventId, frame.instanceId);
      queueManager.enqueue(frame.instanceId, { eventId: frame.eventId, type: frame.type, key: frame.key, value: frame.value });
    },
    onConnectionChange: (connected) => setConnectedSignal(connected),
  });

  let refreshFailing = false;
  setInterval(() => {
    fetch(`${sceneBase}/session/refresh`, { method: "POST", credentials: "same-origin" })
      .then((resp) => {
        if (!resp.ok) {
          throw new Error(`refresh failed: ${resp.status}`);
        }
        if (refreshFailing) {
          refreshFailing = false;
          setConnectedSignal(true);
        }
      })
      .catch(() => {
        // Pre-emptive refresh failed — surface the same disconnected
        // state the SSE loss path uses until a refresh finally
        // succeeds (design: "an overlay should be shown displaying
        // the error until it is able to succeed").
        refreshFailing = true;
        setConnectedSignal(false);
      });
  }, REFRESH_INTERVAL_MS);
}

main();
