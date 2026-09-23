import type { HttpDeps } from "../http";
import { readSessionCookie } from "../scene/session-cookie";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * `GET /scene/{sceneId}/widget/{instanceId}/storage?key={key}` — the current
 * value of one key in the storage of the module a placed widget belongs to, as
 * `{ value }`, and from then on every change to it on the scene's event stream
 * (see scene/module-state.ts).
 *
 * Addressed by placement rather than by module: a widget names its module in
 * its `hello`, and nothing checks that claim, so the module is taken from the
 * scene record instead. A widget can only ever read its own module's storage.
 *
 * The key travels as a query parameter because storage keys carry colons
 * (`state:woofx3:counter:deaths`).
 */
export async function handleWidgetStorageRoute(
  req: Request,
  sceneId: string,
  instanceId: string,
  deps: HttpDeps
): Promise<Response> {
  const cookie = readSessionCookie(req);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  if (!claims || claims.sceneId !== sceneId) {
    return jsonResponse(401, { error: "invalid_session" });
  }
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (key === "") {
    return jsonResponse(400, { error: "missing_key" });
  }

  const state = await deps.host.loadSceneById(sceneId);
  // A placement that hosts a surface is drawn by the page and has no module code to read for.
  const instance = state?.instances.find((w) => w.id === instanceId && w.hostsSurface === "");
  if (!instance) {
    return jsonResponse(404, { error: "not_found" });
  }

  try {
    const value = await deps.moduleState.read(sceneId, claims.applicationId, instance.moduleId, key);
    return jsonResponse(200, { value });
  } catch (err) {
    deps.ctx.logger.warn("widget storage read failed", {
      sceneId,
      instanceId,
      moduleId: instance.moduleId,
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(502, { error: "unavailable" });
  }
}
