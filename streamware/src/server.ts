import { existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import type { WebSocketHandler } from "bun";
import { createServiceLogger } from "@woofx3/common/logging";
import { createMessageBus } from "@woofx3/nats";
import { loadRuntimeEnv } from "@woofx3/common/runtime";
import { AlertBroadcaster } from "./alert-broadcaster";
import { AlertQueueManager } from "./alert-queue-manager";
import { buildBuiltinWidgetDefinitions, initBuiltinWidgets } from "./builtin-widgets";
import { StreamwareEnvSchema, type StreamwareRuntimeConfig } from "./config";
import { DbClient } from "./db";
import { initSubscriptions } from "./nats-subscriptions";
import { connectObs } from "./obs/manager";
import { StorageBroadcaster } from "./storage-broadcaster";
import { initWidgetEventHandlers } from "./widget-event-handlers";

const loadedConfig = loadRuntimeEnv({
  schema: StreamwareEnvSchema,
  injectIntoProcess: true,
});

function getConfig(): StreamwareRuntimeConfig {
  const c = loadedConfig.config as Record<string, unknown>;

  const port = Number(c.woofx3StreamwarePort ?? c.streamwarePort ?? 9101);
  const rootDir = String((c.woofx3RootPath ?? c.rootPath ?? process.cwd()) as string);

  const messagebusUrl = String(c.woofx3MessagebusUrl ?? c.messagebusUrl ?? "ws://localhost:4225");
  const jwt = c.woofx3MessagebusJwt ? String(c.woofx3MessagebusJwt) : c.messagebusJwt ? String(c.messagebusJwt) : undefined;
  const nkeySeed = c.woofx3MessagebusNkey ? String(c.woofx3MessagebusNkey) : c.messagebusNkey ? String(c.messagebusNkey) : undefined;

  const obsHost = String(c.woofx3ObsHost ?? c.obsHost ?? "127.0.0.1");
  const obsPort = String(c.woofx3ObsPort ?? c.obsPort ?? "4455");
  const obsToken = c.woofx3ObsRpcToken ? String(c.woofx3ObsRpcToken) : c.obsRpcToken ? String(c.obsRpcToken) : undefined;

  const databaseProxyUrl = String(c.woofx3DatabaseProxyUrl ?? c.databaseProxyUrl ?? "");

  return {
    port,
    rootDir,
    uiDistDir: `${import.meta.dir}/../ui/dist`,
    publicDir: `${import.meta.dir}/../public`,
    databaseProxyUrl,
    obs: {
      url: `ws://${obsHost}:${obsPort}`,
      token: obsToken,
    },
    nats: {
      url: messagebusUrl,
      name: "woofx3-streamware",
      jwt,
      nkeySeed,
    },
  };
}

async function main() {
  const config = getConfig();
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

  await initSubscriptions({ nats, obs, broadcaster, storageBroadcaster, logger });

  const db = config.databaseProxyUrl ? new DbClient(config.databaseProxyUrl) : null;

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

  startHttpServer(config, broadcaster, storageBroadcaster, db, logger);
}

main().catch((err) => {
  console.error("Failed to start streamware:", err);
  process.exit(1);
});

function startHttpServer(
  config: StreamwareRuntimeConfig,
  broadcaster: AlertBroadcaster,
  storageBroadcaster: StorageBroadcaster,
  db: DbClient | null,
  logger: ReturnType<typeof createServiceLogger>
): void {
  const alertHandlers = broadcaster.handlers();
  const stateHandlers = storageBroadcaster.handlers();
  const websocket: WebSocketHandler<{ kind: string; id: string }> = {
    open: (ws) => {
      if (ws.data?.kind === "module-state") {
        stateHandlers.open?.(ws as any);
      } else {
        alertHandlers.open?.(ws as any);
      }
    },
    close: (ws, code, reason) => {
      if (ws.data?.kind === "module-state") {
        stateHandlers.close?.(ws as any, code, reason);
      } else {
        alertHandlers.close?.(ws as any, code, reason);
      }
    },
    message: (ws, message) => {
      if (ws.data?.kind === "module-state") {
        stateHandlers.message?.(ws as any, message);
      } else {
        alertHandlers.message?.(ws as any, message);
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
    fetch: async (req, server) => {
      const url = new URL(req.url);

      if (url.pathname === "/health") {
        return Response.json({ status: "ok", overlayClients: broadcaster.clientCount() });
      }

      if (url.pathname === "/ws/alerts") {
        const upgraded = server.upgrade(req, { data: broadcaster.nextConnectionData() });
        if (upgraded) {
          return undefined;
        }
        return new Response("upgrade failed", { status: 400 });
      }

      if (url.pathname === "/ws/module-state") {
        const upgraded = server.upgrade(req, {
          data: storageBroadcaster.nextConnectionData(),
        });
        if (upgraded) {
          return undefined;
        }
        return new Response("upgrade failed", { status: 400 });
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
          const response = await db.listWidgets({ createdByType: "", createdByRef: "" });
          return Response.json(
            { widgets: response.widgets },
            { headers: SCENE_CORS_HEADERS }
          );
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

      const fromUi = await tryServeUnder(uiDist, url.pathname);
      if (fromUi) {
        return fromUi;
      }
      const fromPublic = await tryServeUnder(publicDir, url.pathname);
      if (fromPublic) {
        return fromPublic;
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: websocket as WebSocketHandler<unknown>,
  });

  logger.info("streamware listening", {
    port: config.port,
    overlayUrl: `http://localhost:${config.port}/overlay/alerts`,
    sceneOverlayUrl: `http://localhost:${config.port}/overlay/scene`,
    wsUrl: `ws://localhost:${config.port}/ws/alerts`,
    moduleStateWsUrl: `ws://localhost:${config.port}/ws/module-state`,
  });
}

async function serveFile(absPath: string): Promise<Response> {
  const file = Bun.file(absPath);
  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }
  return new Response(file);
}

const SCENE_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
    const widgets = (() => {
      try {
        const parsed = JSON.parse(s.widgetsJson || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })();
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