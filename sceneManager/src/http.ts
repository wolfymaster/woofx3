import { RequestGuard } from "@woofx3/common/http/request-guard";
import { SpanKind, withSpan } from "@woofx3/common/logging";
import type { ApplicationContext } from "@woofx3/common/runtime";
import type { SceneManagerContext, SceneManagerServices } from "./application";
import type { DeliveryStore } from "./events/delivery-store";
import type { GoogleFontCache } from "./fonts/google-font-cache";
import type { FrameAssembler } from "./scene/frame-assembler";
import type { MediaProxy } from "./scene/media-proxy";
import type { LinkedResourcesDb, ModuleStateWatch } from "./scene/module-state";
import type { SceneDocuments } from "./scene/scene-documents";
import type { OverlayHost } from "./scene/scene-host";
import type { SessionTokenService } from "./scene/session-token";
import { handleSceneConfigRoute, handleSceneDraftConfigRoute, handleSceneRoute } from "./routes/scene";
import { handleSessionRefreshRoute } from "./routes/session";
import {
  COMPOSITION_PREVIEW_FRAMES_PATH,
  COMPOSITION_PREVIEW_REFRESH_PATH,
  handleCompositionPreviewFramesRoute,
  handleCompositionPreviewRefreshRoute,
  handleCompositionPreviewRoute,
} from "./routes/composition-preview";
import { COMPOSITION_PREVIEW_PATH } from "@woofx3/common/cloudevents/Scene/composition-preview";
import { handleAlertWidgetFrameRoute, handleFrameDocumentRoute } from "./routes/widget";
import { type EditorSocketData, editorSocketHandlers, handleEditorUpgrade } from "./routes/editor";
import { handleStaticAssetRoute } from "./routes/assets";
import { handleAssetReadRoute, isAssetReadPath } from "./routes/asset-read";
import { handleFontRoute, isFontPath } from "./routes/fonts";
import { handleMediaProxyRoute, isMediaProxyPath } from "./routes/media";
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
  handleEventStartedRoute,
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
  /** Module settings, for the instances a widget's module links. */
  settingsDb: LinkedResourcesDb;
  /** Each open scene as a sequenced document (see scene-documents.ts). */
  sceneDocuments: SceneDocuments;
  /** Google families for widgets' `font` settings. */
  fonts: GoogleFontCache;
  /** Points external media in what overlays are sent at the media proxy,
   *  for the placements whose frames need it. */
  mediaProxy: MediaProxy;
  /** Identity of this sceneManager process, minted once at startup and
   *  announced on every SSE stream. Lets a reconnecting overlay tell a
   *  resumed stream from one that came back against a restarted server
   *  (whose scene config it may no longer match). */
  bootId: string;
}

// CORS for iframe-embedded widgets and cross-origin OBS browser
// sources — same rationale as streamware's CORS_HEADERS. The allowed
// origin is per request (see RequestGuard.corsOriginHeaders).
const CORS_HEADERS: Record<string, string> = {
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

const ANY_ORIGIN: Record<string, string> = { "Access-Control-Allow-Origin": "*" };

/** CORS headers for a path: its preflight answer and its responses.
 *  `originHeaders` are the request's allowed-origin headers, `*` unless
 *  WOOFX3_ALLOWED_ORIGINS is set. The media proxy and the asset read route
 *  grant none (see routes/media.ts and routes/asset-read.ts). */
export function corsHeadersFor(
  pathname: string,
  originHeaders: Record<string, string> = ANY_ORIGIN
): Record<string, string> {
  if (isMediaProxyPath(pathname) || isAssetReadPath(pathname)) {
    return {};
  }
  return { ...originHeaders, ...(isUploadPath(pathname) ? UPLOAD_CORS_HEADERS : CORS_HEADERS) };
}

function withCors(res: Response, corsHeaders: Record<string, string>): Response {
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
  const editorDeps = { sessionTokens: deps.sessionTokens, sceneDocuments: deps.sceneDocuments, logger: ctx.logger };
  const requestGuard = new RequestGuard(ctx.runtimeConfig.requestGuard);
  return Bun.serve<EditorSocketData>({
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
    // The scene editor's socket (routes/editor.ts).
    websocket: editorSocketHandlers(editorDeps),
    fetch: async (req, server) => {
      const url = new URL(req.url);

      // Before any route, the editor's WebSocket upgrade and the SSE stream
      // included; see "Host and Origin checks" in
      // docs/services/deployment.md for what OBS and widget frames send.
      const rejected = requestGuard.reject(req);
      if (rejected) {
        ctx.logger.warn("Request refused by host/origin guard", {
          status: rejected.status,
          host: req.headers.get("host"),
          origin: req.headers.get("origin"),
          path: url.pathname,
        });
        return rejected;
      }
      const cors = corsHeadersFor(url.pathname, requestGuard.corsOriginHeaders(req));
      const respond = (res: Response): Response => withCors(res, cors);

      // GET /scene/{sceneId}/edit — upgraded outside the request span, since
      // a socket that opens returns no response for the span to end with.
      const editorMatch = /^\/scene\/([^/]+)\/edit$/.exec(url.pathname);
      if (editorMatch && req.method === "GET") {
        return handleEditorUpgrade(req, server, decodeURIComponent(editorMatch[1]!), editorDeps);
      }

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      return withSpan(
        `scene-manager ${req.method}`,
        async (): Promise<Response> => {
          if (url.pathname === "/health") {
            return respond(Response.json({ status: "ok" }));
          }

          if (isUploadPath(url.pathname)) {
            return respond(await handleUploadRoute(req, url, ctx.runtimeConfig.barkloaderUrl, ctx.logger));
          }

          if (isAssetReadPath(url.pathname)) {
            return handleAssetReadRoute(req, url, ctx.runtimeConfig.barkloaderUrl, ctx.logger);
          }

          if (isStorageAssetPath(url.pathname)) {
            return respond(await handleStorageAssetRoute(req, url, ctx.runtimeConfig.barkloaderUrl, ctx.logger));
          }

          if (isFontPath(url.pathname)) {
            return respond(await handleFontRoute(req, url, deps.fonts));
          }

          if (isMediaProxyPath(url.pathname)) {
            return handleMediaProxyRoute(req, url, ctx.runtimeConfig.barkloaderUrl, ctx.logger);
          }

          if (url.pathname.startsWith("/assets/")) {
            return respond(await handleStaticAssetRoute(req, url, ctx.runtimeConfig.publicDir));
          }

          // The editor's composition preview (routes/composition-preview.ts).
          if (url.pathname === COMPOSITION_PREVIEW_PATH && req.method === "GET") {
            return respond(await handleCompositionPreviewRoute(url, deps));
          }
          if (url.pathname === COMPOSITION_PREVIEW_FRAMES_PATH && req.method === "POST") {
            return respond(await handleCompositionPreviewFramesRoute(req, deps));
          }
          if (url.pathname === COMPOSITION_PREVIEW_REFRESH_PATH && req.method === "POST") {
            return respond(await handleCompositionPreviewRefreshRoute(req, deps));
          }

          // GET /scene/{sceneId} — shell + JWT mint.
          const sceneMatch = /^\/scene\/([^/]+)$/.exec(url.pathname);
          if (sceneMatch && req.method === "GET") {
            return respond(await handleSceneRoute(req, url, sceneMatch[1]!, deps));
          }

          // GET /scene/{sceneId}/config
          const configMatch = /^\/scene\/([^/]+)\/config$/.exec(url.pathname);
          if (configMatch && req.method === "GET") {
            return respond(await handleSceneConfigRoute(req, configMatch[1]!, deps));
          }

          // POST /scene/{sceneId}/draft-config
          const draftConfigMatch = /^\/scene\/([^/]+)\/draft-config$/.exec(url.pathname);
          if (draftConfigMatch && req.method === "POST") {
            return respond(await handleSceneDraftConfigRoute(req, draftConfigMatch[1]!, deps));
          }

          // POST /scene/{sceneId}/session/refresh
          const refreshMatch = /^\/scene\/([^/]+)\/session\/refresh$/.exec(url.pathname);
          if (refreshMatch && req.method === "POST") {
            return respond(await handleSessionRefreshRoute(req, refreshMatch[1]!, deps));
          }

          // GET /frames/{moduleId}/{manifestId}
          const frameDocumentMatch = /^\/frames\/([^/]+)\/([^/]+)$/.exec(url.pathname);
          if (frameDocumentMatch && req.method === "GET") {
            return respond(await handleFrameDocumentRoute(req, frameDocumentMatch[1]!, frameDocumentMatch[2]!, deps));
          }

          // GET /scene/{sceneId}/alert/{eventId}/widget/{widgetId}
          const alertWidgetMatch = /^\/scene\/([^/]+)\/alert\/([^/]+)\/widget\/([^/]+)$/.exec(url.pathname);
          if (alertWidgetMatch && req.method === "GET") {
            return respond(
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
            return respond(await handleWidgetStatusRoute(req, statusMatch[1]!, statusMatch[2]!, deps));
          }

          // GET /scene/{sceneId}/widget/{instanceId}/storage?key={key}
          const storageMatch = /^\/scene\/([^/]+)\/widget\/([^/]+)\/storage$/.exec(url.pathname);
          if (storageMatch && req.method === "GET") {
            return respond(await handleWidgetStorageRoute(req, storageMatch[1]!, storageMatch[2]!, deps));
          }

          // GET /scene/{sceneId}/events — SSE.
          const eventsMatch = /^\/scene\/([^/]+)\/events$/.exec(url.pathname);
          if (eventsMatch && req.method === "GET") {
            return respond(await handleEventsStreamRoute(req, eventsMatch[1]!, deps));
          }

          // POST /scene/{sceneId}/events/{eventId}/delivered
          const deliveredMatch = /^\/scene\/([^/]+)\/events\/([^/]+)\/delivered$/.exec(url.pathname);
          if (deliveredMatch && req.method === "POST") {
            return respond(await handleEventDeliveredRoute(req, deliveredMatch[1]!, deliveredMatch[2]!, deps));
          }

          // POST /scene/{sceneId}/events/{eventId}/started
          const startedMatch = /^\/scene\/([^/]+)\/events\/([^/]+)\/started$/.exec(url.pathname);
          if (startedMatch && req.method === "POST") {
            return respond(await handleEventStartedRoute(req, startedMatch[1]!, startedMatch[2]!, deps));
          }

          // POST /scene/{sceneId}/events/{eventId}/completed
          const completedMatch = /^\/scene\/([^/]+)\/events\/([^/]+)\/completed$/.exec(url.pathname);
          if (completedMatch && req.method === "POST") {
            return respond(await handleEventCompletedRoute(req, completedMatch[1]!, completedMatch[2]!, deps));
          }

          return respond(new Response("Not Found", { status: 404 }));
        },
        {
          attributes: { "http.request.method": req.method, "url.path": url.pathname },
          kind: SpanKind.SERVER,
        }
      );
    },
  });
}
