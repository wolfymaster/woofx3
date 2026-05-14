import { useEffect, useMemo, useState, type CSSProperties } from "react";
import WidgetFrame from "./components/WidgetFrame";
import { useStorageChangeStream } from "./lib/useStorageChangeStream";
import { parseSceneConfigFromUrl, type SceneConfig, type WidgetInstance } from "./lib/sceneConfig";
import type { WidgetEventSource } from "./lib/widgetHost";

interface SceneOverlayProps {
  /** Optional explicit scene — when omitted, the overlay first tries
   *  to extract a sceneId from `location.pathname` (`/overlay/scene/{id}`
   *  → fetch from `/api/scene/{id}`) and falls back to parsing
   *  `?config=<urlencoded JSON>` if no path id is present. The query
   *  path is the dev/test mode; production OBS URLs use the path id. */
  scene?: SceneConfig;
}

function resolveModuleStateWsUrl(): string {
  const fromEnv = import.meta.env.VITE_STREAMWARE_MODULE_STATE_WS_URL as string | undefined;
  if (fromEnv) {
    return fromEnv;
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/module-state`;
}

/**
 * Extract the sceneId segment from `/overlay/scene/{id}`. Returns
 * `null` when the pathname is the bare `/overlay/scene` (no id) or
 * an unrelated path — caller falls back to the `?config=` parse.
 */
function extractSceneIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/overlay\/scene\/([^/]+)\/?$/);
  if (!match) {
    return null;
  }
  return decodeURIComponent(match[1]);
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; scene: SceneConfig }
  | { status: "error"; message: string };

/**
 * Top-level overlay for the `/overlay/scene` route. Composes a
 * SceneConfig into a stack of `WidgetFrame`s sharing one
 * `/ws/module-state` subscription. Layout is absolute-positioned
 * inside a container sized by `scene.layout` (when provided).
 *
 * Scene resolution order:
 *  1. Explicit `scene` prop (programmatic mount) — used as-is.
 *  2. URL pathname `/overlay/scene/{id}` — fetch `/api/scene/{id}`.
 *  3. URL search `?config=<urlencoded>` — dev/test inline config.
 */
export default function SceneOverlay({ scene }: SceneOverlayProps) {
  const wsUrl = useMemo(resolveModuleStateWsUrl, []);
  const { stream, events, sendWidgetEvent } = useStorageChangeStream(wsUrl);

  const [loadState, setLoadState] = useState<LoadState>(() => {
    if (scene) {
      return { status: "ready", scene };
    }
    const sceneId = extractSceneIdFromPath(location.pathname);
    if (sceneId) {
      return { status: "loading" };
    }
    // No path id — fall back to inline `?config=` (dev/test path).
    return { status: "ready", scene: parseSceneConfigFromUrl(location.search) };
  });

  useEffect(() => {
    if (scene) {
      setLoadState({ status: "ready", scene });
      return;
    }
    const sceneId = extractSceneIdFromPath(location.pathname);
    if (!sceneId) {
      return;
    }
    let cancelled = false;
    setLoadState({ status: "loading" });
    fetch(`/api/scene/${encodeURIComponent(sceneId)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as SceneConfig;
      })
      .then((next) => {
        if (!cancelled) {
          setLoadState({ status: "ready", scene: next });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setLoadState({ status: "error", message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scene]);

  if (loadState.status === "loading") {
    return (
      <div data-overlay="scene" data-state="loading" style={{ width: "100vw", height: "100vh" }} />
    );
  }
  if (loadState.status === "error") {
    return (
      <div
        data-overlay="scene"
        data-state="error"
        style={{
          width: "100vw",
          height: "100vh",
          color: "white",
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          fontSize: 16,
        }}
      >
        Couldn&apos;t load scene: {loadState.message}
      </div>
    );
  }

  const resolvedScene = loadState.scene;
  const containerStyle: CSSProperties = {
    position: "relative",
    width: resolvedScene.layout?.width ? `${resolvedScene.layout.width}px` : "100vw",
    height: resolvedScene.layout?.height ? `${resolvedScene.layout.height}px` : "100vh",
    overflow: "hidden",
  };

  return (
    <div data-overlay="scene" style={containerStyle}>
      {resolvedScene.widgets.map((instance) => (
        <WidgetFrame
          key={instance.id}
          instance={instance}
          stream={stream}
          events={makeFilteredEventSource(events, instance)}
          onWidgetEvent={sendWidgetEvent}
        />
      ))}
    </div>
  );
}

/**
 * Wrap the shared scene-wide event source so that subscribers tied to
 * a specific widget only see events the widget declared interest in.
 *
 * `acceptedEvents` carries canonical trigger ids
 * (`{moduleId}:trigger:{event_subject}`); the engine pushes events
 * keyed by the bare NATS subject (`event_subject`). We compare the
 * suffix-after-`:trigger:` of every accepted entry with the incoming
 * event's `type`. A widget that didn't declare any acceptedEvents
 * receives nothing — that's the right default for static
 * display-only widgets (no surprises, no firehose).
 */
function makeFilteredEventSource(
  source: WidgetEventSource,
  instance: WidgetInstance,
): WidgetEventSource {
  const accepted = instance.acceptedEvents ?? [];
  // Pre-compute the bare-subject suffix set for O(1) match. Drop
  // anything that doesn't carry the `:trigger:` separator since
  // matching it would be ambiguous.
  const suffixes = new Set<string>();
  for (const id of accepted) {
    const idx = id.indexOf(":trigger:");
    if (idx >= 0) {
      suffixes.add(id.slice(idx + ":trigger:".length));
    }
  }
  return {
    subscribe(handler) {
      if (suffixes.size === 0) {
        return () => {};
      }
      return source.subscribe((event) => {
        if (suffixes.has(event.type)) {
          handler(event);
        }
      });
    },
  };
}
