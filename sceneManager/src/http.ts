import { SpanKind, withSpan } from "@woofx3/common/logging";
import type { ApplicationContext } from "@woofx3/common/runtime";
import type { SceneManagerContext, SceneManagerServices } from "./application";
import type { DeliveryStore } from "./events/delivery-store";
import type { FrameAssembler } from "./scene/frame-assembler";
import type { ModuleStateWatch } from "./scene/module-state";
import type { OverlayHost } from "./scene/scene-host";
import type { SessionTokenService } from "./scene/session-token";
import { handleSceneRoute } from "./routes/scene";
import { handleSessionRefreshRoute } from "./routes/session";
import { handleAlertWidgetFrameRoute, handleWidgetFrameRoute } from "./routes/widget";
import { handleStaticAssetRoute } from "./routes/assets";
import { handleWidgetStorageRoute } from "./routes/widget-storage";
import {
  handleStorageAssetRoute,
  handleUploadRoute,
  isStorageAssetPath,
  isUploadPath,
  MAX_UPLOAD_BYTES,
  UPLOAD_ALLOWED_METHODS,
} from "./routes/storage";
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
  moduleState: ModuleStateWatch;
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

// Upload grants are bearer capabilities carried in the URL, not cookies,
// so allowing any origin to PUT grants nothing the token did not already.
const UPLOAD_CORS_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  "Access-Control-Allow-Methods": UPLOAD_ALLOWED_METHODS,
};

/** CORS headers for a path: its preflight answer and its responses. */
export function corsHeadersFor(pathname: string): Record<string, string> {
  return isUploadPath(pathname) ? UPLOAD_CORS_HEADERS : CORS_HEADERS;
}

function withCors(res: Response, corsHeaders: Record<string, string> = CORS_HEADERS): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(corsHeaders)) {
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
    // Bun's 128 MiB default would cut off uploads the relay below is
    // meant to accept. Bun only offers this limit server-wide, so the
    // small-JSON routes inherit the same ceiling; that is the trade for
    // one upload limit rather than two that disagree.
    maxRequestBodySize: MAX_UPLOAD_BYTES,
    fetch: async (req) => {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeadersFor(url.pathname) });
      }

      return withSpan(
        `scene-manager ${req.method}`,
        async (): Promise<Response> => {
          if (url.pathname === "/health") {
            return withCors(Response.json({ status: "ok" }));
          }

          if (isUploadPath(url.pathname)) {
            return withCors(
              await handleUploadRoute(req, url, ctx.runtimeConfig.barkloaderUrl, ctx.logger),
              UPLOAD_CORS_HEADERS
            );
          }

          if (isStorageAssetPath(url.pathname)) {
            return withCors(await handleStorageAssetRoute(req, url, ctx.runtimeConfig.barkloaderUrl, ctx.logger));
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

          // GET /scene/{sceneId}/alert/{eventId}/widget/{widgetId}
          const alertWidgetMatch = /^\/scene\/([^/]+)\/alert\/([^/]+)\/widget\/([^/]+)$/.exec(url.pathname);
          if (alertWidgetMatch && req.method === "GET") {
            return withCors(
              await handleAlertWidgetFrameRoute(
                req,
                alertWidgetMatch[1]!,
                alertWidgetMatch[2]!,
                alertWidgetMatch[3]!,
                deps
              )
            );
          }

          // POST /scene/{sceneId}/widget/{instanceId}/status
          const statusMatch = /^\/scene\/([^/]+)\/widget\/([^/]+)\/status$/.exec(url.pathname);
          if (statusMatch && req.method === "POST") {
            return withCors(await handleWidgetStatusRoute(req, statusMatch[1]!, statusMatch[2]!, deps));
          }

          // GET /scene/{sceneId}/widget/{instanceId}/storage?key={key}
          const storageMatch = /^\/scene\/([^/]+)\/widget\/([^/]+)\/storage$/.exec(url.pathname);
          if (storageMatch && req.method === "GET") {
            return withCors(await handleWidgetStorageRoute(req, storageMatch[1]!, storageMatch[2]!, deps));
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
        {
          attributes: { "http.request.method": req.method, "url.path": url.pathname },
          kind: SpanKind.SERVER,
        }
      );
    },
  });
}
