import { useMemo, type CSSProperties } from "react";
import WidgetFrame from "./components/WidgetFrame";
import { useStorageChangeStream } from "./lib/useStorageChangeStream";
import { parseSceneConfigFromUrl, type SceneConfig } from "./lib/sceneConfig";

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
  const { stream } = useStorageChangeStream(wsUrl);

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
        <WidgetFrame key={instance.id} instance={instance} stream={stream} />
      ))}
    </div>
  );
}
