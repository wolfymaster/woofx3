import { useMemo, type CSSProperties } from "react";
import WidgetFrame from "./components/WidgetFrame";
import { useStorageChangeStream } from "./lib/useStorageChangeStream";
import { parseSceneConfigFromUrl, type SceneConfig, type WidgetInstance } from "./lib/sceneConfig";
import type { WidgetEventSource } from "./lib/widgetHost";

interface SceneOverlayProps {
  /** Optional explicit scene — when omitted, falls back to parsing
   *  `?config=<urlencoded JSON>` from the current URL. The latter is
   *  the dev / test path; production will fetch by sceneId once the
   *  api/ surface lands. */
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
 * Top-level overlay for the `/overlay/scene` route. Composes a
 * SceneConfig into a stack of `WidgetFrame`s sharing one
 * `/ws/module-state` subscription. Layout is absolute-positioned
 * inside a container sized by `scene.layout` (when provided).
 */
export default function SceneOverlay({ scene }: SceneOverlayProps) {
  const wsUrl = useMemo(resolveModuleStateWsUrl, []);
  const { stream, events, sendWidgetEvent } = useStorageChangeStream(wsUrl);

  const resolvedScene = useMemo<SceneConfig>(
    () => scene ?? parseSceneConfigFromUrl(location.search),
    [scene]
  );

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
