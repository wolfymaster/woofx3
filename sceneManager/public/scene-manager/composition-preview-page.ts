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
import {
  createCompositionPreview,
  type FrameResolution,
  type PreviewFrame,
  type PreviewFrameFacts,
  type PreviewFrameMeta,
  type PreviewFrameSpec,
} from "./composition-preview";
import { AssetCache, readAheadAssetPaths } from "./asset-loader";
import { replaceMediaUrls } from "./media-url";
import { PAGE_CLOCK } from "./page-clock";
import { createFrameLoadHandler, WidgetBridge } from "./widget-bridge";

/** Must match the routes in sceneManager's routes/composition-preview.ts. */
const FRAMES_PATH = "/preview/composition/frames";
const REFRESH_PATH = "/preview/composition/session/refresh";

/** The session cookie lives 60 s; refreshed well before. */
const REFRESH_INTERVAL_MS = 50_000;

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

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

async function resolveFrames(doc: CompositionDocument): Promise<FrameResolution> {
  const widgets = Object.entries(doc.widgets).map(([id, placement]) => ({
    id,
    widget: placement.widget,
    settings: placement.settings,
  }));
  const response = await fetch(FRAMES_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ widgets }),
  });
  if (!response.ok) {
    throw new Error(`the engine refused to frame the widgets (${response.status})`);
  }
  return parseFrameResolution(await response.json());
}

function mountFrame(
  bridges: Set<WidgetBridge>,
  assets: AssetCache,
  slot: HTMLElement,
  spec: PreviewFrameSpec,
  facts: PreviewFrameFacts
): PreviewFrame {
  const instanceId = `preview.${spec.widgetId}`;
  const moduleId = moduleIdOfCanonicalId(spec.widgetCanonicalId) ?? "";
  const nonce = generateNonce();
  const iframe = document.createElement("iframe");
  iframe.className = "widget-frame";
  if (spec.swapping) {
    iframe.style.opacity = "0";
  }
  iframe.setAttribute("sandbox", "allow-scripts");

  const event: WidgetEvent = {
    type: spec.surface === "alert" ? "alert" : (spec.event?.type ?? "preview"),
    source: "scene-manager",
    time: new Date().toISOString(),
    data: spec.surface === "alert" ? spec.event : (spec.event?.data ?? null),
    eventId: `preview-${nonce}`,
  };
  // Subscriptions waiting for the playhead to run before they get the event.
  const waiting: string[] = [];
  let released = false;

  const bridge: WidgetBridge = new WidgetBridge(instanceId, nonce, {
    onStatusReport: () => {},
    onAssetLoad: assets.scopedTo(moduleId),
    onEventsSubscribe: (subId, queue) => {
      facts.subscribed(queue?.autoComplete === false);
      if (spec.event === null) {
        return;
      }
      if (released) {
        bridge.sendEvent(subId, event);
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
  });
  iframe.addEventListener("load", createFrameLoadHandler(bridge));
  const boot = encodePlacementBoot({
    nonce,
    instanceId,
    settings: replaceMediaUrls(spec.settings, new Map(Object.entries(spec.meta.mediaUrls))),
    linkedResources: spec.meta.linkedResources,
    surface: spec.surface,
    ...(spec.entrance === null ? {} : { behavior: spec.entrance }),
  });
  iframe.src = `${spec.meta.frameUrl}#${boot}`;
  assets.readAhead(readAheadAssetPaths(spec.settings, location.origin), moduleId);

  bridges.add(bridge);
  slot.appendChild(iframe);
  bridge.attach(iframe);
  return {
    sendBehavior: (state) => bridge.sendBehavior(state),
    release: () => {
      if (released) {
        return;
      }
      released = true;
      for (const subId of waiting.splice(0)) {
        bridge.sendEvent(subId, event);
      }
    },
    settingsReads: () => bridge.settingsReads(),
    sendSettings: (settings, mediaUrls) =>
      bridge.sendSettings(replaceMediaUrls(settings, new Map(Object.entries(mediaUrls)))),
    reveal: () => {
      iframe.style.opacity = "";
    },
    unmount: () => {
      bridge.dispose();
      bridge.detach();
      bridges.delete(bridge);
      iframe.remove();
    },
  };
}

function main(): void {
  const viewport = document.getElementById("viewport");
  const stage = document.getElementById("stage");
  if (!viewport || !stage || window.parent === window) {
    return;
  }
  const bridges = new Set<WidgetBridge>();
  const assets = new AssetCache();
  // Reports go to the origin the editor's messages come from, once it has
  // sent one; the first report (`ready`) says only that the page is here.
  let parentOrigin: string | null = null;
  let canvas: { width: number; height: number } | null = null;

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
    resolveFrames,
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

  setInterval(() => {
    void fetch(REFRESH_PATH, { method: "POST", credentials: "same-origin" }).catch(() => {
      // The next load reports the engine as unreachable; the frames already
      // mounted keep playing without the session.
    });
  }, REFRESH_INTERVAL_MS);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  main();
}
