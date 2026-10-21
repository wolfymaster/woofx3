// Entry of `/preview/composition`: the composition preview the dashboard's
// alert editor embeds (see composition-preview.ts for what it does). This
// wires it to the window: the editor's messages, the engine's framing of the
// widgets, sandboxed widget frames and their bridges, and the session the
// page was opened with.
//
// Only a page that frames this one can drive it, and only on its own screen:
// nothing here is saved or sent on. Opened top-level, the page does nothing.

import { encodePlacementBoot, type WidgetEvent } from "@woofx3/module-sdk";
import {
  type CompositionDocument,
  isDeclaredBehaviorKinds,
  moduleIdOfCanonicalId,
  NO_DECLARED_KINDS,
} from "@woofx3/scene/model";
import { fitCanvas, isPreviewMessage, type PreviewProblem, type PreviewReport } from "@woofx3/scene/runtime";
import { AssetCache, mountWidgetFrame, type WidgetBridge } from "@woofx3/widget-host/page";
import { replaceMediaUrls } from "../../contract/media-url";
import {
  createCompositionPreview,
  type FrameResolution,
  type PreviewFrame,
  type PreviewFrameFacts,
  type PreviewFrameMeta,
  type PreviewFrameSpec,
} from "./composition-preview";
import { PAGE_CLOCK } from "./page-clock";
import { startSessionRefresh } from "./session-refresh";

/** Must match the routes in sceneManager's routes/composition-preview.ts. */
const FRAMES_PATH = "/preview/composition/frames";
const REFRESH_PATH = "/preview/composition/session/refresh";

/** The session cookie lives 60 s (`SESSION_TOKEN_TTL_SECONDS`); renewed well before. */
const REFRESH_INTERVAL_MS = 50_000;
/** A renewal that has not answered in this long counts as failed; the next tick tries again. */
const REFRESH_TIMEOUT_MS = 10_000;

/**
 * What a load reports once the page's session has lapsed: the page cannot
 * mint another itself (the token it was opened with is single-use and
 * short-lived), so the editor has to open the preview again.
 */
export const SESSION_EXPIRED_DETAIL = "the preview session has expired; reopen the alert editor to start a new one";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

/** The engine's answer to `POST /preview/composition/frames`, read defensively. */
export function parseFrameResolution(body: unknown): FrameResolution {
  if (!isRecord(body) || !isRecord(body.widgets)) {
    throw new Error("the engine's framing answer is malformed");
  }
  const widgets: Record<string, PreviewFrameMeta> = {};
  for (const [id, raw] of Object.entries(body.widgets)) {
    if (!isRecord(raw) || typeof raw.frameUrl !== "string" || !raw.frameUrl.startsWith("/frames/")) {
      continue;
    }
    widgets[id] = {
      frameUrl: raw.frameUrl,
      linkedResources: stringRecord(raw.linkedResources),
      mediaUrls: stringRecord(raw.mediaUrls),
      behaviorKinds: isDeclaredBehaviorKinds(raw.behaviorKinds) ? raw.behaviorKinds : NO_DECLARED_KINDS,
    };
  }
  const problems: PreviewProblem[] = [];
  for (const raw of Array.isArray(body.problems) ? body.problems : []) {
    if (
      isRecord(raw) &&
      (raw.kind === "unknown-widget" || raw.kind === "unframed-widget") &&
      typeof raw.id === "string"
    ) {
      problems.push({ kind: raw.kind, id: raw.id });
    }
  }
  return { widgets, problems };
}

/**
 * How a load asks the engine to frame its widgets. A refusal of the session
 * (401), or a renewal already refused, is reported as the session having
 * expired: the one thing the editor can act on.
 */
export function createFrameResolver(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  sessionLapsed: () => boolean
): (doc: CompositionDocument) => Promise<FrameResolution> {
  return async (doc) => {
    if (sessionLapsed()) {
      throw new Error(SESSION_EXPIRED_DETAIL);
    }
    const widgets = Object.entries(doc.widgets).map(([id, placement]) => ({
      id,
      widget: placement.widget,
      settings: placement.settings,
    }));
    const response = await fetchFn(FRAMES_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgets }),
    });
    if (response.status === 401) {
      throw new Error(SESSION_EXPIRED_DETAIL);
    }
    if (!response.ok) {
      throw new Error(`the engine refused to frame the widgets (${response.status})`);
    }
    return parseFrameResolution(await response.json());
  };
}

function mountFrame(
  bridges: Set<WidgetBridge>,
  assets: AssetCache,
  slot: HTMLElement,
  spec: PreviewFrameSpec,
  facts: PreviewFrameFacts
): PreviewFrame {
  const instanceId = `preview.${spec.widgetId}`;
  const moduleId = moduleIdOfCanonicalId(spec.widgetCanonicalId);
  // Subscriptions waiting for the playhead to run before they get the event.
  const waiting: string[] = [];
  let released = false;
  let event: WidgetEvent | null = null;

  const frame = mountWidgetFrame({
    slot,
    instanceId,
    bridges,
    hidden: spec.swapping,
    src: (nonce) => {
      const boot = encodePlacementBoot({
        nonce,
        instanceId,
        settings: replaceMediaUrls(spec.settings, new Map(Object.entries(spec.meta.mediaUrls))),
        linkedResources: spec.meta.linkedResources,
        surface: spec.surface,
        ...(spec.entrance === null ? {} : { behavior: spec.entrance }),
      });
      return `${spec.meta.frameUrl}#${boot}`;
    },
    callbacks: ({ nonce, bridge }) => {
      event = {
        type: spec.surface === "alert" ? "alert" : (spec.event?.type ?? "preview"),
        source: "scene-manager",
        time: new Date().toISOString(),
        data: spec.surface === "alert" ? spec.event : (spec.event?.data ?? null),
        eventId: `preview-${nonce}`,
      };
      return {
        onStatusReport: () => {},
        onAssetLoad: assets.loaderFor(moduleId),
        onEventsSubscribe: (subId, queue) => {
          facts.subscribed(queue?.autoComplete === false);
          if (spec.event === null) {
            return;
          }
          if (released) {
            bridge().sendEvent(subId, event!);
          } else {
            waiting.push(subId);
          }
        },
        onEventsUnsubscribe: (subId) => {
          const at = waiting.indexOf(subId);
          if (at >= 0) {
            waiting.splice(at, 1);
          }
        },
        onEventComplete: () => facts.completed(),
        onDispose: () => {},
        onRendered: () => facts.rendered(),
      };
    },
  });
  assets.warm(moduleId, spec.settings);

  return {
    sendBehavior: (state) => frame.bridge.sendBehavior(state),
    release: () => {
      if (released) {
        return;
      }
      released = true;
      for (const subId of waiting.splice(0)) {
        frame.bridge.sendEvent(subId, event!);
      }
    },
    settingsReads: () => frame.bridge.settingsReads(),
    sendSettings: (settings, mediaUrls) =>
      frame.bridge.sendSettings(replaceMediaUrls(settings, new Map(Object.entries(mediaUrls)))),
    reveal: () => frame.reveal(),
    unmount: () => frame.unmount(),
  };
}

function main(): void {
  const viewport = document.getElementById("viewport");
  const stage = document.getElementById("stage");
  if (!viewport || !stage || window.parent === window) {
    return;
  }
  const bridges = new Set<WidgetBridge>();
  const assets = new AssetCache({ pageOrigin: location.origin });
  // Reports go to the origin the editor's messages come from, once it has
  // sent one; the first report (`ready`) says only that the page is here.
  let parentOrigin: string | null = null;
  let canvas: { width: number; height: number } | null = null;
  let sessionLapsed = false;

  const fitStage = (): void => {
    if (canvas === null) {
      return;
    }
    stage.style.width = `${canvas.width}px`;
    stage.style.height = `${canvas.height}px`;
    const fit = fitCanvas(canvas, { width: viewport.clientWidth, height: viewport.clientHeight });
    stage.style.transform = `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`;
  };

  const preview = createCompositionPreview<HTMLElement, ReturnType<typeof setTimeout>>({
    document,
    stage,
    fitStage: (size) => {
      canvas = size;
      fitStage();
    },
    baseClock: PAGE_CLOCK,
    resolveFrames: createFrameResolver(
      (url, init) => fetch(url, init),
      () => sessionLapsed
    ),
    mountFrame: (slot, spec, facts) => mountFrame(bridges, assets, slot, spec, facts),
    post: (report: PreviewReport) => window.parent.postMessage(report, parentOrigin ?? "*"),
  });

  window.addEventListener("message", (event) => {
    if (event.source === window.parent) {
      // An opaque origin cannot be addressed; such a parent gets "*".
      if (isPreviewMessage(event.data) && event.origin !== "null") {
        parentOrigin = event.origin;
      }
      preview.handle(event.data);
      return;
    }
    for (const bridge of bridges) {
      bridge.handleMessage(event);
    }
  });
  window.addEventListener("resize", fitStage);

  // Renewed as an overlay's session is. A renewal that fails for any other
  // reason is tried again on the next tick; the frames already mounted keep
  // playing either way, and only the next load needs the session.
  startSessionRefresh({
    refresh: () =>
      fetch(REFRESH_PATH, {
        method: "POST",
        credentials: "same-origin",
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      }),
    onHealth: () => {},
    onExpired: () => {
      sessionLapsed = true;
    },
    intervalMs: REFRESH_INTERVAL_MS,
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  main();
}
