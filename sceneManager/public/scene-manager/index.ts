// Client runtime entry — the entire browser-side surface besides the
// vendored data-star bundle. Replaces streamware/ui's React SPA:
// mounts one sandboxed iframe per widget instance, bridges the P1
// widget<->host protocol, runs the per-instance client-side event
// queue, and drives the Disconnected banner from the SSE connection
// state.

import { AlertWidget } from "./alert-widget";
import {
  createFrameLoadHandler,
  WidgetBridge,
  type WidgetBridgeCallbacks,
  type WidgetStatusReportPayload,
} from "./widget-bridge";
import { EventQueueManager, toWidgetEvent } from "./event-queue";
import { AckBatcher } from "./ack-batcher";
import { SceneEventSource, type DeliveryFrame } from "./event-source";
import { ModuleStateCache } from "./module-state";
import { ConnectionStatus } from "./connection-status";
import { createReconnectCoordinator } from "./reconnect-coordinator";

interface WidgetInstanceConfig {
  id: string;
  widgetCanonicalId: string;
  moduleId: string;
  position: { x: number; y: number; width: number; height: number };
  settings: Record<string, unknown>;
  /** "alert" for an alert widget, which the page draws itself; "" otherwise. */
  hostsSurface: string;
  frameUrl: string;
}

interface SceneConfig {
  id: string;
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

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function placeAt(element: HTMLElement, position: WidgetInstanceConfig["position"]): void {
  element.style.left = `${position.x}px`;
  element.style.top = `${position.y}px`;
  element.style.width = `${position.width}px`;
  element.style.height = `${position.height}px`;
}

function renderConnected(connected: boolean): void {
  const banner = document.getElementById("disconnected-banner");
  banner?.classList.toggle("visible", !connected);
  // Best-effort data-star integration: patch the page's reactive
  // signal store so any `data-show`/`data-class` binding also reacts.
  // Based on the `datastar-signal-patch` event name the vendored
  // bundle itself defines -- verify against the live data-star docs on
  // first real end-to-end run; the DOM class toggle above is the
  // source of truth regardless and doesn't depend on this succeeding.
  try {
    document.dispatchEvent(new CustomEvent("datastar-signal-patch", { detail: { connected } }));
  } catch {
    // data-star not loaded / signal not declared -- the manual class toggle above still works.
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

  const bridges = new Set<WidgetBridge>();
  const queueManager = new EventQueueManager();
  const deliveredBatcher = new AckBatcher((eventId) => `${sceneBase}/events/${encodeURIComponent(eventId)}/delivered`);
  const completedBatcher = new AckBatcher((eventId) => `${sceneBase}/events/${encodeURIComponent(eventId)}/completed`);

  const moduleState = new ModuleStateCache(async (instanceId, key) => {
    const url = `${sceneBase}/widget/${encodeURIComponent(instanceId)}/storage?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, { credentials: "same-origin" });
    if (!resp.ok) {
      throw new Error(`module state ${key}: ${resp.status}`);
    }
    const body = (await resp.json()) as { value?: unknown };
    return body.value ?? null;
  });

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

  const mountAlertWidget = (instance: WidgetInstanceConfig): void => {
    const element = document.createElement("div");
    element.className = "alert-widget";
    placeAt(element, instance.position);
    container.appendChild(element);

    // The page plays alerts itself, so it registers the queue a framed
    // widget would register on subscribe: one alert at a time.
    const subId = `alert:${instance.id}`;
    const alertWidget = new AlertWidget({
      element,
      sceneBase,
      bridges,
      generateNonce,
      postStatus,
      onFinished: (eventId) => {
        queueManager.complete(subId, eventId);
        completedBatcher.add(eventId, instance.id);
      },
    });
    queueManager.register(
      subId,
      instance.id,
      { maxInFlight: 1 },
      (item) => alertWidget.play(item),
      () => {}
    );
  };

  for (const instance of sceneData.widgets) {
    if (instance.hostsSurface === "alert") {
      mountAlertWidget(instance);
      continue;
    }
    const iframe = document.createElement("iframe");
    iframe.className = "widget-frame";
    placeAt(iframe, instance.position);
    // No allow-same-origin: the frame runs with an opaque origin, and
    // trust is established entirely by postMessage source identity +
    // the per-frame nonce, never by same-origin access.
    iframe.setAttribute("sandbox", "allow-scripts");

    const nonce = generateNonce();
    let currentSubId: string | null = null;

    const callbacks: WidgetBridgeCallbacks = {
      // The module comes from the scene record, not from the module the
      // widget names in its hello (see module-state.ts).
      onStorageGet: (_moduleId, key) => moduleState.peek(instance.moduleId, key),
      onStorageSubscribe: (_moduleId, key) => moduleState.watch(instance.moduleId, key, storageTarget),
      onStorageUnsubscribe: (_moduleId, key) => moduleState.unwatch(instance.moduleId, key, storageTarget),
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
    const storageTarget = {
      instanceId: instance.id,
      sendStorageValue: (key: string, value: unknown) => bridge.sendStorageValue(key, value),
    };
    iframe.addEventListener("load", createFrameLoadHandler(bridge));
    iframe.src = `${instance.frameUrl}?nonce=${encodeURIComponent(nonce)}`;

    bridges.add(bridge);
    container.appendChild(iframe);
    bridge.attach(iframe);
  }

  window.addEventListener("message", (event) => {
    for (const bridge of bridges) {
      bridge.handleMessage(event);
    }
  });

  // One owner for the banner. Both reachability signals below report
  // into it rather than toggling the DOM themselves, so they can no
  // longer overwrite each other's verdict.
  const status = new ConnectionStatus(renderConnected);

  // Identity of the sceneManager process behind the current stream.
  // A different value on a later stream means the server restarted
  // while we were away, so the scene config baked into this document
  // (window.__WOOFX3_SCENE__ -- widget set, positions, settings, and
  // the frame URLs derived from them) may be stale. Reconnecting the
  // stream alone would leave us rendering the old scene against a new
  // server, so reload and let the shell be re-rendered.
  let serverBootId: string | null = null;

  const coordinator = createReconnectCoordinator();

  // Reloading is how this page recovers from anything a live stream
  // can't fix: the shell re-renders the current scene config and
  // re-mints the session cookie from the ?token= still in the URL.
  // Siblings are told first -- once we start reloading, this page is
  // gone and can't relay anything.
  function reloadOverlay(): void {
    coordinator.requestPeerReload();
    location.reload();
  }
  coordinator.onPeerReload(() => {
    // A sibling detected the restart. Reload without rebroadcasting.
    location.reload();
  });

  const eventSource = new SceneEventSource({
    url: new URL(`${sceneBase}/events`, location.href).toString(),
    coordinator,
  });
  eventSource.start({
    onFrame: (frame: DeliveryFrame) => {
      deliveredBatcher.add(frame.eventId, frame.instanceId);
      queueManager.enqueue(frame.instanceId, {
        eventId: frame.eventId,
        type: frame.type,
        key: frame.key,
        value: frame.value,
      });
    },
    onModuleState: (frame) => moduleState.apply(frame.moduleId, frame.key, frame.value),
    onConnectionChange: (connected) => status.set("stream", connected),
    onHello: (bootId) => {
      if (serverBootId !== null && serverBootId !== bootId) {
        reloadOverlay();
        return;
      }
      if (serverBootId !== null) {
        moduleState.refresh();
      }
      serverBootId = bootId;
    },
    onSessionExpired: () => {
      // Our 60s session JWT lapsed while the server was away, so every
      // reconnect would 401 forever and we'd never see the hello frame
      // that reveals a restart. Only a page load mints a new session.
      reloadOverlay();
    },
  });

  setInterval(() => {
    fetch(`${sceneBase}/session/refresh`, { method: "POST", credentials: "same-origin" })
      .then((resp) => {
        if (!resp.ok) {
          throw new Error(`refresh failed: ${resp.status}`);
        }
        status.set("session", true);
      })
      .catch(() => {
        // Pre-emptive refresh failed -- surface the same disconnected
        // state the SSE loss path uses until a refresh finally
        // succeeds (design: "an overlay should be shown displaying
        // the error until it is able to succeed").
        status.set("session", false);
      });
  }, REFRESH_INTERVAL_MS);
}

main();
