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
import {
  applyPreviewLayout,
  draftFrameKey,
  parsePreviewLayout,
  parsePreviewPlacements,
  settingsOf,
  type PreviewWidgetLayout,
} from "./preview-layout";
import {
  earliestMediaProxyExpiry,
  externalMediaUrls,
  mediaRefreshDelay,
  parseMediaUrls,
  replaceMediaUrls,
} from "./media-url";
import { applySceneBackground } from "./scene-background";
import {
  parseSceneConfig,
  planSceneUpdate,
  settingsUpdate,
  themeOf,
  type SceneConfig,
  type WidgetPlacementConfig,
} from "./scene-update";
import {
  type WidgetTransitionState,
  encodePlacementBoot,
  isGenericTransitionType,
  widgetTransitionState,
} from "@woofx3/module-sdk";
import { TransitionAnimator } from "./transitions";
import {
  type SceneOpsEvent,
  type SceneSnapshot,
  applyOps,
  configOfSnapshot,
  mergeMeta,
  parseSnapshot,
} from "./scene-document";

declare global {
  interface Window {
    __WOOFX3_SCENE__?: { scene: SceneConfig | null; document?: unknown };
  }
}

const REFRESH_INTERVAL_MS = 50_000;

// Adding a widget or changing a theme in the editor needs the server to
// resolve the new frame; waiting for a pause asks it once.
const DRAFT_SETTLE_MS = 400;

// A frame swapped in for another is shown once it reports it has painted, or
// after this long, so a widget that never reports still appears.
const SWAP_TIMEOUT_MS = 2000;

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A frame's URL with its placement in the fragment (see `WidgetPlacementBoot`):
 * the document is the widget's and cached, the placement never reaches the
 * server. `entrance` is one of the widget's own transitions for the frame to
 * play as it first paints.
 */
function frameSrc(instance: WidgetPlacementConfig, nonce: string, entrance?: WidgetTransitionState): string {
  const boot = encodePlacementBoot({
    nonce,
    instanceId: instance.id,
    settings: instance.settings,
    linkedResources: instance.linkedResources ?? {},
    ...(entrance ? { transition: entrance } : {}),
  });
  return `${instance.frameUrl}#${boot}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
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
  // The scene's sequenced document: every save after it arrives as ops for
  // the next sequence number (see scene-document.ts).
  let sceneDoc: SceneSnapshot | null = parseSnapshot(window.__WOOFX3_SCENE__?.document);
  // Absolute, never relative: the shell is served at /scene/{sceneId}
  // with no trailing slash, so a `./`-relative URL resolves against
  // /scene/ (the sceneId segment gets treated as a filename, not a
  // directory) and silently drops it — this is exactly what caused
  // /scene/session/refresh (missing sceneId) instead of
  // /scene/{sceneId}/session/refresh.
  const sceneBase = `/scene/${encodeURIComponent(sceneId)}`;
  // The editor's preview shows the draft; every other overlay what is published.
  const view = new URLSearchParams(location.search).get("view") === "draft" ? "draft" : "published";

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

  // Each placement on the page by id: what it was mounted from, how to remove
  // it, its bridge when it is framed, and a frame being swapped in, if any.
  interface MountedPlacement {
    config: WidgetPlacementConfig;
    unmount: () => void;
    bridge: WidgetBridge | null;
    swap: { cancel: () => void } | null;
  }
  const mounted = new Map<string, MountedPlacement>();
  // A hidden placement keeps its frame running, out of sight; this shows and
  // hides placements, playing their transitions.
  const animator = new TransitionAnimator();

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
      if (widgetElements.get(instance.id) === element) {
        widgetElements.delete(instance.id);
      }
      element.remove();
    };
  };

  interface Frame {
    element: HTMLIFrameElement;
    bridge: WidgetBridge;
    unmount: () => void;
  }

  interface FrameOptions {
    /** Loading to replace another frame (see `swapFrame`). */
    hidden?: boolean;
    onRendered?: () => void;
    /** One of the widget's own transitions, played as the frame first paints. */
    entrance?: WidgetTransitionState;
  }

  /** A widget's frame. */
  const mountFramedWidget = (
    instance: WidgetPlacementConfig,
    { hidden = false, onRendered, entrance }: FrameOptions = {}
  ): Frame => {
    const iframe = document.createElement("iframe");
    iframe.className = "widget-frame";
    placeAt(iframe, instance.position);
    if (hidden) {
      iframe.style.opacity = "0";
    }
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
      onRendered,
    };

    const bridge = new WidgetBridge(instance.id, nonce, callbacks);
    const storageTarget = {
      instanceId: instance.id,
      sendStorageValue: (key: string, value: unknown) => bridge.sendStorageValue(key, value),
    };
    iframe.addEventListener("load", createFrameLoadHandler(bridge));
    iframe.src = frameSrc(instance, nonce, entrance);

    bridges.add(bridge);
    container.appendChild(iframe);
    if (!hidden) {
      widgetElements.set(instance.id, iframe);
    }
    bridge.attach(iframe);

    const unmount = (): void => {
      bridge.dispose();
      bridge.detach();
      bridges.delete(bridge);
      moduleState.unwatchAll(storageTarget);
      if (widgetElements.get(instance.id) === iframe) {
        widgetElements.delete(instance.id);
      }
      iframe.remove();
    };
    return { element: iframe, bridge, unmount };
  };

  /**
   * Put a placement on the page, entering with its transition when it is
   * shown. A generic entrance on a frame waits for the frame's first paint,
   * or it would play on an empty box; one of the widget's own is in the
   * frame's boot payload and starts as the widget does.
   */
  function mount(instance: WidgetPlacementConfig): void {
    const visible = instance.visible !== false;
    const entrance = visible ? instance.transitionIn : undefined;
    if (instance.hostsSurface === "alert") {
      mounted.set(instance.id, { config: instance, unmount: mountAlertWidget(instance), bridge: null, swap: null });
      const element = widgetElements.get(instance.id);
      if (element && visible) {
        animator.enter({ element, frame: null }, entrance);
      } else if (element) {
        animator.set(element, false);
      }
      return;
    }
    if (!entrance || !isGenericTransitionType(entrance.type)) {
      const frame = mountFramedWidget(instance, {
        entrance: entrance ? widgetTransitionState(entrance, "in") : undefined,
      });
      mounted.set(instance.id, { config: instance, unmount: frame.unmount, bridge: frame.bridge, swap: null });
      animator.set(frame.element, visible);
      return;
    }
    let waiting = true;
    const enter = (): void => {
      if (!waiting) {
        return;
      }
      waiting = false;
      clearTimeout(timer);
      const entry = mounted.get(instance.id);
      if (entry?.bridge === frame.bridge && entry.config.visible !== false) {
        animator.enter({ element: frame.element, frame: frame.bridge }, entrance);
      }
    };
    const frame = mountFramedWidget(instance, { onRendered: enter });
    const timer = setTimeout(enter, SWAP_TIMEOUT_MS);
    mounted.set(instance.id, { config: instance, unmount: frame.unmount, bridge: frame.bridge, swap: null });
    animator.set(frame.element, false);
  }

  function unmountPlacement(id: string): void {
    const entry = mounted.get(id);
    entry?.swap?.cancel();
    entry?.unmount();
    mounted.delete(id);
  }

  /** Take a placement off the page, leaving with its transition when it is shown. */
  function removePlacement(id: string): void {
    const entry = mounted.get(id);
    const element = widgetElements.get(id);
    const transition = entry?.config.transitionOut;
    if (!entry || !element || !transition || element.style.visibility === "hidden") {
      unmountPlacement(id);
      return;
    }
    entry.swap?.cancel();
    mounted.delete(id);
    void animator.leave({ element, frame: entry.bridge }, transition).then(() => entry.unmount());
  }

  /** Show or hide a placement whose visibility changed, with its transition. */
  function changeVisibility(entry: MountedPlacement, element: HTMLElement, visible: boolean): void {
    const target = { element, frame: entry.bridge };
    if (visible) {
      animator.enter(target, entry.config.transitionIn);
    } else {
      void animator.leave(target, entry.config.transitionOut);
    }
  }

  /**
   * Give a placement a new frame without a blank moment: the new frame loads
   * invisibly at the same spot and takes the old one's place once it has
   * painted. A newer swap for the placement cancels this one. An alert area
   * has no frame, so it is simply mounted again.
   */
  function swapFrame(next: WidgetPlacementConfig): void {
    const entry = mounted.get(next.id);
    if (!entry || next.hostsSurface !== "" || entry.config.hostsSurface !== "") {
      unmountPlacement(next.id);
      mount(next);
      return;
    }
    entry.swap?.cancel();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      const old = widgetElements.get(next.id);
      fresh.element.style.zIndex = old?.style.zIndex ?? "";
      fresh.element.style.display = old?.style.display ?? "";
      fresh.element.style.opacity = "";
      animator.set(fresh.element, next.visible !== false);
      entry.unmount();
      widgetElements.set(next.id, fresh.element);
      mounted.set(next.id, { config: next, unmount: fresh.unmount, bridge: fresh.bridge, swap: null });
      if (previewLayout) {
        applyPreviewLayout(widgetElements, previewLayout);
      }
    };
    const fresh = mountFramedWidget(next, { hidden: true, onRendered: finish });
    timer = setTimeout(finish, SWAP_TIMEOUT_MS);
    entry.swap = {
      cancel: () => {
        if (!settled) {
          settled = true;
          if (timer !== null) {
            clearTimeout(timer);
          }
          fresh.unmount();
        }
      },
    };
  }

  /**
   * Bring a placement whose frame stays up to date with new settings: patched
   * in through the widget's bindings, or a fresh frame when the widget's
   * script read one that changed (see `settingsUpdate`).
   */
  function updateSettings(id: string, settings: Record<string, unknown>): void {
    const entry = mounted.get(id);
    if (!entry) {
      return;
    }
    // While a frame is being swapped in, nothing is known about it yet.
    const reads = entry.swap || !entry.bridge ? null : entry.bridge.settingsReads();
    const decision = settingsUpdate(entry.config.settings, settings, reads);
    if (decision === "none") {
      return;
    }
    if (decision === "patch" && entry.bridge) {
      entry.bridge.sendSettings(settings);
      entry.config = { ...entry.config, settings };
      return;
    }
    swapFrame({ ...entry.config, settings });
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

  let mediaRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  // Fetches of the scene that failed in a row since one last applied; a
  // failure brings the next refresh forward (see mediaRefreshDelay).
  let mediaRefreshFailures = 0;
  // Fetch the scene again before the soonest media proxy URL on the page
  // expires. Run whenever the page's settings are replaced, and after a fetch
  // that brought nothing, so the timer always follows what is on screen.
  function scheduleMediaRefresh(): void {
    if (mediaRefreshTimer !== null) {
      clearTimeout(mediaRefreshTimer);
      mediaRefreshTimer = null;
    }
    let earliest: number | null = null;
    for (const entry of mounted.values()) {
      const expiry = earliestMediaProxyExpiry(entry.config.settings, entry.config.mediaProxyBase);
      if (expiry !== null && (earliest === null || expiry < earliest)) {
        earliest = expiry;
      }
    }
    if (earliest === null) {
      return;
    }
    const delay = mediaRefreshDelay(earliest, Date.now(), mediaRefreshFailures);
    mediaRefreshTimer = setTimeout(() => {
      mediaRefreshTimer = null;
      void updateScene();
    }, delay);
  }
  scheduleMediaRefresh();

  // The editor's draft layout, kept so a scene update -- which places every
  // widget where it was saved -- doesn't undo a drag the editor has not saved.
  let previewLayout: PreviewWidgetLayout[] | null = null;
  // The editor's unsaved placements, once it has sent any. From then on they
  // are what the page shows: a save the editor made matches them, and a save
  // must not undo an edit made since.
  let draftPlacements: unknown[] | null = null;
  let draftKey = "";
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  // The editor sends settings as entered, so external media in them still
  // names its own host, which a themeable widget's frame refuses. The server
  // answers each draft with, per placement, the proxy URL of each external
  // media URL it signed (`mediaUrls`), and settings from the editor are
  // pointed at those. Each answer replaces the last, so this holds only what
  // the newest draft named.
  let proxiedMedia = new Map<string, Map<string, string>>();
  const signedMediaOf = (placement: Record<string, unknown>): Map<string, string> | undefined =>
    typeof placement.id === "string" ? proxiedMedia.get(placement.id) : undefined;
  const draftSettingsOf = (placement: Record<string, unknown>): Record<string, unknown> => {
    const signed = signedMediaOf(placement);
    const settings = settingsOf(placement);
    return signed ? replaceMediaUrls(settings, signed) : settings;
  };
  // What the server has to see a draft again for: a new widget or theme, and
  // an external media URL it has not signed. A URL it will not sign (the
  // widget loads it directly, or no editor has put it in the scene yet) stays
  // in the key, so it asks once per change rather than once per message; the
  // editor's op putting it in the scene brings the page back here.
  const draftKeyOf = (placements: readonly unknown[]): string =>
    draftFrameKey(placements, (id) => mounted.get(id)?.config.hostsSurface === "alert") +
    JSON.stringify(
      placements.flatMap((raw) => {
        const placement = asRecord(raw);
        const signed = signedMediaOf(placement);
        return externalMediaUrls(settingsOf(placement)).filter((url) => !signed?.has(url));
      })
    );

  window.addEventListener("message", (event) => {
    for (const bridge of bridges) {
      bridge.handleMessage(event);
    }
  });

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
        // Settings reach the widgets now, keystroke by keystroke. Only a new
        // widget or theme needs the server, and an alert area waits for it
        // too, since one is mounted again for any change.
        for (const raw of placements) {
          const placement = asRecord(raw);
          const entry = typeof placement.id === "string" ? mounted.get(placement.id) : undefined;
          const settings = draftSettingsOf(placement);
          if (entry && entry.config.hostsSurface === "" && themeOf(entry.config.settings) === themeOf(settings)) {
            updateSettings(entry.config.id, settings);
          }
        }
        const key = draftKeyOf(placements);
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
    if (fromDraft && draftPlacements) {
      // The editor's newest settings, not the ones this response was built
      // from: they may have changed while it was in flight.
      const latest = new Map(draftPlacements.map((raw) => [asRecord(raw).id, draftSettingsOf(asRecord(raw))]));
      for (const instance of next.widgets) {
        const settings = latest.get(instance.id);
        if (settings && instance.hostsSurface === "" && themeOf(settings) === themeOf(instance.settings)) {
          instance.settings = settings;
        }
      }
    }
    const plan = planSceneUpdate(
      [...mounted.values()].map((entry) => entry.config),
      next.widgets
    );
    for (const id of plan.remove) {
      removePlacement(id);
    }
    for (const instance of plan.place) {
      const entry = mounted.get(instance.id);
      const element = widgetElements.get(instance.id);
      if (entry && element) {
        const wasVisible = entry.config.visible !== false;
        entry.config = { ...instance, settings: entry.config.settings };
        placeAt(element, instance.position);
        if (wasVisible !== (instance.visible !== false)) {
          changeVisibility(entry, element, instance.visible !== false);
        }
        updateSettings(instance.id, instance.settings);
      }
    }
    for (const instance of plan.replace) {
      swapFrame(instance);
    }
    for (const instance of plan.mount) {
      mount(instance);
    }
    stack(plan.order);
    scheduleMediaRefresh();
    applySceneBackground(document.body, next.layout);
    if (previewLayout) {
      applyPreviewLayout(widgetElements, previewLayout);
    }
  }

  /**
   * The ops for the scene's next sequence number. Applied to the document
   * and then to the page through the same update plan a config uses, so a
   * widget whose settings changed is patched or swapped as usual. A gap, or
   * ops that do not apply, means this page missed some: it resyncs.
   */
  function applySceneOps(event: SceneOpsEvent): void {
    if ((event.version ?? "published") !== view) {
      return;
    }
    if (sceneDoc && event.seq <= sceneDoc.seq) {
      return;
    }
    if (!sceneDoc || event.seq !== sceneDoc.seq + 1) {
      void updateScene();
      return;
    }
    try {
      sceneDoc = {
        ...sceneDoc,
        seq: event.seq,
        doc: applyOps(sceneDoc.doc, event.ops),
        meta: mergeMeta(sceneDoc.meta, event.meta),
      };
    } catch (err) {
      console.warn("[scene-manager] scene ops did not apply; resyncing", err);
      void updateScene();
      return;
    }
    // While the editor previews a draft, the draft is what this page shows.
    if (draftPlacements) {
      void updateScene();
      return;
    }
    applySceneConfig(configOfSnapshot(sceneDoc), false);
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
        : await fetch(`${sceneBase}/config${view === "draft" ? "?view=draft" : ""}`, {
            credentials: "same-origin",
            cache: "no-store",
          });
    } catch {
      return draft ? { kind: "keep" } : { kind: "reload" };
    }
    const body: unknown = resp.ok ? await resp.json().catch(() => null) : null;
    const config = parseSceneConfig(body);
    if (draft && config) {
      proxiedMedia = parseMediaUrls(asRecord(body).mediaUrls);
      // The newest draft's key, with what was just signed left out of it, so
      // the same draft posted again does not ask a second time.
      if (draftPlacements) {
        draftKey = draftKeyOf(draftPlacements);
      }
    }
    if (config && config.id === sceneId) {
      // The saved scene comes with its document; later ops apply to it.
      const snapshot = draft ? null : parseSnapshot(asRecord(body).document);
      if (snapshot) {
        sceneDoc = snapshot;
      }
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
          mediaRefreshFailures = 0;
          applySceneConfig(target.config, target.fromDraft);
        } else {
          mediaRefreshFailures += 1;
          scheduleMediaRefresh();
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
    // The scene changed. Only this scene's streams receive the frame, so
    // unlike a restart there is no sibling overlay to tell.
    onSceneOps: applySceneOps,
    onHello: (bootId, publishedSeq, draftSeq) => {
      const seq = view === "draft" ? draftSeq : publishedSeq;
      if (serverBootId !== null && serverBootId !== bootId) {
        reloadOverlay();
        return;
      }
      if (serverBootId !== null) {
        moduleState.refresh();
      }
      serverBootId = bootId;
      // Ops sent while the stream was down are not sent again; nor does a
      // scene the server stopped holding keep this page's numbering.
      if (!sceneDoc || seq !== sceneDoc.seq) {
        void updateScene();
      }
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
