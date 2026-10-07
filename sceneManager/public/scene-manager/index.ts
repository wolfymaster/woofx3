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
import { MediaCache } from "./media-cache";
import { ModuleStateCache } from "./module-state";
import { ConnectionStatus } from "./connection-status";
import { createReconnectCoordinator } from "./reconnect-coordinator";
import {
  applyPreviewLayout,
  draftFrameKey,
  parsePreviewLayout,
  parsePreviewPlacements,
  settingsOf,
  type PreviewWidgetLayout,
} from "./preview-layout";
import { applySceneBackground } from "./scene-background";
import {
  canChangeSettingsLive,
  parseSceneConfig,
  planSceneUpdate,
  sameValue,
  type SceneConfig,
  type WidgetPlacementConfig,
} from "./scene-update";

declare global {
  interface Window {
    __WOOFX3_SCENE__?: { scene: SceneConfig | null };
  }
}

const REFRESH_INTERVAL_MS = 50_000;

// Typing into a text setting posts a draft per keystroke, and a settings
// change reloads the frame of a widget that doesn't take settings live;
// waiting for a pause reloads it once.
const DRAFT_SETTLE_MS = 400;

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A frame's URL with the bridge nonce added; a draft frame's URL already has a query. */
function withNonce(frameUrl: string, nonce: string): string {
  const url = new URL(frameUrl, location.href);
  url.searchParams.set("nonce", nonce);
  return url.pathname + url.search;
}

function placeAt(element: HTMLElement, position: WidgetPlacementConfig["position"]): void {
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
  applySceneBackground(document.body, sceneData.layout);
  const sceneId = sceneData.id;
  // Absolute, never relative: the shell is served at /scene/{sceneId}
  // with no trailing slash, so a `./`-relative URL resolves against
  // /scene/ (the sceneId segment gets treated as a filename, not a
  // directory) and silently drops it — this is exactly what caused
  // /scene/session/refresh (missing sceneId) instead of
  // /scene/{sceneId}/session/refresh.
  const sceneBase = `/scene/${encodeURIComponent(sceneId)}`;

  const bridges = new Set<WidgetBridge>();
  // Every placed element by widget instance id, for the editor's live layout.
  const widgetElements = new Map<string, HTMLElement>();
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

  const media = new MediaCache({
    sceneId,
    sceneBase,
    warn: (message, detail) => console.warn(message, detail),
  });
  // Everything the scene can be asked to play, fetched now so the first
  // alert does not wait on a download. A manifest that fails to load costs
  // only that: each file is still fetched the first time a widget asks.
  void fetch(`${sceneBase}/media-manifest`, { credentials: "same-origin", cache: "no-store" })
    .then((resp) => (resp.ok ? (resp.json() as Promise<{ keys?: unknown }>) : { keys: [] }))
    .then(async (body) => {
      const keys = Array.isArray(body.keys) ? body.keys.filter((key): key is string => typeof key === "string") : [];
      await media.prune(keys);
      await media.prefetch(keys);
    })
    .catch((err) => console.warn("[scene-manager] media manifest unavailable", { error: String(err) }));

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

  // Alert widgets ack each alert as it starts and as it finishes, one request
  // each rather than through a batcher: the server finds the alert on screen
  // from these, and a quarter-second batch is long enough for an operator's
  // Skip to land on the alert that just ended.
  function postAlertAck(kind: "started" | "completed", eventId: string, instanceId: string): void {
    fetch(`${sceneBase}/events/${encodeURIComponent(eventId)}/${kind}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceIds: [instanceId] }),
    }).catch(() => {});
  }

  // Each placement on the page by id, with what it takes to remove it again.
  const mounted = new Map<string, { config: WidgetPlacementConfig; unmount: () => void }>();
  // The bridge of each framed placement, which is how a widget that takes
  // settings live is handed them.
  const framedBridges = new Map<string, WidgetBridge>();

  const mountAlertWidget = (instance: WidgetPlacementConfig): (() => void) => {
    const element = document.createElement("div");
    element.className = "alert-widget";
    placeAt(element, instance.position);
    container.appendChild(element);
    widgetElements.set(instance.id, element);

    // The page plays alerts itself, so it registers the queue a framed
    // widget would register on subscribe: one alert at a time.
    const subId = `alert:${instance.id}`;
    const alertWidget = new AlertWidget({
      element,
      sceneBase,
      bridges,
      media,
      generateNonce,
      postStatus,
      onFinished: (eventId) => {
        queueManager.complete(subId, eventId);
        postAlertAck("completed", eventId, instance.id);
      },
    });
    queueManager.register(
      subId,
      instance.id,
      { maxInFlight: 1 },
      (item) => {
        postAlertAck("started", item.eventId, instance.id);
        return alertWidget.play(item);
      },
      () => {},
      (eventId) => alertWidget.stop(eventId)
    );

    return () => {
      // Finishes what is playing while the queue is still there to hear it.
      alertWidget.dispose();
      queueManager.unregister(subId);
      widgetElements.delete(instance.id);
      element.remove();
    };
  };

  const mountFramedWidget = (instance: WidgetPlacementConfig): (() => void) => {
    const iframe = document.createElement("iframe");
    iframe.className = "widget-frame";
    placeAt(iframe, instance.position);
    // No allow-same-origin: the frame runs with an opaque origin, and
    // trust is established entirely by postMessage source identity +
    // the per-frame nonce, never by same-origin access.
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("allow", "autoplay");

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
      onMediaGet: (url) => media.load(url),
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
    iframe.src = withNonce(instance.frameUrl, nonce);

    bridges.add(bridge);
    framedBridges.set(instance.id, bridge);
    container.appendChild(iframe);
    widgetElements.set(instance.id, iframe);
    bridge.attach(iframe);

    return () => {
      bridge.dispose();
      bridge.detach();
      bridges.delete(bridge);
      if (framedBridges.get(instance.id) === bridge) {
        framedBridges.delete(instance.id);
      }
      moduleState.unwatchAll(storageTarget);
      widgetElements.delete(instance.id);
      iframe.remove();
    };
  };

  function mount(instance: WidgetPlacementConfig): void {
    const unmount = instance.hostsSurface === "alert" ? mountAlertWidget(instance) : mountFramedWidget(instance);
    mounted.set(instance.id, { config: instance, unmount });
  }

  // Stacked by z-index rather than by document order: moving an iframe in
  // the document reloads it, which is what a scene update avoids.
  function stack(order: readonly string[]): void {
    order.forEach((id, index) => {
      const element = widgetElements.get(id);
      if (element) {
        element.style.zIndex = String(index);
      }
    });
  }

  for (const instance of sceneData.widgets) {
    mount(instance);
  }
  stack(sceneData.widgets.map((instance) => instance.id));

  // The editor's draft layout, kept so a scene update -- which places every
  // widget where it was saved -- doesn't undo a drag the editor has not saved.
  let previewLayout: PreviewWidgetLayout[] | null = null;
  // The editor's unsaved placements, once it has sent any. From then on they
  // are what the page shows: a save the editor made matches them, and a save
  // must not undo an edit made since.
  let draftPlacements: unknown[] | null = null;
  let draftKey = "";
  let draftTimer: ReturnType<typeof setTimeout> | null = null;

  window.addEventListener("message", (event) => {
    for (const bridge of bridges) {
      bridge.handleMessage(event);
    }
  });

  /** Whether the widget on the page as `id` takes settings without loading again. */
  function takesSettingsLive(id: string): boolean {
    return framedBridges.get(id)?.acceptsSettings() ?? false;
  }

  /**
   * Hand a placement's settings to its widget, when it takes them live and
   * they need no new frame. False when it must be mounted again for them.
   */
  function changeSettingsLive(id: string, settings: Record<string, unknown>): boolean {
    const entry = mounted.get(id);
    const bridge = framedBridges.get(id);
    if (!entry || !bridge?.acceptsSettings() || !canChangeSettingsLive(entry.config.settings, settings)) {
      return false;
    }
    if (!sameValue(entry.config.settings, settings)) {
      bridge.sendSettings(settings);
      entry.config = { ...entry.config, settings };
    }
    return true;
  }

  // Only a page that frames this overlay can move its widgets, and it can
  // only move them on its own screen: nothing here is saved or sent on. OBS
  // loads the overlay top-level, where `window.parent` is the window itself.
  if (window.parent !== window) {
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) {
        return;
      }
      const layout = parsePreviewLayout(event.data);
      if (layout) {
        previewLayout = layout;
        applyPreviewLayout(widgetElements, layout);
      }
      const placements = parsePreviewPlacements(event.data);
      if (placements) {
        draftPlacements = placements;
        // A widget that takes settings live gets them now, keystroke by
        // keystroke; only what needs a new frame waits for the server.
        for (const raw of placements) {
          const placement = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
          if (typeof placement.id === "string") {
            changeSettingsLive(placement.id, settingsOf(placement));
          }
        }
        const key = draftFrameKey(placements, takesSettingsLive);
        if (key !== draftKey) {
          draftKey = key;
          if (draftTimer !== null) {
            clearTimeout(draftTimer);
          }
          draftTimer = setTimeout(() => {
            draftTimer = null;
            void updateScene();
          }, DRAFT_SETTLE_MS);
        }
      }
    });
  }

  function applySceneConfig(next: SceneConfig, fromDraft: boolean): void {
    for (const instance of next.widgets) {
      const entry = mounted.get(instance.id);
      if (!entry || !takesSettingsLive(instance.id)) {
        continue;
      }
      if (fromDraft && canChangeSettingsLive(entry.config.settings, instance.settings)) {
        // The editor has handed this widget its settings since this draft
        // was sent: what it shows is newer than the response.
        instance.settings = entry.config.settings;
        continue;
      }
      changeSettingsLive(instance.id, instance.settings);
    }
    const plan = planSceneUpdate(
      [...mounted.values()].map((entry) => entry.config),
      next.widgets
    );
    for (const id of plan.remove) {
      mounted.get(id)?.unmount();
      mounted.delete(id);
    }
    for (const instance of plan.place) {
      const entry = mounted.get(instance.id);
      const element = widgetElements.get(instance.id);
      if (entry && element) {
        entry.config = instance;
        placeAt(element, instance.position);
      }
    }
    for (const instance of plan.mount) {
      mount(instance);
    }
    stack(plan.order);
    applySceneBackground(document.body, next.layout);
    if (previewLayout) {
      applyPreviewLayout(widgetElements, previewLayout);
    }
  }

  type Target = { kind: "apply"; config: SceneConfig; fromDraft: boolean } | { kind: "reload" } | { kind: "keep" };

  // The saved scene, or the editor's draft once it has sent one. A failed
  // saved fetch reloads, which renders the saved scene too and re-mints the
  // session when a lapsed one is why it failed. A failed draft fetch keeps
  // what is on screen instead: the editor posts its draft again on every
  // load, so reloading for a draft the server keeps refusing would loop.
  async function fetchTarget(): Promise<Target> {
    const draft = draftPlacements;
    let resp: Response;
    try {
      resp = draft
        ? await fetch(`${sceneBase}/draft-config`, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ widgets: draft }),
          })
        : await fetch(`${sceneBase}/config`, { credentials: "same-origin", cache: "no-store" });
    } catch {
      return draft ? { kind: "keep" } : { kind: "reload" };
    }
    const config = resp.ok ? parseSceneConfig(await resp.json().catch(() => null)) : null;
    if (config && config.id === sceneId) {
      return { kind: "apply", config, fromDraft: draft !== null };
    }
    if (draft && resp.status !== 401) {
      console.warn("[scene-manager] draft preview refused; showing the last one", { status: resp.status });
      return { kind: "keep" };
    }
    return { kind: "reload" };
  }

  // One update at a time: saves and drafts that land while one is applying
  // collapse into a single fetch of the newest target once it is done.
  let updating = false;
  let updateRequested = false;
  async function updateScene(): Promise<void> {
    updateRequested = true;
    if (updating) {
      return;
    }
    updating = true;
    try {
      while (updateRequested) {
        updateRequested = false;
        const target = await fetchTarget();
        if (target.kind === "reload") {
          location.reload();
          return;
        }
        if (target.kind === "apply") {
          applySceneConfig(target.config, target.fromDraft);
        }
      }
    } finally {
      updating = false;
    }
  }

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
    onCancel: (frame) => queueManager.cancel(frame.instanceId, frame.eventIds),
    onConnectionChange: (connected) => status.set("stream", connected),
    // The scene was saved. Only this scene's streams receive the frame, so
    // unlike a restart there is no sibling overlay to tell.
    onSceneUpdated: () => void updateScene(),
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
