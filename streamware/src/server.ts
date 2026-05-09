import { existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import type { WebSocketHandler } from "bun";
import { createServiceLogger } from "@woofx3/common/logging";
import { createMessageBus } from "@woofx3/nats";
import { AlertBroadcaster } from "./alert-broadcaster";
import { loadConfig } from "./config";
import { initSubscriptions } from "./nats-subscriptions";
import { connectObs } from "./obs/manager";
import { StorageBroadcaster } from "./storage-broadcaster";

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

  const broadcaster = new AlertBroadcaster(logger);
  const storageBroadcaster = new StorageBroadcaster(logger);

  await initSubscriptions({ nats, obs, broadcaster, storageBroadcaster, logger });

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
