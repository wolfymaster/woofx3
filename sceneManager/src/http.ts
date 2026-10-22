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
import { handleAssetReadRoute } from "./routes/asset-read";
import { handleFontRoute } from "./routes/fonts";
import { handleMediaProxyRoute } from "./routes/media";
import {
  ANY_ORIGIN,
  type CorsOrigin,
  corsHeadersForPath,
  dispatchRoute,
  matchRoute,
  type Route,
  routeTable,
} from "./routes/route-table";
import { ENGINE_ASSET_PREFIXES } from "@woofx3/module-sdk";
import { MEDIA_PROXY_PATH } from "../contract/media-url";
import { FONT_FILES_PREFIX, FONT_STYLESHEET_PATH } from "./fonts/google-font-cache";
import { handleWidgetStorageRoute } from "./routes/widget-storage";
import { handleStorageAssetRoute, handleUploadRoute, MAX_UPLOAD_BYTES } from "./routes/storage";
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

/**
 * Every HTTP route. Which one answers a path is decided by specificity, not
 * by order (see `matchRoute`).
 */
const ROUTES = routeTable<HttpDeps>([
  {
    path: "/health",
    methods: ["GET"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: () => Response.json({ status: "ok" }),
  },

  // Stored files, the media proxy and fonts.
  {
    path: "/assets/upload/:grant",
    methods: ["PUT"],
    cors: "upload",
    opaqueOrigin: "refuse",
    handle: (req, { url, deps }) => handleUploadRoute(req, url, deps.ctx.runtimeConfig.barkloaderUrl, deps.ctx.logger),
  },
  {
    // Read only by the overlay page itself, so it grants no CORS.
    path: "/assets/read/*",
    methods: ["GET"],
    cors: "none",
    opaqueOrigin: "refuse",
    handle: (req, { url, deps }) =>
      handleAssetReadRoute(req, url, deps.ctx.runtimeConfig.barkloaderUrl, deps.ctx.logger),
  },
  ...ENGINE_ASSET_PREFIXES.map(
    (prefix): Route<HttpDeps> => ({
      path: `${prefix}*`,
      methods: ["GET"],
      cors: "open",
      // A sandboxed widget frame's module scripts and @font-face fonts load
      // in CORS mode with `Origin: null`, from its module's files and the
      // asset library.
      opaqueOrigin: "allow",
      handle: (req, { url, deps }) =>
        handleStorageAssetRoute(req, url, deps.ctx.runtimeConfig.barkloaderUrl, deps.ctx.logger),
    })
  ),
  {
    // See routes/media.ts for why it grants no CORS.
    path: `${MEDIA_PROXY_PATH}:token`,
    methods: ["GET"],
    cors: "none",
    opaqueOrigin: "refuse",
    handle: (req, { url, deps }) =>
      handleMediaProxyRoute(req, url, deps.ctx.runtimeConfig.barkloaderUrl, deps.ctx.logger),
  },
  {
    path: FONT_STYLESHEET_PATH,
    methods: ["GET"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { url, deps }) => handleFontRoute(req, url, deps.fonts),
  },
  {
    path: `${FONT_FILES_PREFIX}*`,
    methods: ["GET"],
    cors: "open",
    // The font files a frame's linked font stylesheet names, fetched in CORS
    // mode with `Origin: null`. The stylesheet itself loads without CORS.
    opaqueOrigin: "allow",
    handle: (req, { url, deps }) => handleFontRoute(req, url, deps.fonts),
  },
  {
    path: "/assets/*",
    methods: ["GET"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { url, deps }) => handleStaticAssetRoute(req, url, deps.ctx.runtimeConfig.publicDir),
  },

  // The editor's composition preview.
  {
    path: COMPOSITION_PREVIEW_PATH,
    methods: ["GET"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (_req, { url, deps }) => handleCompositionPreviewRoute(url, deps),
  },
  {
    path: COMPOSITION_PREVIEW_FRAMES_PATH,
    methods: ["POST"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { deps }) => handleCompositionPreviewFramesRoute(req, deps),
  },
  {
    path: COMPOSITION_PREVIEW_REFRESH_PATH,
    methods: ["POST"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { deps }) => handleCompositionPreviewRefreshRoute(req, deps),
  },

  // Widget frame documents.
  {
    path: "/frames/:moduleId/:manifestId",
    methods: ["GET"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { params, deps }) => handleFrameDocumentRoute(req, params.moduleId!, params.manifestId!, deps),
  },

  // An overlay page and what it calls.
  {
    path: "/scene/:sceneId",
    methods: ["GET"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { url, params, deps }) => handleSceneRoute(req, url, params.sceneId!, deps),
  },
  {
    path: "/scene/:sceneId/config",
    methods: ["GET"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { params, deps }) => handleSceneConfigRoute(req, params.sceneId!, deps),
  },
  {
    path: "/scene/:sceneId/draft-config",
    methods: ["POST"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { params, deps }) => handleSceneDraftConfigRoute(req, params.sceneId!, deps),
  },
  {
    path: "/scene/:sceneId/session/refresh",
    methods: ["POST"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { params, deps }) => handleSessionRefreshRoute(req, params.sceneId!, deps),
  },
  {
    path: "/scene/:sceneId/alert/:eventId/widget/:widgetId",
    methods: ["GET"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { params, deps }) =>
      handleAlertWidgetFrameRoute(req, params.sceneId!, params.eventId!, params.widgetId!, deps),
  },
  {
    path: "/scene/:sceneId/widget/:instanceId/status",
    methods: ["POST"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { params, deps }) => handleWidgetStatusRoute(req, params.sceneId!, params.instanceId!, deps),
  },
  {
    path: "/scene/:sceneId/widget/:instanceId/storage",
    methods: ["GET"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { params, deps }) => handleWidgetStorageRoute(req, params.sceneId!, params.instanceId!, deps),
  },
  {
    path: "/scene/:sceneId/events",
    methods: ["GET"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { params, deps }) => handleEventsStreamRoute(req, params.sceneId!, deps),
  },
  {
    path: "/scene/:sceneId/events/:eventId/delivered",
    methods: ["POST"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { params, deps }) => handleEventDeliveredRoute(req, params.sceneId!, params.eventId!, deps),
  },
  {
    path: "/scene/:sceneId/events/:eventId/started",
    methods: ["POST"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { params, deps }) => handleEventStartedRoute(req, params.sceneId!, params.eventId!, deps),
  },
  {
    path: "/scene/:sceneId/events/:eventId/completed",
    methods: ["POST"],
    cors: "open",
    opaqueOrigin: "refuse",
    handle: (req, { params, deps }) => handleEventCompletedRoute(req, params.sceneId!, params.eventId!, deps),
  },
]);

/** The pattern of the route answering `pathname`, or null when none does. */
export function routeOf(pathname: string): string | null {
  const match = matchRoute(ROUTES, pathname);
  return match.route === null ? null : match.route.path;
}

/**
 * The CORS headers the route answering `pathname` grants: its preflight
 * answer and its responses, to a request from `origin` (every origin unless
 * sceneManager's origin list is set; see config.ts).
 */
export function corsHeadersFor(pathname: string, origin: CorsOrigin = ANY_ORIGIN): Record<string, string> {
  return corsHeadersForPath(ROUTES, pathname, origin);
}

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
    // Bun's 128 MiB default would cut off uploads the relay is meant to
    // accept. Bun only offers this limit server-wide; every route that reads
    // its body whole reads it under its own, far smaller, limit (BODY_LIMITS
    // in routes/http-kit.ts).
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

      // GET /scene/{sceneId}/edit — upgraded outside the route table and the
      // request span, since a socket that opens returns no response.
      const editorMatch = /^\/scene\/([^/]+)\/edit$/.exec(url.pathname);
      if (editorMatch && req.method === "GET") {
        const refused = requestGuard.rejectOpaqueOrigin(req);
        if (refused) {
          return refused;
        }
        let sceneId: string;
        try {
          sceneId = decodeURIComponent(editorMatch[1]!);
        } catch {
          return new Response(null, { status: 400 });
        }
        return handleEditorUpgrade(req, server, sceneId, editorDeps);
      }

      return withSpan(
        `scene-manager ${req.method}`,
        () => dispatchRoute(ROUTES, req, url, deps, ctx.logger, requestGuard),
        {
          attributes: { "http.request.method": req.method, "url.path": url.pathname },
          kind: SpanKind.SERVER,
        }
      );
    },
  });
}
