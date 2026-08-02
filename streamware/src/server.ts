import { existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { createServiceLogger } from "@woofx3/common/logging";
import { createMessageBus } from "@woofx3/nats";
import { EventQueueManager } from "./events/queue-manager";
import { initWidgetEventHandlers } from "./events/handlers";
import { publishWidgetEvent } from "./events/wire";
import { buildBuiltinWidgetDefinitions, getBuiltinWidgetSpecs, initBuiltinWidgets } from "./widgets/builtin";
import { loadConfig, validateOverlayConfig, type StreamwareRuntimeConfig } from "./config";
import { DbClient } from "./db";
import { FrameAssembler } from "./overlay/frame-assembler";
import { initSubscriptions } from "./nats-subscriptions";
import { connectObs } from "./obs/manager";
import { OverlayHost } from "./overlay/scene-host";
import { maskToken, OverlayTokenResolver } from "./overlay/token-resolver";
import type { OverlayConnectionMeta, OverlayConnectionStore } from "./overlay/connections";
import { StorageBroadcaster } from "./storage/broadcaster";
import { WidgetAssetProxy, sanitizeAssetPath } from "./overlay/asset-proxy";
import { ModuleVersionResolver } from "./overlay/module-version-resolver";
import { OverlayPublicUrlResolver } from "./overlay/overlay-public-url-resolver";

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
    nats = null;
  }

  const obs = await connectObs(config.obs, logger);

  const db = config.databaseProxyUrl ? new DbClient(config.databaseProxyUrl) : null;

  // Overlay connection store: keyed by applicationId. Owned by StorageBroadcaster
  // so every broadcast call reaches all connected overlays without passing the
  // store at every call site.
  const overlayConnections: OverlayConnectionStore = new Map();
  const storageBroadcaster = new StorageBroadcaster(logger, nats, overlayConnections);

  const resolver = new OverlayTokenResolver(db, logger);
  const overlayHost = new OverlayHost(resolver, db, logger);
  const overlayPublicUrlResolver = new OverlayPublicUrlResolver(db, config.overlayPublicUrl, logger);
  // Shared between FrameAssembler (server-side entry-HTML fetch) and
  // WidgetAssetProxy (browser asset requests) so both resolve a
  // module's current version-scoped storage directory through one
  // cache, invalidated together on `db.module.installed.*`.
  const moduleVersions = new ModuleVersionResolver(db, logger);
  const frameAssembler = new FrameAssembler(overlayHost, logger, {
    barkloaderUrl: config.barkloaderUrl,
    publicDir: config.publicDir,
    overlayPublicUrlResolver,
    moduleVersions,
  });
  const widgetAssetProxy = new WidgetAssetProxy(config.barkloaderUrl, logger, moduleVersions);

  await initSubscriptions({
    nats,
    obs,
    storageBroadcaster,
    logger,
    resolver,
    moduleVersions,
  });

  let alertQueue: EventQueueManager | null = null;
  if (nats && db) {
    alertQueue = new EventQueueManager(db, nats, logger);
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

// Guarded so importing this module (e.g. from tests exercising
// handleOverlayRoutes directly) never triggers a real NATS/OBS/db-proxy
// connection attempt — only running it as the entrypoint does.
if (import.meta.main) {
  main().catch((err) => {
    console.error("Failed to start streamware:", err);
    process.exit(1);
  });
}

type OverlayConnectionTag = OverlayConnectionMeta & { kind: "overlay" };

function startHttpServer(
  config: StreamwareRuntimeConfig,
  storageBroadcaster: StorageBroadcaster,
  db: DbClient | null,
  overlayHost: OverlayHost,
  frameAssembler: FrameAssembler,
  widgetAssetProxy: WidgetAssetProxy,
  resolver: OverlayTokenResolver,
  overlayConnections: OverlayConnectionStore,
  logger: ReturnType<typeof createServiceLogger>
): void {
  const websocket: WebSocketHandler<OverlayConnectionTag> = {
    open: (ws) => {
      let sockets = overlayConnections.get(ws.data.applicationId);
      if (!sockets) {
        sockets = new Set();
        overlayConnections.set(ws.data.applicationId, sockets);
      }
      sockets.add(ws as ServerWebSocket<OverlayConnectionMeta>);
      logger.info("overlay WS connected", {
        token: maskToken(ws.data.token),
        applicationId: ws.data.applicationId,
        sceneId: ws.data.sceneId,
      });
    },
    close: (ws, code) => {
      const sockets = overlayConnections.get(ws.data.applicationId);
      if (sockets) {
        sockets.delete(ws as ServerWebSocket<OverlayConnectionMeta>);
        if (sockets.size === 0) {
          overlayConnections.delete(ws.data.applicationId);
        }
      }
      logger.info("overlay WS disconnected", {
        token: maskToken(ws.data.token),
        applicationId: ws.data.applicationId,
        code,
      });
    },
    message: (ws, message) => {
      publishWidgetEvent(ws, message, storageBroadcaster.natsClient, logger);
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

      // Accept the same /overlay/ prefix the api gateway's proxy rewrites
      // to /o/ — streamware is also reachable directly (e.g.
      // streamwareProxy's tunnel in process-compose.yml, bypassing api
      // entirely), and a client hitting streamware's own public address
      // has no way to know whether it's going through api's rewrite or
      // not. Normalizing here means every route below works identically
      // either way.
      url.pathname = normalizeOverlayPrefix(url.pathname);

      const response: Response = await (async (): Promise<Response> => {
        // Public, token-independent asset byte routes. Must be checked
        // BEFORE the generic /o/{token}/... dispatch below — otherwise
        // "assets" would be misread as a token. Asset bytes cannot be
        // token-scoped: URLs referencing them may be constructed by
        // workflow (server-side, before any overlay/token is known) or by
        // a future CDN override, neither of which has a per-viewer token
        // to embed (see docs/woofwoofwoof/streamware/asset-prefix.md).
        if (url.pathname.startsWith("/o/assets/")) {
          return handleAssetRoutes(req, url, widgetAssetProxy, logger);
        }

        // Token-scoped overlay routes (design §5.2).
        if (url.pathname.startsWith("/o/")) {
          logger.info("overlay route", { method: req.method, path: url.pathname });
          return handleOverlayRoutes(
            req,
            url,
            server,
            uiDist,
            overlayHost,
            frameAssembler,
            resolver,
            overlayConnections,
            logger
          );
        }

        if (url.pathname === "/health") {
          return Response.json({ status: "ok", overlayClients: storageBroadcaster.overlayClientCount() });
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

      if (url.pathname.startsWith("/o/")) {
        logger.info("overlay route response", { path: url.pathname, status: response.status });
      }
      return withCors(response);
    },
    websocket: websocket as WebSocketHandler<unknown>,
  });

  logger.info("streamware listening", {
    port: config.port,
    bindHost: config.bindHost,
    overlayBase: `http://localhost:${config.port}/o/`,
    eventsWs: `ws://localhost:${config.port}/o/{token}/events`,
  });
}

/**
 * Rewrite the api gateway's public `/overlay/` prefix to streamware's
 * internal `/o/` prefix, so a request reaching streamware directly (not
 * proxied through api) is handled identically to one that was. Idempotent
 * for paths that already use `/o/` — only `/overlay/`-prefixed paths are
 * touched.
 */
export function normalizeOverlayPrefix(pathname: string): string {
  if (pathname.startsWith("/overlay/")) {
    return "/o/" + pathname.slice("/overlay/".length);
  }
  return pathname;
}

/**
 * Handle all routes under `/o/assets/`: module widgets, module assets,
 * builtin widgets, and the reserved `/user` prefix. Deliberately public
 * and token-independent — see the comment at this route's dispatch site
 * in `startHttpServer`'s fetch handler for why. Reuses the same
 * `WidgetAssetProxy` sanitization/proxy pipeline the (removed) token-
 * scoped variant of this route used.
 */
export async function handleAssetRoutes(
  req: Request,
  url: URL,
  widgetAssetProxy: WidgetAssetProxy,
  logger: ReturnType<typeof createServiceLogger>
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(null, { status: 404 });
  }

  const rest = url.pathname.slice("/o/assets/".length);
  const parts = rest.split("/");

  if (parts[0] === "user") {
    // Reserved prefix — recognized by the parser, not yet implemented.
    return new Response(null, { status: 404 });
  }

  if (parts[0] === "builtin" && parts[1] === "widgets" && parts.length >= 3) {
    const manifestId = parts[2]!;
    const tail = parts.slice(3).join("/");
    return widgetAssetProxy.proxyBuiltinWidgetAsset(manifestId, tail);
  }

  if (parts[0] === "modules" && parts.length >= 3) {
    const moduleId = parts[1]!;
    if (parts[2] === "widgets" && parts.length >= 4) {
      const manifestId = parts[3]!;
      const tail = parts.slice(4).join("/");
      return widgetAssetProxy.proxyModuleWidgetAsset(moduleId, manifestId, tail);
    }
    if (parts[2] === "assets") {
      const tail = parts.slice(3).join("/");
      return widgetAssetProxy.proxyModuleAsset(moduleId, tail);
    }
  }

  logger.warn("asset route not matched", { path: url.pathname });
  return new Response(null, { status: 404 });
}

/**
 * Handle all routes under `/o/{token}/`. The token is extracted from
 * the second path segment; the remaining path is dispatched to the
 * appropriate sub-handler.
 */
export async function handleOverlayRoutes(
  req: Request,
  url: URL,
  server: { upgrade(req: Request, opts: { data: unknown }): boolean },
  uiDist: string,
  overlayHost: OverlayHost,
  frameAssembler: FrameAssembler,
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

  // 1a. GET /o/{token}/scene-debug — raw scene diagnostic (dev only).
  if (remaining === "scene-debug" && req.method === "GET") {
    const rawScene = await overlayHost.loadRawScene(token);
    if (!rawScene) {
      return Response.json({ error: "token did not resolve to a scene" }, { headers: CORS_HEADERS });
    }
    return Response.json(rawScene, { headers: CORS_HEADERS });
  }

  // 2. GET /o/{token}/frame/{instanceId}
  if (remaining.startsWith("frame/") && req.method === "GET") {
    const instanceId = decodeURIComponent(remaining.slice("frame/".length));
    return frameAssembler.assemble(token, instanceId, url.searchParams.get("nonce"));
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
