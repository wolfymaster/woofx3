// Top-level overlay component. Resolves the overlay token from the URL
// path, fetches the scene config from `./config`, creates a SceneManager
// backed by a P2 event source, and renders each widget in a WidgetFrame.
//
// Token is extracted from two URL shapes:
//   /o/{token}/         — accessed directly on streamware
//   /overlay/{token}/   — accessed via the API proxy
//
// Event source selection (design §2.4):
//   Default               — WebSocketEventSource; `./events` relative to
//                           location.href, so it routes correctly whether
//                           the page is served by streamware directly or
//                           proxied through the API / Convex.
//   ?eventSource=parent   — ParentFrameEventSource; the embedding Convex
//                           page posts overlay-events frames via postMessage.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import WidgetFrame from "./components/WidgetFrame";
import DisconnectedBanner from "./components/DisconnectedBanner";
import { parseSceneConfigPayload, type SceneConfig } from "./lib/sceneConfig";
import { WebSocketEventSource, ParentFrameEventSource } from "./lib/eventSource";
import { SceneManager } from "./lib/sceneManager";
import type { WidgetStatusReport } from "@woofx3/module-sdk";

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

function extractToken(pathname: string): string | null {
  // /o/{token}/ — direct streamware path
  const direct = pathname.match(/^\/o\/([^/]+)\//)?.[1];
  if (direct) {
    return direct;
  }
  // /overlay/{token}/ — API proxy path; guard against the removed
  // /overlay/scene/ path to avoid matching it if stale clients load it.
  const proxy = pathname.match(/^\/overlay\/([^/]+)\//)?.[1];
  if (proxy && proxy !== "scene") {
    return proxy;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "ready"; scene: SceneConfig }
  | { status: "revoked" }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Token-mode overlay
// ---------------------------------------------------------------------------

interface TokenModeProps {
  token: string;
  useParentFrame: boolean;
}

function TokenModeOverlay({ token, useParentFrame }: TokenModeProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [connected, setConnected] = useState(false);
  const managerRef = useRef<SceneManager | null>(null);

  const fetchConfig = useCallback((): Promise<void> => {
    // `./config` is relative to the overlay shell URL, so it routes
    // correctly through the API proxy, Convex proxy, or direct access.
    const configUrl = new URL("./config", location.href).href;
    console.log("[overlay] fetchConfig →", configUrl);
    return fetch(configUrl)
      .then(async (res) => {
        console.log("[overlay] config response", res.status, res.url);
        if (res.status === 401 || res.status === 403) {
          console.warn("[overlay] token revoked (HTTP " + res.status + ")");
          setLoadState({ status: "revoked" });
          return;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as { scene?: unknown };
        console.log("[overlay] config body", JSON.stringify(body).slice(0, 500));
        if (!body.scene) {
          console.warn("[overlay] config returned no scene — token may not be linked to a scene");
          setLoadState({ status: "error", message: "token has no associated scene" });
          return;
        }
        const scene = parseSceneConfigPayload(body.scene);
        console.log("[overlay] scene parsed —", scene.widgets.length, "widget(s)", {
          layout: scene.layout,
          widgets: scene.widgets.map((w) => ({
            id: w.id,
            canonicalId: w.widgetCanonicalId,
            frameUrl: w.frameUrl,
          })),
        });
        setLoadState({ status: "ready", scene });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[overlay] fetchConfig failed:", message);
        setLoadState({ status: "error", message });
      });
  }, []);

  useEffect(() => {
    const tokenPrefix = token.slice(0, 8) + "…";
    const esLabel = useParentFrame ? "parent-frame" : "websocket";
    console.log("[overlay] starting", { tokenPrefix, eventSource: esLabel });

    const eventSource = useParentFrame
      ? new ParentFrameEventSource({ token })
      : new WebSocketEventSource();

    const eventsUrl = useParentFrame
      ? "(parent postMessage)"
      : new URL("./events", location.href).href;
    console.log("[overlay] event source created", { type: esLabel, url: eventsUrl });

    const onSendStatus = (report: WidgetStatusReport): void => {
      eventSource.send(report);
    };

    const manager = new SceneManager({
      eventSource,
      onSendStatus,
      onControlFrame(action: string): void {
        console.log("[overlay] control frame:", action);
        if (action === "token.revoked") {
          setLoadState({ status: "revoked" });
        }
      },
      onSceneUpdated(): void {
        console.log("[overlay] scene updated — refetching config");
        void fetchConfig();
      },
    });

    manager.refetchConfig = (): void => {
      void fetchConfig();
    };

    managerRef.current = manager;

    function onWindowMessage(event: MessageEvent): void {
      manager.handleWindowMessage(event);
    }
    window.addEventListener("message", onWindowMessage);

    // Patch start to intercept connection-change events.
    const originalStart = eventSource.start.bind(eventSource);
    eventSource.start = (sink) => {
      originalStart({
        ...sink,
        onConnectionChange(c: boolean): void {
          console.log("[overlay] connection", c ? "established" : "lost");
          setConnected(c);
          sink.onConnectionChange?.(c);
        },
      });
    };

    manager.start();
    console.log("[overlay] scene manager started");
    void fetchConfig();

    return () => {
      console.log("[overlay] stopping scene manager");
      window.removeEventListener("message", onWindowMessage);
      manager.stop();
      managerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, useParentFrame]);

  const manager = managerRef.current;

  if (loadState.status === "loading") {
    return <div data-overlay="scene" data-state="loading" style={{ width: "100vw", height: "100vh" }} />;
  }

  if (loadState.status === "revoked") {
    return <div data-overlay="scene" data-state="revoked" style={{ width: "100vw", height: "100vh" }} />;
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

  const scene = loadState.scene;
  const containerStyle: CSSProperties = {
    position: "relative",
    width: scene.layout?.width ? `${scene.layout.width}px` : "100vw",
    height: scene.layout?.height ? `${scene.layout.height}px` : "100vh",
    overflow: "hidden",
  };

  console.log("[overlay] rendering", scene.widgets.length, "widget frame(s)");

  return (
    <div data-overlay="scene" style={containerStyle}>
      <DisconnectedBanner connected={connected} />
      {manager &&
        scene.widgets.map((instance) => (
          <WidgetFrame key={instance.id} instance={instance} manager={manager} />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function SceneOverlay() {
  const token = extractToken(location.pathname);
  const params = new URLSearchParams(location.search);
  const useParentFrame = params.get("eventSource") === "parent";

  if (!token) {
    console.error("[overlay] no token found in URL path:", location.pathname);
    return (
      <div
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
        No overlay token — open this page via its overlay URL.
      </div>
    );
  }

  console.log("[overlay] token mode", {
    tokenPrefix: token.slice(0, 8) + "…",
    eventSource: useParentFrame ? "parent" : "websocket",
  });

  return <TokenModeOverlay key={token} token={token} useParentFrame={useParentFrame} />;
}
