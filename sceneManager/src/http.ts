import type { ApplicationContext } from "@woofx3/common/runtime";
import type { SceneManagerContext, SceneManagerServices } from "./application";
import type { DeliveryStore } from "./events/delivery-store";
import type { FrameAssembler } from "./scene/frame-assembler";
import type { OverlayHost } from "./scene/scene-host";
import type { SessionTokenService } from "./scene/session-token";
import { handleSceneRoute } from "./routes/scene";
import { handleSessionRefreshRoute } from "./routes/session";
import { handleWidgetFrameRoute } from "./routes/widget";
import { handleStaticAssetRoute } from "./routes/assets";
import {
  handleEventCompletedRoute,
  handleEventDeliveredRoute,
  handleEventsStreamRoute,
  handleWidgetStatusRoute,
} from "./routes/events";

type Context = ApplicationContext<SceneManagerContext, SceneManagerServices>;

export interface HttpDeps {
  ctx: Context;
  host: OverlayHost;
  frameAssembler: FrameAssembler;
  sessionTokens: SessionTokenService;
  deliveryStore: DeliveryStore;
  /** Identity of this sceneManager process, minted once at startup and
   *  announced on every SSE stream. Lets a reconnecting overlay tell a
   *  resumed stream from one that came back against a restarted server
   *  (whose scene config it may no longer match). */
  bootId: string;
}

// CORS for iframe-embedded widgets and cross-origin OBS browser
// sources — same rationale as streamware's CORS_HEADERS.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Hand-rolled `Bun.serve` routing — same convention streamware/api use
 * for this class of service (see the note in the earlier scaffold
 * about correcting course away from Hono/Express, neither of which is
 * actually the established pattern here).
 */
export function createHttpServer(deps: HttpDeps) {
  const { ctx } = deps;
  return Bun.serve({
    port: ctx.runtimeConfig.port,
    hostname: ctx.runtimeConfig.bindHost,
    // Bun's 10s default reaps the SSE stream between events, so the
    // scene reconnects every few seconds all day. Long enough to
    // outlast the stream's own 20s heartbeat (see SSE_HEARTBEAT_MS in
    // routes/events.ts) with room to spare, but still finite so a
    // genuinely dead socket gets reclaimed rather than leaked.
    idleTimeout: 120,
    fetch: async (req) => {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      if (url.pathname === "/health") {
        return withCors(Response.json({ status: "ok" }));
      }

      if (url.pathname.startsWith("/assets/")) {
        return withCors(await handleStaticAssetRoute(req, url, ctx.runtimeConfig.publicDir));
      }

      // GET /scene/{sceneId} — shell + JWT mint.
      const sceneMatch = /^\/scene\/([^/]+)$/.exec(url.pathname);
      if (sceneMatch && req.method === "GET") {
        return withCors(await handleSceneRoute(req, url, sceneMatch[1]!, deps));
      }

      // POST /scene/{sceneId}/session/refresh
      const refreshMatch = /^\/scene\/([^/]+)\/session\/refresh$/.exec(url.pathname);
      if (refreshMatch && req.method === "POST") {
        return withCors(await handleSessionRefreshRoute(req, refreshMatch[1]!, deps));
      }

      // GET /scene/{sceneId}/widget/{instanceId}
      const widgetMatch = /^\/scene\/([^/]+)\/widget\/([^/]+)$/.exec(url.pathname);
      if (widgetMatch && req.method === "GET") {
        return withCors(await handleWidgetFrameRoute(req, widgetMatch[1]!, widgetMatch[2]!, deps));
      }

      // POST /scene/{sceneId}/widget/{instanceId}/status
      const statusMatch = /^\/scene\/([^/]+)\/widget\/([^/]+)\/status$/.exec(url.pathname);
      if (statusMatch && req.method === "POST") {
        return withCors(await handleWidgetStatusRoute(req, statusMatch[1]!, statusMatch[2]!, deps));
      }

      // GET /scene/{sceneId}/events — SSE.
      const eventsMatch = /^\/scene\/([^/]+)\/events$/.exec(url.pathname);
      if (eventsMatch && req.method === "GET") {
        return withCors(await handleEventsStreamRoute(req, eventsMatch[1]!, deps));
      }

      // POST /scene/{sceneId}/events/{eventId}/delivered
      const deliveredMatch = /^\/scene\/([^/]+)\/events\/([^/]+)\/delivered$/.exec(url.pathname);
      if (deliveredMatch && req.method === "POST") {
        return withCors(await handleEventDeliveredRoute(req, deliveredMatch[1]!, deliveredMatch[2]!, deps));
      }

      // POST /scene/{sceneId}/events/{eventId}/completed
      const completedMatch = /^\/scene\/([^/]+)\/events\/([^/]+)\/completed$/.exec(url.pathname);
      if (completedMatch && req.method === "POST") {
        return withCors(await handleEventCompletedRoute(req, completedMatch[1]!, completedMatch[2]!, deps));
      }

      return withCors(new Response("Not Found", { status: 404 }));
    },
  });
}
