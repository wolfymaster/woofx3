// An overlay page: plays the scene's composition with the scene runtime
// (@woofx3/scene/runtime), one DOM renderer placing, stacking, showing and
// animating every placement and one scheduler keeping it in step with the
// scene's timeline. The page fills each placement's slot with its content (a
// sandboxed widget frame, or an alert area it draws itself), keeps the scene
// in step with the scene manager (scene-sync.ts), shows the editor's draft
// when the editor frames it (draft-preview.ts), routes delivered events to
// each placement's queue, and drives the Disconnected banner.

import { encodePlacementBoot, type WidgetBehaviorState } from "@woofx3/module-sdk";
import { ALERT_SURFACE, declaresKind, NO_DECLARED_KINDS, PROFILES } from "@woofx3/scene/model";
import { createDomRenderer, createScheduler, type Scheduler, type SchedulerClock } from "@woofx3/scene/runtime";
import {
  AssetCache,
  EventQueueManager,
  mountWidgetFrame,
  type PageHost,
  type QueueRegistration,
  settingsUpdate,
  toWidgetEvent,
  type WidgetBridge,
  type WidgetBridgeCallbacks,
  type WidgetStatusReportPayload,
} from "@woofx3/widget-host/page";
import { earliestMediaProxyExpiry } from "../../contract/media-url";
import { ackPath, type DeliveryFrame } from "../../contract/overlay-stream";
import { type SceneConfig, themeOf, type WidgetPlacementConfig } from "../../contract/scene-config";
import { AckBatcher, DEFAULT_ACK_RETRY, postAck } from "./ack-batcher";
import { AlertAreas } from "./alert-areas";
import { ConnectionStatus } from "./connection-status";
import { DraftPreview } from "./draft-preview";
import { SceneEventSource } from "./event-source";
import { swapFrameIn } from "./frame-swap";
import { ModuleStateCache } from "./module-state";
import { transientOfPreviewLayout } from "./preview-layout";
import type { ReconnectCoordinator } from "./reconnect-coordinator";
import { applySceneBackground } from "./scene-background";
import { compositionOfConfig, parseSnapshot } from "./scene-document";
import { SceneSync, type SceneView } from "./scene-sync";
import { planSceneUpdate } from "./scene-update";
import { startSessionRefresh } from "./session-refresh";
import { BehaviorRelay, entranceOf } from "./widget-behaviors";

/** Under `SESSION_TOKEN_TTL_SECONDS` (60 s, session-token.ts), so a session is renewed before it lapses. */
const REFRESH_INTERVAL_MS = 50_000;
/** A renewal that has not answered in this long counts as failed; the next tick tries again. */
const REFRESH_TIMEOUT_MS = 10_000;

/** What an overlay page runs in: the browser, on a real page. */
export interface OverlayEnv {
  /** The scene the shell was rendered with. */
  scene: SceneConfig;
  /** The scene's sequenced document the shell was rendered with, unparsed. */
  sceneDocument: unknown;
  document: Document;
  /** Where the placements are drawn (`#widgets`). */
  root: HTMLElement;
  location: { search: string; href: string; origin: string; reload(): void };
  /** The page's own `window`: where frames' and the editor's messages arrive. */
  window: Pick<Window, "addEventListener"> & { parent: unknown };
  /** Whether the page is framed (by the editor) rather than loaded on its own (by OBS). */
  framed: boolean;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Show or hide the Disconnected banner. */
  renderConnected(connected: boolean): void;
  /** Timers, warnings and randomness for every unit of the page (page-host.ts). */
  host: PageHost;
  /** What the scene's timeline plays on: the document timeline's clock (page-clock.ts). */
  clock: SchedulerClock<unknown>;
  /** How the overlays of this browser share reconnects and restarts (reconnect-coordinator.ts). */
  coordinator: ReconnectCoordinator;
}

/**
 * A frame's URL with its placement in the fragment (see `WidgetPlacementBoot`):
 * the document is the widget's and cached, the placement never reaches the
 * server. `entrance` is the widget's own entrance, which it is marked with
 * from boot (see `entranceOf`).
 */
function frameSrc(instance: WidgetPlacementConfig, nonce: string, entrance: WidgetBehaviorState | null): string {
  const boot = encodePlacementBoot({
    nonce,
    instanceId: instance.id,
    settings: instance.settings,
    linkedResources: instance.linkedResources ?? {},
    ...(entrance === null ? {} : { behavior: entrance }),
  });
  return `${instance.frameUrl}#${boot}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function createOverlay(env: OverlayEnv): void {
  const sceneData = env.scene;
  applySceneBackground(env.document.body, sceneData.layout);
  const sceneId = sceneData.id;
  // Absolute, never relative: the shell is served at /scene/{sceneId} with no
  // trailing slash, so a `./`-relative URL would resolve against /scene/ and
  // drop the scene id.
  const sceneBase = `/scene/${encodeURIComponent(sceneId)}`;
  // The editor's preview shows the draft; every other overlay what is published.
  const view: SceneView = new URLSearchParams(env.location.search).get("view") === "draft" ? "draft" : "published";
  const fetchFn = (url: string, init?: RequestInit) => env.fetch(url, init);
  const { host } = env;
  const timers = host.timers;

  const bridges = new Set<WidgetBridge>();
  const queueManager = new EventQueueManager(timers);
  const deliveredBatcher = new AckBatcher((eventId) => ackPath(sceneBase, eventId, "delivered"), {
    fetchFn: fetchFn as typeof fetch,
    host,
  });
  const completedBatcher = new AckBatcher((eventId) => ackPath(sceneBase, eventId, "completed"), {
    fetchFn: fetchFn as typeof fetch,
    host,
  });

  const moduleState = new ModuleStateCache(async (instanceId, key) => {
    const url = `${sceneBase}/widget/${encodeURIComponent(instanceId)}/storage?key=${encodeURIComponent(key)}`;
    const resp = await fetchFn(url, { credentials: "same-origin" });
    if (!resp.ok) {
      throw new Error(`module state ${key}: ${resp.status}`);
    }
    const body = (await resp.json()) as { value?: unknown };
    return body.value ?? null;
  });

  const assets = new AssetCache({ pageOrigin: env.location.origin, fetchFn, host });

  /** `moduleId` is the placement's, from the scene record. */
  function postStatus(instanceId: string, moduleId: string, report: WidgetStatusReportPayload): void {
    fetchFn(`${sceneBase}/widget/${encodeURIComponent(instanceId)}/status`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moduleId,
        widgetCanonicalId: report.widgetCanonicalId,
        key: report.key,
        value: report.value,
        ts: report.ts,
      }),
    }).catch(() => {
      // A status report is the widget's latest value, sent again on its next
      // change; one lost to a dropped connection is superseded, not owed.
    });
  }

  // What each placement on the page was last configured with, by id. The
  // runtime decides where a placement is and whether it shows; this is what
  // its content (a frame, or an alert area) is made from.
  let configs = new Map<string, WidgetPlacementConfig>(sceneData.widgets.map((instance) => [instance.id, instance]));

  // The content in each placement's slot: how to remove it, its bridge when
  // it is framed, and a frame being swapped in, if any.
  interface MountedContent {
    slot: HTMLElement;
    unmount: () => void;
    bridge: WidgetBridge | null;
    swap: { cancel: () => void } | null;
  }
  const contents = new Map<string, MountedContent>();

  // The runtime calls back into the page (a frame painted) only from events
  // after it was created, never while `createScheduler` runs.
  let scheduler: Scheduler | null = null;
  function playing(): Scheduler {
    if (scheduler === null) {
      throw new Error("scene: the scene runtime is not running yet");
    }
    return scheduler;
  }

  const relay = new BehaviorRelay((id, state) => contents.get(id)?.bridge?.sendBehavior(state), host.log);

  const alertAreas = new AlertAreas({
    document: env.document,
    sceneBase,
    bridges,
    queues: queueManager,
    assets,
    postStatus,
    ackAlert: (kind, eventId, instanceId) =>
      postAck(fetchFn as typeof fetch, ackPath(sceneBase, eventId, kind), [instanceId], DEFAULT_ACK_RETRY, host),
    rendered: (instanceId) => playing().widgetRendered(instanceId),
    clock: env.clock,
    host,
  });

  const draft = new DraftPreview({
    isAlertArea: (id) => configs.get(id)?.hostsSurface === ALERT_SURFACE,
    onLayout: (layout) => playing().setTransient(transientOfPreviewLayout(layout, configs.keys())),
    // Settings reach the widgets now, keystroke by keystroke. Only a new
    // widget or theme needs the server, and an alert area waits for it too,
    // since one is mounted again for any change.
    onPlacements: (placements) => {
      for (const raw of placements) {
        const placement = asRecord(raw);
        const config = typeof placement.id === "string" ? configs.get(placement.id) : undefined;
        const settings = draft.settingsFor(placement);
        if (config && config.hostsSurface === "" && themeOf(config.settings) === themeOf(settings)) {
          updateSettings(config.id, settings);
        }
      }
    },
    requestUpdate: () => void sync.update(),
    timers,
  });

  const sync: SceneSync = new SceneSync({
    sceneId,
    sceneBase,
    view,
    initialDocument: parseSnapshot(env.sceneDocument),
    fetch: fetchFn,
    timers,
    draftPlacements: () => draft.placements(),
    onDraftAnswered: (body) => draft.answered(body),
    apply: (config, fromDraft) => applySceneConfig(config, fromDraft),
    earliestMediaExpiry: () => {
      let earliest: number | null = null;
      for (const config of configs.values()) {
        const expiry = earliestMediaProxyExpiry(config.settings, config.mediaProxyBase);
        if (expiry !== null && (earliest === null || expiry < earliest)) {
          earliest = expiry;
        }
      }
      return earliest;
    },
    reload: () => env.location.reload(),
    warn: (message, detail) => host.log.warn(message, detail),
  });

  // The composition the page plays: placements from `configs`, everything
  // else from the scene's document.
  let composition = compositionOfConfig(sceneData, sync.document()?.doc ?? null);

  interface Frame {
    element: HTMLIFrameElement;
    bridge: WidgetBridge;
    unmount: () => void;
  }

  /**
   * A widget's frame, filling its slot. A `swapping` one is loading to
   * replace another (see `swapFrame`): it stays transparent until it has
   * painted, and is not marked with the widget's entrance, which has played.
   */
  const mountFrame = (
    instance: WidgetPlacementConfig,
    slot: HTMLElement,
    swapping: boolean,
    onRendered: () => void
  ): Frame => {
    // This frame's event subscription and the queue it registered. A frame
    // swapped in registers its own; the placement's events follow the newest.
    let subscription: { subId: string; queue: QueueRegistration } | null = null;
    const declared = instance.behaviorKinds ?? NO_DECLARED_KINDS;
    const entrance = swapping
      ? null
      : entranceOf(composition, instance.id, (type, kind) => declaresKind(declared, type, kind));
    let storageTarget: { instanceId: string; sendStorageValue(key: string, value: unknown): void } | null = null;

    const frame = mountWidgetFrame({
      slot,
      instanceId: instance.id,
      bridges,
      document: env.document,
      host,
      hidden: swapping,
      src: (nonce) => frameSrc(instance, nonce, entrance),
      callbacks: ({ bridge }): WidgetBridgeCallbacks => {
        const target = {
          instanceId: instance.id,
          sendStorageValue: (key: string, value: unknown) => bridge().sendStorageValue(key, value),
        };
        storageTarget = target;
        return {
          // The module comes from the scene record, not from the module the
          // widget names in its hello (see module-state.ts).
          storage: {
            get: (key) => moduleState.peek(instance.moduleId, key),
            subscribe: (key) => moduleState.watch(instance.moduleId, key, target),
            unsubscribe: (key) => moduleState.unwatch(instance.moduleId, key, target),
          },
          onStatusReport: (report) => postStatus(instance.id, instance.moduleId, report),
          onAssetLoad: assets.loaderFor(instance.moduleId),
          onEventsSubscribe: (subId, queue) => {
            playing().widgetSubscribed(instance.id, queue?.autoComplete === false);
            const previous = subscription;
            subscription = {
              subId,
              queue: queueManager.register(
                instance.id,
                queue,
                (item) => bridge().sendEvent(subId, toWidgetEvent(item, timers.now())),
                // The widget never finished it. The page gives up on it, so the
                // server must too: acknowledged as completed, or it would stay
                // open and play again after the next reload.
                (eventId) => completedBatcher.add(eventId, instance.id)
              ),
            };
            if (previous !== null) {
              queueManager.unregister(previous.queue);
            }
          },
          onEventsUnsubscribe: (subId) => {
            if (subscription?.subId === subId) {
              queueManager.unregister(subscription.queue);
              subscription = null;
            }
          },
          onEventComplete: (subId, eventId) => {
            if (subscription?.subId === subId) {
              queueManager.complete(subscription.queue, eventId);
            }
            completedBatcher.add(eventId, instance.id);
          },
          onDispose: () => {
            if (subscription !== null) {
              queueManager.unregister(subscription.queue);
              subscription = null;
            }
          },
          onRendered,
        };
      },
      onUnmount: () => {
        if (storageTarget !== null) {
          moduleState.unwatchAll(storageTarget);
        }
      },
    });
    assets.warm(instance.moduleId, instance.settings);
    return { element: frame.element, bridge: frame.bridge, unmount: frame.unmount };
  };

  /** Put a placement's content in its slot, from its current config. */
  function mountContent(slot: HTMLElement, id: string): void {
    const instance = configs.get(id);
    if (!instance) {
      throw new Error(`scene: placement ${id} is on the page with no config`);
    }
    if (instance.hostsSurface === ALERT_SURFACE) {
      contents.set(id, { slot, unmount: alertAreas.mount(instance.id, slot), bridge: null, swap: null });
    } else {
      const frame = mountFrame(instance, slot, false, () => playing().widgetRendered(id));
      contents.set(id, { slot, unmount: frame.unmount, bridge: frame.bridge, swap: null });
    }
  }

  function unmountContent(id: string): void {
    const entry = contents.get(id);
    entry?.swap?.cancel();
    entry?.unmount();
    contents.delete(id);
  }

  const renderer = createDomRenderer<HTMLElement>({
    document: env.document,
    root: env.root,
    mountContent: (slot, id, widget) => {
      if (configs.get(id)?.widgetCanonicalId !== widget) {
        throw new Error(`scene: placement ${id} is mounted as ${widget}, which its config does not name`);
      }
      mountContent(slot, id);
      return () => {
        unmountContent(id);
        relay.forget(id);
      };
    },
    onDelegate: (id, request) => relay.handle(id, request),
  });
  scheduler = createScheduler({
    doc: composition,
    profile: PROFILES.scene,
    clock: env.clock,
    renderer,
    // Read at every plan, so it follows `configs` as the scene changes.
    declaredKinds: (id) => configs.get(id)?.behaviorKinds,
    onSkipped: (skips) => host.log.warn("[scene-manager] scene behaviors skipped", skips),
  });

  /**
   * Give a placement a new frame without a blank moment: the new frame loads
   * invisibly in the same slot and takes the old one's place once it has
   * painted. A newer swap for the placement cancels this one. An alert area
   * has no frame, so its content is simply mounted again.
   */
  function swapFrame(next: WidgetPlacementConfig): void {
    const entry = contents.get(next.id);
    if (!entry) {
      return;
    }
    if (next.hostsSurface !== "" || entry.bridge === null) {
      // The new content first: an alert area registers its queue as it
      // mounts, taking over the alerts still waiting in the old one's, which
      // is then retired with only what it was playing.
      entry.swap?.cancel();
      mountContent(entry.slot, next.id);
      entry.unmount();
      return;
    }
    entry.swap?.cancel();
    entry.swap = swapFrameIn({
      mountFresh: (painted) => {
        const frame = mountFrame(next, entry.slot, true, painted);
        return {
          ...frame,
          reveal: () => {
            frame.element.style.opacity = "";
          },
        };
      },
      retire: () => entry.unmount(),
      swapped: (fresh) => {
        contents.set(next.id, { slot: entry.slot, unmount: fresh.unmount, bridge: fresh.bridge, swap: null });
        for (const state of relay.ongoing(next.id)) {
          fresh.bridge.sendBehavior(state);
        }
        playing().widgetRendered(next.id);
      },
      schedule: (callback, ms) => {
        const timer = timers.setTimeout(callback, ms);
        return () => timers.clearTimeout(timer);
      },
    });
  }

  /**
   * Bring a placement whose frame stays up to date with new settings: patched
   * in through the widget's bindings, or a fresh frame when the widget's
   * script read one that changed (see `settingsUpdate`).
   */
  function updateSettings(id: string, settings: Record<string, unknown>): void {
    const config = configs.get(id);
    const entry = contents.get(id);
    if (!config || !entry) {
      return;
    }
    // While a frame is being swapped in, nothing is known about it yet.
    const reads = entry.swap || !entry.bridge ? null : entry.bridge.settingsReads();
    const decision = settingsUpdate(config.settings, settings, reads);
    if (decision === "none") {
      return;
    }
    configs.set(id, { ...config, settings });
    if (decision === "patch" && entry.bridge) {
      entry.bridge.sendSettings(settings);
      return;
    }
    swapFrame({ ...config, settings });
  }

  function applySceneConfig(next: SceneConfig, fromDraft: boolean): void {
    const draftPlacements = draft.placements();
    if (fromDraft && draftPlacements) {
      // The editor's newest settings, not the ones this response was built
      // from: they may have changed while it was in flight.
      const latest = new Map(draftPlacements.map((raw) => [asRecord(raw).id, draft.settingsFor(asRecord(raw))]));
      for (const instance of next.widgets) {
        const settings = latest.get(instance.id);
        if (settings && instance.hostsSurface === "" && themeOf(settings) === themeOf(instance.settings)) {
          instance.settings = settings;
        }
      }
    }
    const previous = configs;
    const plan = planSceneUpdate([...previous.values()], next.widgets);
    // A placement whose frame stays keeps the settings its frame has until
    // `updateSettings` below decides how the new ones reach it.
    const kept = new Set(plan.place.map((instance) => instance.id));
    configs = new Map(
      next.widgets.map((instance) => {
        const old = previous.get(instance.id);
        return [instance.id, kept.has(instance.id) && old ? { ...instance, settings: old.settings } : instance];
      })
    );
    composition = compositionOfConfig(next, sync.document()?.doc ?? null, fromDraft ? draftPlacements : null);
    // Removes, mounts and moves placements; one whose widget changed is
    // mounted again, from its new config.
    playing().setDocument(composition);
    for (const instance of plan.replace) {
      if (previous.get(instance.id)?.widgetCanonicalId === instance.widgetCanonicalId) {
        swapFrame(instance);
      }
    }
    for (const instance of plan.place) {
      updateSettings(instance.id, instance.settings);
    }
    const layout = draft.layout();
    if (layout) {
      playing().setTransient(transientOfPreviewLayout(layout, configs.keys()));
    }
    sync.scheduleMediaRefresh();
    applySceneBackground(env.document.body, next.layout);
  }

  sync.scheduleMediaRefresh();

  env.window.addEventListener("message", (event) => {
    for (const bridge of bridges) {
      bridge.handleMessage(event);
    }
  });

  // Only a page that frames this overlay can move its widgets, and it can
  // only move them on its own screen: nothing here is saved or sent on. OBS
  // loads the overlay top-level, where `window.parent` is the window itself.
  if (env.framed) {
    env.window.addEventListener("message", (event) => {
      if (event.source === env.window.parent) {
        draft.handleMessage(event.data);
      }
    });
  }

  // One owner for the banner. Both reachability signals below report into it
  // rather than toggling the DOM themselves, so they cannot overwrite each
  // other's verdict.
  const status = new ConnectionStatus(env.renderConnected);

  // Identity of the sceneManager process behind the current stream. A
  // different value on a later stream means the server restarted while we
  // were away, so the scene config baked into this document may be stale:
  // reload and let the shell be re-rendered.
  let serverBootId: string | null = null;

  const coordinator = env.coordinator;

  // Reloading is how this page recovers from anything a live stream can't
  // fix: the shell re-renders the current scene config and re-mints the
  // session cookie from the ?token= still in the URL. Siblings are told
  // first -- once we start reloading, this page is gone and can't relay.
  function reloadOverlay(): void {
    coordinator.requestPeerReload();
    env.location.reload();
  }
  coordinator.onPeerReload(() => {
    // A sibling detected the restart. Reload without rebroadcasting.
    env.location.reload();
  });

  const eventSource = new SceneEventSource({
    url: new URL(`${sceneBase}/events`, env.location.href).toString(),
    fetchFn: fetchFn as typeof fetch,
    coordinator,
    setTimer: (callback, ms) => timers.setTimeout(callback, ms),
    clearTimer: (handle) => timers.clearTimeout(handle),
  });
  eventSource.start({
    onFrame: (frame: DeliveryFrame) => {
      alertAreas.readAhead(frame.instanceId, frame.value);
      const queued = queueManager.enqueue(frame.instanceId, {
        eventId: frame.eventId,
        type: frame.type,
        key: frame.key,
        value: frame.value,
      });
      // Only what reached a queue is delivered. A placement whose widget has
      // not subscribed yet gets the event when the server sends it again.
      if (queued) {
        deliveredBatcher.add(frame.eventId, frame.instanceId);
      }
    },
    onModuleState: (frame) => moduleState.apply(frame.moduleId, frame.key, frame.value),
    onCancel: (frame) => queueManager.cancel(frame.instanceId, frame.eventIds),
    onOpenSet: (frame) => queueManager.retainOpen(frame.deliveries),
    onConnectionChange: (connected) => status.set("stream", connected),
    // The scene changed. Only this scene's streams receive the frame, so
    // unlike a restart there is no sibling overlay to tell.
    onSceneOps: (event) => sync.applyOps(event),
    onHello: (bootId, publishedSeq, draftSeq) => {
      if (serverBootId !== null && serverBootId !== bootId) {
        reloadOverlay();
        return;
      }
      if (serverBootId !== null) {
        moduleState.refresh();
      }
      serverBootId = bootId;
      sync.onStreamOpened(publishedSeq, draftSeq);
    },
    onSessionExpired: () => {
      // Our 60s session JWT lapsed while the server was away, so every
      // reconnect would 401 forever and we'd never see the hello frame that
      // reveals a restart. Only a page load mints a new session. Alone, as on
      // a refused renewal: the cookie is this scene's, and a sibling's own
      // renewal decides for it.
      env.location.reload();
    },
  });

  // The overlay token the page was opened with: a refresh carries it so the
  // session can be verified again without reloading (routes/session.ts).
  const overlayToken = new URLSearchParams(env.location.search).get("token") ?? "";
  startSessionRefresh({
    refresh: () =>
      fetchFn(`${sceneBase}/session/refresh`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: overlayToken }),
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      }),
    onHealth: (healthy) => status.set("session", healthy),
    // Each page of the scene holds the same cookie and finds it expired on
    // its own next renewal, so this page reloads alone.
    onExpired: () => env.location.reload(),
    intervalMs: REFRESH_INTERVAL_MS,
    setInterval: (callback, ms) => timers.setInterval(callback, ms),
  });
}
