// Top-level overlay component. Resolves the scene config using the
// priority order from design §5.2.1:
//
//   1. Token mode  — URL path matches /o/{token}/
//   2. Legacy mode — URL path matches /overlay/scene/{id}
//   3. Dev/test    — ?config= inline JSON
//
// Token mode creates a SceneManager backed by the P2 WebSocket (or
// parent-frame) event source; legacy mode preserves the old storage WS
// path unchanged.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import WidgetFrame from "./components/WidgetFrame";
import DisconnectedBanner from "./components/DisconnectedBanner";
import { parseSceneConfigFromUrl, parseSceneConfigPayload, type SceneConfig } from "./lib/sceneConfig";
import { WebSocketEventSource, ParentFrameEventSource } from "./lib/eventSource";
import { SceneManager } from "./lib/sceneManager";
import type { WidgetStatusReport } from "@woofx3/module-sdk";

// ---------------------------------------------------------------------------
// URL resolution helpers
// ---------------------------------------------------------------------------

function extractToken(pathname: string): string | null {
  return pathname.match(/^\/o\/([^/]+)\//)?.[1] ?? null;
}

function extractSceneId(pathname: string): string | null {
  const m = pathname.match(/^\/overlay\/scene\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
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

  // Manager is stable for the lifetime of the component (token doesn't
  // change without a full remount via key prop from the router).
  const managerRef = useRef<SceneManager | null>(null);

  const fetchConfig = useCallback((): Promise<void> => {
    return fetch("./config")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as { scene?: unknown };
        const scene = parseSceneConfigPayload(body.scene ?? body);
        setLoadState({ status: "ready", scene });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setLoadState({ status: "error", message });
      });
  }, []);

  useEffect(() => {
    const eventSource = useParentFrame
      ? new ParentFrameEventSource({ token })
      : new WebSocketEventSource();

    const onSendStatus = (report: WidgetStatusReport): void => {
      eventSource.send(report);
    };

    const manager = new SceneManager({
      eventSource,
      onSendStatus,
      onControlFrame(action: string): void {
        if (action === "token.revoked") {
          setLoadState({ status: "revoked" });
        }
      },
      onSceneUpdated(): void {
        void fetchConfig();
      },
    });

    manager.refetchConfig = (): void => {
      void fetchConfig();
    };

    managerRef.current = manager;

    // Register window message relay before starting the source so no
    // messages are dropped between start and the listener attach.
    function onWindowMessage(event: MessageEvent): void {
      manager.handleWindowMessage(event);
    }
    window.addEventListener("message", onWindowMessage);

    // Override connection-change callback after construction so we can
    // wire it to the component's connected state.
    const originalStart = eventSource.start.bind(eventSource);
    eventSource.start = (sink) => {
      originalStart({
        ...sink,
        onConnectionChange(c: boolean): void {
          setConnected(c);
          sink.onConnectionChange?.(c);
        },
      });
    };

    manager.start();
    void fetchConfig();

    return () => {
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

  const resolvedScene = loadState.scene;
  const containerStyle: CSSProperties = {
    position: "relative",
    width: resolvedScene.layout?.width ? `${resolvedScene.layout.width}px` : "100vw",
    height: resolvedScene.layout?.height ? `${resolvedScene.layout.height}px` : "100vh",
    overflow: "hidden",
  };

  return (
    <div data-overlay="scene" style={containerStyle}>
      <DisconnectedBanner connected={connected} />
      {manager &&
        resolvedScene.widgets.map((instance) => (
          <WidgetFrame key={instance.id} instance={instance} manager={manager} />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy mode — /overlay/scene/{id}
// ---------------------------------------------------------------------------

// Legacy mode keeps the existing storage-WS wiring. The WidgetFrame
// component now requires a SceneManager, so we create a minimal one
// that is not backed by an event source (legacy widgets use bundleUrl
// and the old contentWindow injection shim, which is gone — but we keep
// the path working for known-same-origin bundle URLs via the P1 bridge).

function resolveModuleStateWsUrl(): string {
  const fromEnv = import.meta.env.VITE_STREAMWARE_MODULE_STATE_WS_URL as string | undefined;
  if (fromEnv) {
    return fromEnv;
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/module-state`;
}

interface LegacyModeProps {
  sceneId: string;
}

function LegacyModeOverlay({ sceneId }: LegacyModeProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  // Create a stub event source (no-op) for the scene manager — legacy
  // mode relied on the old useStorageChangeStream hook which we keep
  // here as a direct WS subscriber wired to the manager.
  const managerRef = useRef<SceneManager | null>(null);

  useEffect(() => {
    const wsUrl = resolveModuleStateWsUrl();
    // Minimal no-op event source so the scene manager has something to
    // start/stop without errors.
    const noopSource = {
      start() {},
      stop() {},
      send() {},
    };

    const manager = new SceneManager({ eventSource: noopSource });
    managerRef.current = manager;

    function onWindowMessage(event: MessageEvent): void {
      manager.handleWindowMessage(event);
    }
    window.addEventListener("message", onWindowMessage);
    manager.start();

    // Open the legacy storage WS and fan storage changes to the manager.
    let ws: WebSocket | null = null;
    let stopped = false;

    function connectWs(): void {
      if (stopped) {
        return;
      }
      ws = new WebSocket(wsUrl);
      ws.onmessage = (msg) => {
        try {
          const payload = JSON.parse(msg.data as string) as Record<string, unknown>;
          if (
            typeof payload.moduleId === "string" &&
            payload.moduleId &&
            typeof payload.key === "string" &&
            payload.key
          ) {
            manager.deliverStorage(payload.moduleId, payload.key, payload.value);
          }
        } catch {
          // Malformed payload — ignore.
        }
      };
    }

    // Fetch the scene config.
    let cancelled = false;
    fetch(`/api/scene/${encodeURIComponent(sceneId)}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as SceneConfig;
      })
      .then((scene) => {
        if (!cancelled) {
          setLoadState({ status: "ready", scene });
          connectWs();
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
      stopped = true;
      window.removeEventListener("message", onWindowMessage);
      manager.stop();
      managerRef.current = null;
      if (ws) {
        ws.onmessage = null;
        ws.close();
        ws = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  const manager = managerRef.current;

  if (loadState.status === "loading") {
    return <div data-overlay="scene" data-state="loading" style={{ width: "100vw", height: "100vh" }} />;
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

  const resolvedScene = (loadState as { status: "ready"; scene: SceneConfig }).scene;
  const containerStyle: CSSProperties = {
    position: "relative",
    width: resolvedScene.layout?.width ? `${resolvedScene.layout.width}px` : "100vw",
    height: resolvedScene.layout?.height ? `${resolvedScene.layout.height}px` : "100vh",
    overflow: "hidden",
  };

  return (
    <div data-overlay="scene" style={containerStyle}>
      {manager &&
        resolvedScene.widgets.map((instance) => (
          <WidgetFrame key={instance.id} instance={instance} manager={manager} />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dev/test inline mode — ?config= param
// ---------------------------------------------------------------------------

interface DevModeProps {
  search: string;
}

function DevModeOverlay({ search }: DevModeProps) {
  const scene = useMemo(() => parseSceneConfigFromUrl(search), [search]);

  const managerRef = useRef<SceneManager | null>(null);
  const manager = useMemo(() => {
    const noopSource = { start() {}, stop() {}, send() {} };
    const m = new SceneManager({ eventSource: noopSource });
    managerRef.current = m;
    m.start();
    return m;
  }, []);

  useEffect(() => {
    function onWindowMessage(event: MessageEvent): void {
      manager.handleWindowMessage(event);
    }
    window.addEventListener("message", onWindowMessage);
    return () => {
      window.removeEventListener("message", onWindowMessage);
      manager.stop();
    };
  }, [manager]);

  const containerStyle: CSSProperties = {
    position: "relative",
    width: scene.layout?.width ? `${scene.layout.width}px` : "100vw",
    height: scene.layout?.height ? `${scene.layout.height}px` : "100vh",
    overflow: "hidden",
  };

  return (
    <div data-overlay="scene" style={containerStyle}>
      {scene.widgets.map((instance) => (
        <WidgetFrame key={instance.id} instance={instance} manager={manager} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root SceneOverlay — resolution order (design §5.2.1)
// ---------------------------------------------------------------------------

interface SceneOverlayProps {
  /** Explicit scene prop kept for compatibility with programmatic
   *  mounts (e.g. Storybook / test harnesses). When provided it
   *  bypasses all URL-based resolution. */
  scene?: SceneConfig;
}

export default function SceneOverlay({ scene }: SceneOverlayProps) {
  const pathname = location.pathname;
  const search = location.search;
  const params = new URLSearchParams(search);

  // 1. Token mode.
  const token = extractToken(pathname);
  if (token) {
    const useParentFrame = params.get("eventSource") === "parent";
    // Use first 8 chars of token for logging — never log the full token.
    console.log("[scene:overlay] token mode", { tokenPrefix: `${token.slice(0, 8)}…` });
    return <TokenModeOverlay token={token} useParentFrame={useParentFrame} />;
  }

  // 2. Legacy scene-id path.
  const sceneId = extractSceneId(pathname);
  if (sceneId) {
    console.log("[scene:overlay] legacy mode", { sceneId });
    return <LegacyModeOverlay sceneId={sceneId} />;
  }

  // 3. Explicit scene prop (programmatic mount).
  if (scene) {
    const noopSource = { start() {}, stop() {}, send() {} };
    const manager = new SceneManager({ eventSource: noopSource });
    manager.start();
    const containerStyle: CSSProperties = {
      position: "relative",
      width: scene.layout?.width ? `${scene.layout.width}px` : "100vw",
      height: scene.layout?.height ? `${scene.layout.height}px` : "100vh",
      overflow: "hidden",
    };
    return (
      <div data-overlay="scene" style={containerStyle}>
        {scene.widgets.map((instance) => (
          <WidgetFrame key={instance.id} instance={instance} manager={manager} />
        ))}
      </div>
    );
  }

  // 4. Dev/test inline mode — ?config= param.
  console.log("[scene:overlay] dev/test inline mode");
  return <DevModeOverlay search={search} />;
}
