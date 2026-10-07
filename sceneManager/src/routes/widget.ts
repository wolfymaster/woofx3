import type { HttpDeps } from "../http";
import { readSessionCookie } from "../scene/session-cookie";

/**
 * `GET /frames/{moduleId}/{manifestId}?theme=…&v=…` — a widget's frame
 * document (see `FrameAssembler.assembleDocument`). Public: it holds the
 * widget's own code and nothing about any scene or placement, which reach
 * the frame through the URL's fragment, never the server.
 */
export async function handleFrameDocumentRoute(
  req: Request,
  moduleId: string,
  manifestId: string,
  deps: HttpDeps
): Promise<Response> {
  const url = new URL(req.url);
  return deps.frameAssembler.assembleDocument(
    decodeURIComponent(moduleId),
    decodeURIComponent(manifestId),
    url.searchParams.get("theme"),
    url.searchParams.get("v")
  );
}

/**
 * `GET /scene/{sceneId}/alert/{eventId}/widget/{widgetId}` — one widget of
 * the alert layout delivered to this scene as scene event `eventId`.
 * Authorized by the scene's session cookie; a refusal gets the blank document.
 */
export async function handleAlertWidgetFrameRoute(
  req: Request,
  sceneId: string,
  eventId: string,
  widgetId: string,
  deps: HttpDeps
): Promise<Response> {
  if (!(await sessionAllows(req, sceneId, deps))) {
    return deps.frameAssembler.blankResponse();
  }

  const url = new URL(req.url);
  return deps.frameAssembler.assembleAlertWidget(sceneId, eventId, widgetId, url.searchParams.get("nonce"));
}

async function sessionAllows(req: Request, sceneId: string, deps: HttpDeps): Promise<boolean> {
  const cookie = readSessionCookie(req, sceneId);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  return !!claims && claims.sceneId === sceneId;
}
