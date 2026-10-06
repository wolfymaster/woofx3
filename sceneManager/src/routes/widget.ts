import type { HttpDeps } from "../http";
import { parseDraftParam } from "../scene/scene-host";
import { readSessionCookie } from "../scene/session-cookie";

/**
 * `GET /scene/{sceneId}/widget/{instanceId}` — assembled widget frame
 * document. Authorized via the session cookie (not a re-presented
 * opaque token or a URL-embedded credential — see session-cookie.ts).
 * A missing/expired/mismatched session gets the same uniform blank
 * document `FrameAssembler` already returns for an unknown scene or
 * instance — no separate "you're not authorized" signal to probe.
 */
export async function handleWidgetFrameRoute(
  req: Request,
  sceneId: string,
  instanceId: string,
  deps: HttpDeps
): Promise<Response> {
  if (!(await sessionAllows(req, sceneId, deps))) {
    return deps.frameAssembler.blankResponse();
  }

  const url = new URL(req.url);
  return deps.frameAssembler.assemble(sceneId, instanceId, url.searchParams.get("nonce"));
}

/**
 * `GET /scene/{sceneId}/draft-widget/{instanceId}?draft=…` — a frame for a
 * placement the scene editor has not saved (see `draftFrameUrl`). Authorized
 * and refused exactly like a placement's frame. A session can only render
 * into its own page, so a draft reaches no one but the overlay that asked.
 */
export async function handleDraftWidgetFrameRoute(
  req: Request,
  sceneId: string,
  instanceId: string,
  deps: HttpDeps
): Promise<Response> {
  if (!(await sessionAllows(req, sceneId, deps))) {
    return deps.frameAssembler.blankResponse();
  }

  const url = new URL(req.url);
  return deps.frameAssembler.assembleDraft(
    sceneId,
    instanceId,
    parseDraftParam(url.searchParams.get("draft")),
    url.searchParams.get("nonce")
  );
}

/**
 * `GET /scene/{sceneId}/alert/{eventId}/widget/{widgetId}` — one widget of
 * the alert layout delivered to this scene as scene event `eventId`.
 * Authorized and refused exactly like a placement's frame.
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
