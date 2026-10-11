import { COMPOSITION_PREVIEW_PATH } from "@woofx3/common/cloudevents/Scene/composition-preview";
import { type DeclaredBehaviorKinds, NO_DECLARED_KINDS } from "@woofx3/scene/model";
import type { HttpDeps } from "../http";
import { renderCompositionPreviewShell } from "../scene/preview-shell";
import { readCookie } from "../scene/session-cookie";
import { SESSION_TOKEN_TTL_SECONDS } from "../scene/session-token";
import { MAX_DRAFT_BODY_BYTES } from "./scene";

// The composition preview: the page the dashboard's alert editor embeds to
// play the composition being edited with the real runtime and widget frames
// (see docs/services/composition-preview.md).
//
// An alert never has an overlay page or an overlay token: it is played inside
// a scene's alert area. This page is not an overlay either. It shows nothing
// stored: it plays whatever the page that frames it posts, and saves nothing.
// It is opened with a token only the api mints (`getCompositionPreviewUrl`,
// for a dashboard holding the engine's client credentials), never with an
// overlay token, so no browser source URL can open it. The token is
// exchanged for a session cookie as an overlay's is, and the session
// authorizes the one thing the page asks the engine for: how to frame the
// widgets it was posted.

export const COMPOSITION_PREVIEW_FRAMES_PATH = `${COMPOSITION_PREVIEW_PATH}/frames`;
export const COMPOSITION_PREVIEW_REFRESH_PATH = `${COMPOSITION_PREVIEW_PATH}/session/refresh`;

/** One cookie for every preview page a browser has open: none of them names anything. */
export const PREVIEW_SESSION_COOKIE = "sm_preview_session";

/** As an overlay's session cookie (see session-cookie.ts). */
export function serializePreviewSessionCookie(token: string, maxAgeSeconds: number): string {
  return [
    `${PREVIEW_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

const NOT_FOUND_HTML = "<!doctype html><html><head></head><body></body></html>";

const NO_STORE = { "Cache-Control": "no-store" };

async function previewSessionAllows(req: Request, deps: HttpDeps): Promise<boolean> {
  const cookie = readCookie(req, PREVIEW_SESSION_COOKIE);
  return cookie !== null && (await deps.sessionTokens.verifyPreviewSession(cookie));
}

async function withFreshSession(deps: HttpDeps, headers: Record<string, string>): Promise<Record<string, string>> {
  const session = await deps.sessionTokens.mintPreviewSession();
  return { ...headers, "Set-Cookie": serializePreviewSessionCookie(session, SESSION_TOKEN_TTL_SECONDS) };
}

/**
 * `GET /preview/composition?token=…`: the page, and its session. A missing,
 * expired or foreign token (an overlay's session, an editor's) gets the same
 * blank document a wrong path would.
 */
export async function handleCompositionPreviewRoute(url: URL, deps: HttpDeps): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";
  if (!(await deps.sessionTokens.verifyPreview(token))) {
    return new Response(NOT_FOUND_HTML, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
    });
  }
  return new Response(renderCompositionPreviewShell(), {
    status: 200,
    headers: await withFreshSession(deps, {
      "Content-Type": "text/html; charset=utf-8",
      ...NO_STORE,
      "Referrer-Policy": "no-referrer",
    }),
  });
}

/** `POST /preview/composition/session/refresh`: the page's ~50 s refresh, as an overlay's. */
export async function handleCompositionPreviewRefreshRoute(req: Request, deps: HttpDeps): Promise<Response> {
  if (!(await previewSessionAllows(req, deps))) {
    return Response.json({ error: "invalid_session" }, { status: 401, headers: NO_STORE });
  }
  return Response.json({ status: "ok" }, { headers: await withFreshSession(deps, NO_STORE) });
}

/** One widget the page asks to frame. */
interface FramesRequestWidget {
  id: string;
  widget: string;
  settings: Record<string, unknown>;
}

/** Most widgets one request may name; an alert holds a handful. */
export const MAX_PREVIEW_WIDGETS = 256;

function parseFramesRequest(text: string): FramesRequestWidget[] | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const widgets = (body as { widgets?: unknown } | null)?.widgets;
  if (!Array.isArray(widgets) || widgets.length > MAX_PREVIEW_WIDGETS) {
    return null;
  }
  const parsed: FramesRequestWidget[] = [];
  for (const raw of widgets) {
    if (typeof raw !== "object" || raw === null) {
      return null;
    }
    const { id, widget, settings } = raw as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || typeof widget !== "string") {
      return null;
    }
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      return null;
    }
    parsed.push({ id, widget, settings: settings as Record<string, unknown> });
  }
  return parsed;
}

/**
 * `POST /preview/composition/frames` with `{ widgets: [{ id, widget, settings }] }`:
 * how to frame each widget, as an overlay frames a placement (the widget's
 * versioned frame document, its module's linked resources, the behavior
 * kinds it declares in the catalog), with the media proxy URLs its settings
 * need under the frame's policy. A widget that
 * matches nothing installed, or that an overlay draws itself (an alert area),
 * is answered with a problem instead.
 *
 * Every external media URL in the posted settings is signed, where a scene's
 * draft config signs only URLs already in the scene's document: an overlay
 * token is held by every browser source showing the overlay, but this
 * session only by a dashboard that holds the engine's client credentials,
 * which can put any URL into a document anyway.
 */
export async function handleCompositionPreviewFramesRoute(req: Request, deps: HttpDeps): Promise<Response> {
  if (!(await previewSessionAllows(req, deps))) {
    return Response.json({ error: "invalid_session" }, { status: 401, headers: NO_STORE });
  }
  const declaredLength = Number(req.headers.get("Content-Length") ?? "0");
  if (declaredLength > MAX_DRAFT_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413, headers: NO_STORE });
  }
  const text = await req.text();
  if (text.length > MAX_DRAFT_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413, headers: NO_STORE });
  }
  const requested = parseFramesRequest(text);
  if (requested === null) {
    return Response.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }

  // The placement shape the scene host parses a stored scene's widgets in.
  const entries = requested.map(({ id, widget, settings }) => ({ id, widgetCanonicalId: widget, settings }));
  const instances = await deps.host.framePlacements("composition-preview", entries);
  const framed = new Map(instances.map((instance) => [instance.id, instance]));

  const widgets: Record<
    string,
    {
      frameUrl: string;
      linkedResources: Record<string, string>;
      mediaUrls: Record<string, string>;
      behaviorKinds: DeclaredBehaviorKinds;
    }
  > = {};
  const problems: Array<{ kind: "unknown-widget" | "unframed-widget"; id: string }> = [];
  for (const { id } of requested) {
    const instance = framed.get(id);
    if (instance === undefined || !instance.resolved) {
      problems.push({ kind: "unknown-widget", id });
      continue;
    }
    if (instance.hostsSurface !== "") {
      problems.push({ kind: "unframed-widget", id });
      continue;
    }
    const { signed } = deps.mediaProxy.overlaySettings(instance.settings, instance.mediaProxyBase);
    widgets[id] = {
      frameUrl: instance.frameUrl,
      linkedResources: instance.linkedResources ?? {},
      mediaUrls: Object.fromEntries(signed),
      behaviorKinds: instance.behaviorKinds ?? NO_DECLARED_KINDS,
    };
  }
  return Response.json({ widgets, problems }, { headers: NO_STORE });
}
