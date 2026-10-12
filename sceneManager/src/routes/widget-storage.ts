import type { PlacementMeta } from "@woofx3/api/scene-editor";
import type { HttpDeps } from "../http";
import { storageModuleFor } from "../scene/module-state";
import type { SceneVersion } from "../scene/scene-host";
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
 * scene record instead. A widget reads its own module's storage, and beyond it
 * only the value of a resource instance its module's settings link, read from
 * the instance owner's storage (see `storageModuleFor`), and its own module's
 * `list` settings, at `setting:<settingId>`.
 *
 * The placement is looked up in the scene's held documents, published and
 * draft, rather than in the stored row. Pages mount a placement the moment an
 * editor's change reaches them, while the row is written back only after the
 * autosave delay and holds a draft placement only under its draft: a widget
 * added in the editor's preview, or added live, would otherwise be refused
 * every value until the page reloaded.
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
  const cookie = readSessionCookie(req, sceneId);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  if (!claims || claims.sceneId !== sceneId) {
    return jsonResponse(401, { error: "invalid_session" });
  }
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (key === "") {
    return jsonResponse(400, { error: "missing_key" });
  }

  let instance: PlacementMeta | null;
  try {
    instance = await placedWidget(deps, sceneId, instanceId);
  } catch (err) {
    deps.ctx.logger.warn("widget storage: scene unavailable", {
      sceneId,
      instanceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(502, { error: "unavailable" });
  }
  if (!instance) {
    return jsonResponse(404, { error: "not_found" });
  }

  try {
    const readFrom = await storageModuleFor(deps.settingsDb, instance.moduleId, key);
    const value = await deps.moduleState.read(sceneId, readFrom, key, instance.moduleId);
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

/** Versions searched for a placement; a placement in both reads as published. */
const PLACEMENT_VERSIONS: readonly SceneVersion[] = ["published", "draft"];

/**
 * The meta of a placement on either version of the scene, or null when it is
 * on neither or hosts a surface: such a placement is drawn by the page and
 * has no module code to read for.
 */
async function placedWidget(deps: HttpDeps, sceneId: string, instanceId: string): Promise<PlacementMeta | null> {
  for (const version of PLACEMENT_VERSIONS) {
    const snapshot = await deps.sceneDocuments.snapshot(sceneId, version);
    if (!snapshot) {
      return null;
    }
    const meta = Object.hasOwn(snapshot.meta, instanceId) ? snapshot.meta[instanceId] : undefined;
    if (meta) {
      return meta.hostsSurface === "" ? meta : null;
    }
  }
  return null;
}
