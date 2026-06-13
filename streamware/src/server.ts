import { existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { createServiceLogger } from "@woofx3/common/logging";
import { createMessageBus } from "@woofx3/nats";
import { AlertBroadcaster } from "./alert-broadcaster";
import { AlertQueueManager } from "./alert-queue-manager";
import { buildBuiltinWidgetDefinitions, getBuiltinWidgetSpecs, initBuiltinWidgets } from "./builtin-widgets";
import { loadConfig, validateOverlayConfig, type StreamwareRuntimeConfig } from "./config";
import { DbClient } from "./db";
import { FrameAssembler } from "./frame-assembler";
import { initSubscriptions } from "./nats-subscriptions";
import { connectObs } from "./obs/manager";
import { OverlayHost } from "./overlay-host";
import { maskToken, OverlayTokenResolver } from "./overlay-token";
import {
  StorageBroadcaster,
  type OverlayConnectionMeta,
  type OverlayConnectionStore,
} from "./storage-broadcaster";
import { initWidgetEventHandlers } from "./widget-event-handlers";
import { WidgetAssetProxy, sanitizeAssetPath } from "./widget-asset-proxy";

async function main() {
  const config = loadConfig();
  validateOverlayConfig(config);

  const logger = createServiceLogger({
    serviceName: "streamware",
    logDir: `${config.rootDir}/logs`,
  });

  logger.info("Starting streamware", { port: config.port });

  let nats: Awaited<ReturnType<typeof createMessageBus>> | null = null;
  try {
    logger.info("Connecting to NATS", { url: config.nats.url, name: config.nats.name });
    nats = await createMessageBus(config.nats, logger);
    await nats.connect();
  } catch (err) {
    logger.warn("NATS connection failed; alert subscription disabled", {
      url: config.nats.url,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const obs = await connectObs(config.obs, logger);

  const broadcaster = new AlertBroadcaster(logger, nats);
  const storageBroadcaster = new StorageBroadcaster(logger, nats);

  const db = config.databaseProxyUrl ? new DbClient(config.databaseProxyUrl) : null;

  // Overlay connection store: keyed by applicationId.
  const overlayConnections: OverlayConnectionStore = new Map();

  const resolver = new OverlayTokenResolver(db, logger);
  const overlayHost = new OverlayHost(resolver, db, logger);
  const frameAssembler = new FrameAssembler(overlayHost, logger, {
    barkloaderUrl: config.barkloaderUrl,
    publicDir: config.publicDir,
    widgetAssetBaseUrl: config.widgetAssetBaseUrl,
  });
  const widgetAssetProxy = new WidgetAssetProxy(config.barkloaderUrl, logger);

  await initSubscriptions({
    nats,
    obs,
    broadcaster,
    storageBroadcaster,
    logger,
    resolver,
    overlayConnections,
  });

  let alertQueue: AlertQueueManager | null = null;
  if (nats && db) {
    alertQueue = new AlertQueueManager(db, nats, logger);
    await initWidgetEventHandlers({
      nats,
      db,
      queue: alertQueue,
      storageBroadcaster,
      logger,
    });
    logger.info("Alert orchestration initialised", { databaseProxyUrl: config.databaseProxyUrl });
  } else {
    logger.warn("Alert orchestration disabled — set WOOFX3_DATABASE_PROXY_URL to enable", {
      hasNats: !!nats,
      hasDbUrl: !!config.databaseProxyUrl,
    });
  }

  await initBuiltinWidgets(logger, db, nats);

  startHttpServer(
    config,
    broadcaster,
    storageBroadcaster,
    db,
    overlayHost,
    frameAssembler,
    widgetAssetProxy,
    resolver,
    overlayConnections,
    logger
  );
}

main().catch((err) => {
  console.error("Failed to start streamware:", err);
  process.exit(1);
});

type ConnectionTag =
  | { kind: "alerts"; id: string }
  | { kind: "module-state"; id: string }
  | OverlayConnectionMeta & { kind: "overlay" };

function startHttpServer(
  config: StreamwareRuntimeConfig,
  broadcaster: AlertBroadcaster,
  storageBroadcaster: StorageBroadcaster,
  db: DbClient | null,
  overlayHost: OverlayHost,
  frameAssembler: FrameAssembler,
  widgetAssetProxy: WidgetAssetProxy,
  resolver: OverlayTokenResolver,
  overlayConnections: OverlayConnectionStore,
  logger: ReturnType<typeof createServiceLogger>
): void {
  const alertHandlers = broadcaster.handlers();
  const stateHandlers = storageBroadcaster.handlers();

  const websocket: WebSocketHandler<ConnectionTag> = {
    open: (ws) => {
      const tag = ws.data as ConnectionTag;
      if (tag.kind === "module-state") {
        stateHandlers.open?.(ws as ServerWebSocket<{ kind: "module-state"; id: string }>);
      } else if (tag.kind === "overlay") {
        const meta = tag as OverlayConnectionMeta & { kind: "overlay" };
        let sockets = overlayConnections.get(meta.applicationId);
        if (!sockets) {
          sockets = new Set();
          overlayConnections.set(meta.applicationId, sockets);
        }
        sockets.add(ws as ServerWebSocket<OverlayConnectionMeta>);
        logger.info("overlay WS connected", {
          token: maskToken(meta.token),
          applicationId: meta.applicationId,
          sceneId: meta.sceneId,
        });
      } else {
        alertHandlers.open?.(ws as ServerWebSocket<{ kind: "alerts"; id: string }>);
      }
    },
    close: (ws, code, reason) => {
      const tag = ws.data as ConnectionTag;
      if (tag.kind === "module-state") {
        stateHandlers.close?.(
          ws as ServerWebSocket<{ kind: "module-state"; id: string }>,
          code,
          reason
        );
      } else if (tag.kind === "overlay") {
        const meta = tag as OverlayConnectionMeta & { kind: "overlay" };
        const sockets = overlayConnections.get(meta.applicationId);
        if (sockets) {
          sockets.delete(ws as ServerWebSocket<OverlayConnectionMeta>);
          if (sockets.size === 0) {
            overlayConnections.delete(meta.applicationId);
          }
        }
        logger.info("overlay WS disconnected", {
          token: maskToken(meta.token),
          applicationId: meta.applicationId,
          code,
        });
      } else {
        alertHandlers.close?.(
          ws as ServerWebSocket<{ kind: "alerts"; id: string }>,
          code,
          reason
        );
      }
    },
    message: (ws, message) => {
      const tag = ws.data as ConnectionTag;
      if (tag.kind === "module-state") {
        stateHandlers.message?.(
          ws as ServerWebSocket<{ kind: "module-state"; id: string }>,
          message
        );
      } else if (tag.kind === "overlay") {
        // Upstream OverlayWidgetEvent from the overlay client -> publish to NATS widget.event.
        // Reuse the same wire format and publish path as the legacy module-state channel.
        stateHandlers.message?.(
          ws as unknown as ServerWebSocket<{ kind: "module-state"; id: string }>,
          message
        );
      } else {
        alertHandlers.message?.(
          ws as ServerWebSocket<{ kind: "alerts"; id: string }>,
          message
        );
      }
    },
  };

  const uiDist = resolve(config.uiDistDir);
  const publicDir = resolve(config.publicDir);
  const indexHtml = join(uiDist, "index.html");
  const hasUiBuild = existsSync(indexHtml);
  if (!hasUiBuild) {
    logger.warn("UI build not found; overlay HTML will 404 until you run `bun run build:ui`", {
      expected: indexHtml,
    });
  }

  Bun.serve({
    port: config.port,
    hostname: config.bindHost,
    fetch: async (req, server) => {
      const url = new URL(req.url);

      // CORS preflight — short-circuit before any route logic.
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // WebSocket upgrades complete with `undefined` and bypass CORS wrapping.
      if (url.pathname === "/ws/alerts") {
        const upgraded = server.upgrade(req, { data: broadcaster.nextConnectionData() });
        if (upgraded) {
          return undefined;
        }
        return withCors(new Response("upgrade failed", { status: 400 }));
      }

      if (url.pathname === "/ws/module-state") {
        const upgraded = server.upgrade(req, {
          data: storageBroadcaster.nextConnectionData(),
        });
        if (upgraded) {
          return undefined;
        }
        return withCors(new Response("upgrade failed", { status: 400 }));
      }

      const response: Response = await (async (): Promise<Response> => {
        // Token-scoped overlay routes (design §5.2).
        if (url.pathname.startsWith("/o/")) {
          return handleOverlayRoutes(
            req,
            url,
            server,
            uiDist,
            overlayHost,
            frameAssembler,
            widgetAssetProxy,
            resolver,
            overlayConnections,
            logger
          );
        }

        if (url.pathname === "/health") {
          return Response.json({ status: "ok", overlayClients: broadcaster.clientCount() });
        }

        if (url.pathname === "/api/builtin-widgets") {
          return Response.json(buildBuiltinWidgetDefinitions(), {
            headers: SCENE_CORS_HEADERS,
          });
        }

        if (url.pathname === "/api/widgets") {
          if (!db) {
            return Response.json({ status: "error", message: "db not available" }, { status: 503 });
          }
          try {
            const result = await db.listWidgets({ createdByType: "", createdByRef: "" });
            return Response.json({ widgets: result.widgets }, { headers: SCENE_CORS_HEADERS });
          } catch (err) {
            logger.warn("listWidgets failed", { err });
            return Response.json({ status: "error", message: String(err) }, { status: 500 });
          }
        }

        if (url.pathname.startsWith("/api/scene/")) {
          return handleSceneFetch(url.pathname, db, logger);
        }

        if (
          url.pathname === "/" ||
          url.pathname === "/overlay/alerts" ||
          url.pathname === "/overlay/scene" ||
          url.pathname.startsWith("/overlay/scene/")
        ) {
          return serveFile(indexHtml);
        }

        // Legacy /assets/ handler (design §5.1): when legacyRoutes is enabled,
        // match any pathname containing /assets/ that didn't go through /o/.
        if (config.legacyRoutes && url.pathname.includes("/assets/")) {
          const assetsIdx = url.pathname.lastIndexOf("/assets/");
          const rawTail = url.pathname.slice(assetsIdx + "/assets/".length);
          const tail = sanitizeAssetPath(rawTail);
          if (tail !== null) {
            const assetsRoot = normalize(join(uiDist, "assets"));
            const candidate = normalize(join(assetsRoot, tail));
            // Invariant: resolved path must stay within the assets directory.
            if (candidate === assetsRoot || candidate.startsWith(assetsRoot + "/")) {
              const file = Bun.file(candidate);
              if (await file.exists()) {
                return new Response(file);
              }
              // Fall through to other handlers.
            }
          }
        }

        const fromUi = await tryServeUnder(uiDist, url.pathname);
        if (fromUi) {
          return fromUi;
        }
        const fromPublic = await tryServeUnder(publicDir, url.pathname);
        if (fromPublic) {
          return fromPublic;
        }

        return new Response("Not Found", { status: 404 });
      })();

      return withCors(response);
    },
    websocket: websocket as WebSocketHandler<unknown>,
  });

  logger.info("streamware listening", {
    port: config.port,
    bindHost: config.bindHost,
    overlayUrl: `http://localhost:${config.port}/overlay/alerts`,
    sceneOverlayUrl: `http://localhost:${config.port}/overlay/scene`,
    wsUrl: `ws://localhost:${config.port}/ws/alerts`,
    moduleStateWsUrl: `ws://localhost:${config.port}/ws/module-state`,
  });
}

/**
 * Handle all routes under `/o/{token}/`. The token is extracted from
 * the second path segment; the remaining path is dispatched to the
 * appropriate sub-handler.
 */
async function handleOverlayRoutes(
  req: Request,
  url: URL,
  server: { upgrade(req: Request, opts: { data: unknown }): boolean },
  uiDist: string,
  overlayHost: OverlayHost,
  frameAssembler: FrameAssembler,
  widgetAssetProxy: WidgetAssetProxy,
  resolver: OverlayTokenResolver,
  overlayConnections: OverlayConnectionStore,
  logger: ReturnType<typeof createServiceLogger>
): Promise<Response> {
  // Extract token from /o/{token}/...
  const afterO = url.pathname.slice("/o/".length);
  const slashIdx = afterO.indexOf("/");
  const token = slashIdx === -1 ? afterO : afterO.slice(0, slashIdx);
  const remaining = slashIdx === -1 ? "" : afterO.slice(slashIdx + 1);

  // 1. GET /o/{token}/config
  if (remaining === "config" && req.method === "GET") {
    const config = await overlayHost.buildConfig(token);
    return new Response(JSON.stringify(config), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...CORS_HEADERS,
      },
    });
  }

  // 2. GET /o/{token}/frame/{instanceId}
  if (remaining.startsWith("frame/") && req.method === "GET") {
    const instanceId = decodeURIComponent(remaining.slice("frame/".length));
    return frameAssembler.assemble(token, instanceId, url.searchParams.get("nonce"));
  }

  // 3. GET /o/{token}/widget-assets/{moduleKey}/{manifestId}/{tail...}
  if (remaining.startsWith("widget-assets/") && req.method === "GET") {
    const rest = remaining.slice("widget-assets/".length);
    const parts = rest.split("/");
    if (parts.length < 2) {
      return new Response(null, { status: 404 });
    }
    const moduleKey = parts[0]!;
    const manifestId = parts[1]!;
    const tail = parts.slice(2).join("/");
    return widgetAssetProxy.proxy(moduleKey, manifestId, tail);
  }

  // 4. GET /o/{token}/assets/{tail...}
  if (remaining.startsWith("assets/") && req.method === "GET") {
    const rawTail = remaining.slice("assets/".length);
    const tail = sanitizeAssetPath(rawTail);
    if (tail !== null) {
      const assetsRoot = normalize(join(uiDist, "assets"));
      const candidate = normalize(join(assetsRoot, tail));
      // Invariant: resolved path must stay within the assets directory.
      if (candidate === assetsRoot || candidate.startsWith(assetsRoot + "/")) {
        const file = Bun.file(candidate);
        if (await file.exists()) {
          return new Response(file);
        }
      }
    }
    // Fall through if not found.
  }

  // 5. GET /o/{token}/events — WebSocket upgrade for P2 overlay events.
  if (remaining === "events" && req.method === "GET") {
    const resolved = await resolver.resolve(token);
    const connectionData: OverlayConnectionMeta & { kind: "overlay" } = {
      kind: "overlay",
      token,
      applicationId: resolved?.applicationId ?? "",
      sceneId: resolved?.sceneId ?? "",
    };
    // Accept the upgrade regardless of resolution (design: accept but
    // don't attach for invalid tokens — the client can't distinguish
    // invalid from valid before the first push frame).
    const upgraded = server.upgrade(req, { data: connectionData });
    if (upgraded) {
      return undefined as unknown as Response;
    }
    return new Response("upgrade failed", { status: 400 });
  }

  // 6. GET /o/{token}/ — SPA shell. Redirect /o/{token} (no slash) to /o/{token}/.
  if (remaining === "" || remaining === "/") {
    if (!url.pathname.endsWith("/")) {
      return new Response(null, {
        status: 302,
        headers: { Location: url.pathname + "/" },
      });
    }
    const indexHtml = join(uiDist, "index.html");
    const file = Bun.file(indexHtml);
    if (!(await file.exists())) {
      return new Response("Not Found", { status: 404 });
    }
    const html = await file.text();
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  logger.warn("overlay route not matched", {
    token: maskToken(token),
    remaining,
  });
  return new Response("Not Found", { status: 404 });
}

async function serveFile(absPath: string): Promise<Response> {
  const file = Bun.file(absPath);
  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }
  return new Response(file);
}

// CORS for any-origin embedding. Streamware overlays are loaded inside
// sandboxed iframes (no `allow-same-origin`), which makes asset and fetch
// requests CORS-checked even when targeting the same hostname; the public
// proxy (cloudflared) also rewrites the origin. Both reasons require these
// headers on every HTTP response. Applied centrally in the fetch handler.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

// Retained name for the JSON API call sites that pass headers explicitly.
const SCENE_CORS_HEADERS = CORS_HEADERS;

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function handleSceneFetch(
  pathname: string,
  db: DbClient | null,
  logger: ReturnType<typeof createServiceLogger>
): Promise<Response> {
  const sceneId = decodeURIComponent(pathname.slice("/api/scene/".length));
  if (!sceneId) {
    return new Response("Missing scene id", { status: 400, headers: SCENE_CORS_HEADERS });
  }
  if (!db) {
    return new Response("db proxy unavailable", {
      status: 503,
      headers: SCENE_CORS_HEADERS,
    });
  }
  try {
    const response = await db.getScene({ id: sceneId });
    if (response.status?.code !== "OK" || !response.scene) {
      return new Response("Scene not found", { status: 404, headers: SCENE_CORS_HEADERS });
    }
    const s = response.scene;
    const rawWidgets = (() => {
      try {
        const parsed = JSON.parse(s.widgetsJson || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })();
    const widgets = rawWidgets.map((w) => normalizeWidgetInstance(w, logger)).filter((w): w is Record<string, unknown> => w !== null);
    const layout = (() => {
      try {
        const parsed = JSON.parse(s.layoutJson || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    })();
    return Response.json(
      { id: s.id, applicationId: s.applicationId, name: s.name, widgets, layout },
      { headers: SCENE_CORS_HEADERS }
    );
  } catch (err) {
    logger.warn("scene fetch failed", { sceneId, err });
    return new Response("Internal error", { status: 500, headers: SCENE_CORS_HEADERS });
  }
}

/**
 * Bridge raw widget instance JSON (Convex shape) into the canonical
 * SceneOverlay shape:
 *  - Derive `moduleId` from `widgetCanonicalId` (`{moduleId}:widget:...`).
 *  - For built-in widgets, populate `bundleUrl`, `acceptedEvents` from
 *    the in-repo spec.
 *  - Collapse a sibling `size.{width,height}` into `position.{width,height}`
 *    when the saved shape stores them separately.
 *
 * Returns `null` for entries we can't even identify (no canonical id).
 * The SceneOverlay's own validator will drop anything still incomplete.
 */
function normalizeWidgetInstance(
  raw: unknown,
  logger: ReturnType<typeof createServiceLogger>
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const w = { ...(raw as Record<string, unknown>) };

  const canonicalId = typeof w.widgetCanonicalId === "string" ? w.widgetCanonicalId : "";
  if (!canonicalId) {
    logger.warn("scene widget missing widgetCanonicalId; dropping", { widget: w });
    return null;
  }

  // moduleId is the first segment of the canonical id.
  if (typeof w.moduleId !== "string" || !w.moduleId) {
    const colon = canonicalId.indexOf(":");
    if (colon > 0) {
      w.moduleId = canonicalId.slice(0, colon);
    }
  }

  // Built-in lookup fills bundleUrl + acceptedEvents.
  const builtinPrefix = "builtin:widget:";
  if (canonicalId.startsWith(builtinPrefix)) {
    const manifestId = canonicalId.slice(builtinPrefix.length);
    const spec = getBuiltinWidgetSpecs().find((s) => s.manifestId === manifestId);
    if (!spec) {
      logger.warn("built-in widget canonicalId has no matching spec; dropping", {
        widgetCanonicalId: canonicalId,
      });
      return null;
    }
    if (typeof w.bundleUrl !== "string" || !w.bundleUrl) {
      w.bundleUrl = `/widgets/builtin/${spec.manifestId}/index.html`;
    }
    if (!Array.isArray(w.acceptedEvents) || w.acceptedEvents.length === 0) {
      w.acceptedEvents = spec.acceptedEvents;
    }
  }

  // Collapse `size` into `position` if the saved shape kept them separate.
  const position = (w.position ?? {}) as Record<string, unknown>;
  const size = (w.size ?? {}) as Record<string, unknown>;
  const px = typeof position.x === "number" ? position.x : 0;
  const py = typeof position.y === "number" ? position.y : 0;
  const pw =
    typeof position.width === "number"
      ? position.width
      : typeof size.width === "number"
      ? size.width
      : 0;
  const ph =
    typeof position.height === "number"
      ? position.height
      : typeof size.height === "number"
      ? size.height
      : 0;
  w.position = { x: px, y: py, width: pw, height: ph };

  return w;
}

async function tryServeUnder(rootDir: string, pathname: string): Promise<Response | null> {
  const root = normalize(rootDir);
  const safe = normalize(join(root, pathname));
  if (safe !== root && !safe.startsWith(root + "/")) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(safe);
  if (!(await file.exists())) {
    return null;
  }
  return new Response(file);
}

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down...");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down...");
  process.exit(0);
});
