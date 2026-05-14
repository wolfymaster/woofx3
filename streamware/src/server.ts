import { existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import type { WebSocketHandler } from "bun";
import { createServiceLogger } from "@woofx3/common/logging";
import { createMessageBus } from "@woofx3/nats";
import { AlertBroadcaster } from "./alert-broadcaster";
import { AlertQueueManager } from "./alert-queue-manager";
import { loadConfig } from "./config";
import { DbClient } from "./db";
import { initSubscriptions } from "./nats-subscriptions";
import { connectObs } from "./obs/manager";
import { StorageBroadcaster } from "./storage-broadcaster";
import { initWidgetEventHandlers } from "./widget-event-handlers";

async function main() {
  const config = loadConfig();
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

  // db-proxy client — used by the alert orchestration block below
  // AND by the scene-fetch HTTP route (which serves the overlay
  // config for `/overlay/scene/{id}`). Outlives the NATS branch so
  // the route works even when the message bus is unavailable.
  const db = config.databaseProxyUrl ? new DbClient(config.databaseProxyUrl) : null;

  // Phase R1: streamware now owns alert orchestration. The api keeps
  // db-outbox → webhook projection (its actual boundary work);
  // streamware pulls intents off NATS, runs the queue, and writes to
  // the db proxy directly.
  if (nats && db) {
    const alertQueue = new AlertQueueManager(db, nats, logger);
    await initWidgetEventHandlers({
      nats,
      db,
      queue: alertQueue,
      storageBroadcaster,
      logger,
      // Streamware doesn't carry an authenticated session today, so
      // it has no authoritative applicationId. Envelopes must
      // either supply one (workflow does, see workflow/actions.go)
      // or the api warmup must publish a "welcome" with the default.
      // For now, fall back to null and let the resolveApplicationId
      // hook do JIT lookups.
      applicationId: null,
      resolveApplicationId: async () => {
        // Light JIT: ask the db proxy for the default application.
        // Tolerated: this is the same fallback the api previously
        // performed against a fresh boot before onboarding ran.
        try {
          // ApplicationService isn't exposed on streamware's slim
          // DbClient (only alert + widget_status), so JIT requires
          // the api to seed the default — which it does today via
          // the warmup at api/src/server.ts. Until we re-evaluate
          // whether streamware should also resolve applicationId
          // independently, return null and let envelopes carry it.
          return null;
        } catch {
          return null;
        }
      },
    });
    logger.info("Alert orchestration initialised", { databaseProxyUrl: config.databaseProxyUrl });
  } else {
    logger.warn(
      "Alert orchestration disabled — set WOOFX3_DATABASE_PROXY_URL to enable",
      { hasNats: !!nats, hasDbUrl: !!config.databaseProxyUrl }
    );
  }

  // Bun.serve takes a single `websocket` handler, so we dispatch
  // open / close / message events to the right broadcaster based
  // on the `kind` discriminator each one stamps onto its connection
  // data at upgrade time. Default branch is `alerts` so the existing
  // overlay path keeps working even if a future client doesn't
  // populate `data.kind` on the upgrade.
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

      // Scene fetch — the SceneOverlay SPA calls this on load to
      // resolve a path-style `/overlay/scene/{id}` URL into the
      // SceneConfig JSON it needs to render. Returns the same shape
      // the `?config=<urlencoded>` dev path uses so the client just
      // hands it to `<SceneOverlay scene={...} />`.
      //
      // Permissive CORS: the editor preview iframe (woofx3-ui scene
      // editor) lives on a different origin and fetches this through
      // the iframe wrapper. The browser-source endpoint stays
      // unauthenticated by design — sourceKey is what scopes access,
      // not this read.
      if (url.pathname.startsWith("/api/scene/")) {
        return handleSceneFetch(url.pathname, db, logger);
      }

      // Friendly browser-source URL → SPA shell. Both the alert
      // overlay and the scene-composing overlay are served from the
      // same SPA bundle; main.tsx picks the right component based
      // on `location.pathname`.
      if (
        url.pathname === "/" ||
        url.pathname === "/overlay/alerts" ||
        url.pathname === "/overlay/scene" ||
        url.pathname.startsWith("/overlay/scene/")
      ) {
        return serveFile(indexHtml);
      }

      // Try the built SPA first (vite copies publicDir contents into
      // dist/ during build, so production assets like /woof1.mp3 land
      // here). For dev/no-build runs, fall back to publicDir directly.
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

/**
 * Resolve `/api/scene/{id}` to the SceneConfig JSON the SPA renders.
 * Reads through the db-proxy. The wire shape matches
 * `streamware/ui/src/lib/sceneConfig.ts` — widget instances parsed
 * from `widgets_json`, layout parsed from `layout_json`. The engine
 * never inspects these fields so the UI's writes round-trip
 * unchanged.
 *
 * Returns 404 when the scene doesn't exist or the db-proxy is
 * unconfigured (the same error class — neither case is recoverable
 * client-side).
 */
async function handleSceneFetch(
  pathname: string,
  db: DbClient | null,
  logger: ReturnType<typeof createServiceLogger>,
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
      { headers: SCENE_CORS_HEADERS },
    );
  } catch (err) {
    logger.warn("scene fetch failed", { sceneId, err });
    return new Response("Internal error", { status: 500, headers: SCENE_CORS_HEADERS });
  }
}

async function tryServeUnder(rootDir: string, pathname: string): Promise<Response | null> {
  // Resolve against root and refuse anything that escapes via `..`.
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

main().catch((err) => {
  console.error("Failed to start streamware:", err);
  process.exit(1);
});
